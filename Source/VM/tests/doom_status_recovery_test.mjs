// Execute the real emitted C64 receiver. Faults affect CPU IO2 reads only,
// not the host's stored status. This is not an electrical timing simulation.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {C64TerminalCpu} from './helpers/c64-terminal-cpu.mjs';
import {crc16Ccitt} from './helpers/crc16.mjs';
import {loadVmTerminal} from '../client/host/stream-terminal.mjs';

const {buildMpe3TitleTerminal,MPE3_TITLE_TERMINAL_STATE:state} =
  await loadVmTerminal(path.resolve('Source/VM/client'),{videoSelectors:true,musicPackets:true});
const options={gameplay:true,enable1351Mouse:false,packetReplay:true};
const program=buildMpe3TitleTerminal({...options,statusRecovery:true});
const cell=Buffer.from([7,0,0x81,0x42,0x24,0x18,0x18,0x24,0x42,0x81,0x10,1]);
const sid=Buffer.alloc(26);sid[1]=0x34;sid[2]=0x12;sid[5]=0x41;sid[7]=0xf0;sid[25]=15;
function packet(index){
  const payload=index&1?sid:cell,bytes=Buffer.alloc(payload.length+10);
  bytes.set([77,51,1,index&1?2:1,(index%255)+1,index===0?0x0b:index&1?0x21:8,payload.length,0]);
  bytes.set(payload,8);bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0,-2)),bytes.length-2);return bytes;
}
function run({enabled=true,bad=0xe2,burst=1,faultIndex=2,periodic=false,count=4,
  genuine=null,unstableCode=false,crc=false,noDma=false,timing=0x83}={}){
  const p=enabled?program:buildMpe3TitleTerminal(options),packets=Array.from({length:count},(_,i)=>packet(i));
  let index=0,started=false,inRecovery=false,replays=0,quiet=0,recoveryWrites=0,codeReads=0;
  const acks=[],faultReads=new Map();
  const publish=c=>{c.ram.set(packets[index],0xdf00);c.ram[0xdff7]=packets[index][4];c.ram[0xdff5]=2;};
  const cpu=new C64TerminalCpu(p,{onWrite(c,a,v){
    if(inRecovery&&[0xd011,0xd016,0xd018,0xdd00,0xd015].includes(a))recoveryWrites++;
    if(a===0xdff4&&v===1&&!started){started=true;publish(c);c.ram[0xdffb]=timing;}
    if(a===0xdff4&&v===4){quiet++;inRecovery=false;}
    if(a===0xdff4&&v===6){
      replays++;if(!noDma){c.ram.set(packets[index],p.stageAddress);c.ram[0x02f0]=0xa5;c.ram[0xdff5]=0x12;}
    }
    if(a===0xdff6&&started){
      assert.ok(!inRecovery,'Unconfirmed status must not ACK a packet');
      assert.equal(v,packets[index][4]);acks.push(v);
      if(++index<count)publish(c);
    }
  }},{rasterInterruptPeriod:2000,recordWrites:false});
  const read=cpu.read.bind(cpu);
  cpu.read=a=>{
    let value=read(a);
    if(!started||index>=count)return value;
    const selected=periodic?index>=faultIndex:index===faultIndex;
    if(!selected)return value;
    if(a===0xdffb&&unstableCode&&genuine!==null)return genuine+(codeReads++&1);
    if(a===0xdf0c&&crc)return value^8;
    if(a!==0xdff5)return value;
    if(genuine!==null){cpu.ram[0xdff5]=0xe0;cpu.ram[0xdffb]=genuine;inRecovery=true;return 0xe0;}
    const n=faultReads.get(index)??0;
    if(n<burst){faultReads.set(index,n+1);inRecovery=true;return bad;}
    inRecovery=false;return value;
  };
  cpu.runUntil(c=>acks.length===count||c.pc===p.labels.terminal_error_hold,12_000_000);
  return {cpu,p,acks,replays,quiet,recoveryWrites,faultReads,
    error:cpu.ram[state.error],recoveries:enabled?cpu.ram[p.labels.status_recoveries_low]+256*cpu.ram[p.labels.status_recoveries_high]:0};
}
test('original receiver reproduces the false firmware stop',()=>{
  const r=run({enabled:false});assert.equal(r.error,3);assert.deepEqual(r.acks,[1,2]);
  assert.equal(r.cpu.ram[0xdff5],2);assert.equal(r.cpu.ram[state.controlSnapshot+5],0xe2);
  assert.equal(r.cpu.ram[state.controlSnapshot+11],0x83);
});
test('normal packets take no recovery or display-reset path',()=>{
  const r=run({burst:0});assert.equal(r.error,0);assert.equal(r.acks.length,4);
  assert.equal(r.recoveries,0);assert.equal(r.replays,0);assert.equal(r.quiet,0);
});
for(const timing of [0x82,0x83])for(const faultIndex of [0,2])
  test(`all high status-byte corruptions recover, timing ${timing}, packet ${faultIndex}`,()=>{
    for(let bad=0xe0;bad<=0xff;bad++){
      const r=run({bad,timing,faultIndex});assert.equal(r.error,0);assert.equal(r.acks.length,4);
      assert.equal(r.recoveries,1);assert.equal(r.replays,0);assert.equal(r.quiet,0);
      assert.equal(r.recoveryWrites,0,'Recovery must retain current video');
      assert.equal(r.cpu.ram[r.p.labels.status_last_bad],bad);
    }
  });
for(const bad of [0xe0,0xe2,0xf8,0xff])for(const burst of [2,8,32])
  test(`burst of ${burst} bad ${bad.toString(16)} reads recovers without blanking`,()=>{
    const r=run({bad,burst});assert.equal(r.error,0);assert.equal(r.recoveries,1);
    assert.equal(r.acks.length,4);assert.equal(r.recoveryWrites,0);assert.equal(r.quiet,0);
  });
test('repeated isolated faults do not accumulate into a terminal failure',()=>{
  const r=run({periodic:true,count:160});assert.equal(r.error,0);
  assert.equal(r.acks.length,160);assert.equal(r.recoveries,158);assert.equal(r.recoveryWrites,0);
});
for(const bad of [0xe0,0xe2,0xf8,0xff])
  test(`persistent ${bad.toString(16)} status fails within the retry budget`,()=>{
    const r=run({bad,burst:Infinity});assert.equal(r.error,13);assert.deepEqual(r.acks,[1,2]);
    assert.equal(r.recoveries,0);assert.equal(r.quiet,1);
    assert.equal(r.faultReads.get(2),34); // original + 32 retries + diagnostic snapshot
  });
for(const genuine of [0x14,0x17,0x19,0x76,0xff])
  test(`genuine firmware error ${genuine.toString(16)} still stops without ACK`,()=>{
    const r=run({genuine});assert.equal(r.error,3);assert.deepEqual(r.acks,[1,2]);
    assert.equal(r.recoveries,0);assert.equal(r.cpu.ram[state.controlSnapshot+11],genuine);
    assert.equal(r.cpu.ram[state.controlSnapshot+5],0xe0);assert.equal(r.quiet,1);
  });
test('unstable error-code snapshots cannot confirm a firmware error',()=>{
  const r=run({genuine:0x76,unstableCode:true});assert.equal(r.error,13);assert.deepEqual(r.acks,[1,2]);
});
test('status recovery does not bypass packet CRC or replay validation',()=>{
  const r=run({crc:true});assert.equal(r.error,0);assert.equal(r.recoveries,1);
  assert.equal(r.replays,1);assert.equal(r.acks.length,4);
});
test('failed packet replay after status recovery still cannot ACK bad data',()=>{
  const r=run({crc:true,noDma:true});assert.equal(r.error,12);assert.deepEqual(r.acks,[1,2]);
  assert.equal(r.recoveries,1);
});
test('recovery counter saturates and fatal diagnostic restores readable colours',()=>{
  const c=new C64TerminalCpu(program,{}, {rasterInterruptPeriod:0,recordWrites:false});
  c.ram[program.labels.status_recoveries_low]=255;c.ram[program.labels.status_recoveries_high]=255;
  c.ram[0xdff5]=2;c.sp=0xfd;c.push(0x7f);c.push(0xfe);c.a=0xe2;c.pc=program.labels.status_read_recover;
  c.runUntil(c=>c.pc===0x7fff,10000);assert.equal(c.a,2);
  assert.equal(c.ram[program.labels.status_recoveries_low],255);assert.equal(c.ram[program.labels.status_recoveries_high],255);
  c.ram.fill(0,0xd800,0xdc00);c.pc=program.labels.terminal_error_hold;c.step();
  c.runUntil(c=>c.pc===program.labels.terminal_error_hold,10000);
  assert.ok(c.ram.subarray(0xd800,0xdc00).every(v=>v===1));
});
