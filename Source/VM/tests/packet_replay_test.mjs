// Execute the Doom C64 client with persistent IO2 faults, independent of
// firmware's CRC implementation. DMA completion writes RAM only in the model.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {C64TerminalCpu} from './helpers/c64-terminal-cpu.mjs';
import {crc16Ccitt} from './helpers/crc16.mjs';
import {loadVmTerminal} from '../client/host/stream-terminal.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
function packet(type,seq,flags,payload){
 const bytes=Buffer.alloc(payload.length+10);bytes.set([77,51,1,type,seq,flags,payload.length,0]);bytes.set(payload,8);
 bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0,-2)),bytes.length-2);return bytes;
}
const cell=Buffer.from([7,0,0x81,0x42,0x24,0x18,0x18,0x24,0x42,0x81,0x10,1]);
const sound=Buffer.alloc(26);sound[1]=0x34;sound[2]=0x12;sound[5]=0x41;sound[7]=0xf0;sound[25]=15;
const packets=[packet(1,0x33,0x0b,cell),packet(2,0x34,0x21,sound),packet(1,0x35,8,cell),packet(2,0x36,0x21,sound)];
for(const [name,load] of [['Doom',loadVmTerminal]]){
 const {buildMpe3TitleTerminal,MPE3_TITLE_TERMINAL_STATE:state}=await load(path.join(root,'Source/VM/client'),{videoSelectors:name==='Doom',musicPackets:name==='Doom'});
 const program=buildMpe3TitleTerminal({gameplay:true,enable1351Mouse:false,packetReplay:true,statusRecovery:true});
 function run({fault='none',faultIndex=1,drop=0,noResponse=false,badDma=false}={}){
  let index=0,started=false,requests=0,waiting=false,polls=0,replays=0;
  const acks=[];
  const publish=c=>{c.ram.set(packets[index],0xdf00);c.ram[0xdff7]=packets[index][4];c.ram[0xdff5]=2;};
  const service={onWrite(c,a,v){
   if(a===0xdff4&&v===1&&!started){started=true;publish(c);}
   if(a===0xdff4&&v===6&&started){requests++;if(requests>drop)waiting=true;}
   if(a===0xdff6&&started){assert.equal(v,packets[index][4]);acks.push(v);waiting=false;
    if(++index<packets.length)publish(c);}
  },onRead(c,a){
   if(waiting&&!noResponse&&a===0x02f0&&++polls>=17){
    waiting=false;polls=0;replays++;c.ram.set(packets[index],program.stageAddress);
    if(badDma)c.ram[program.stageAddress+8]^=8;
    c.ram[0x02f0]=0xa5;c.ram[0xdff5]=0x12;
   }
  }};
  const cpu=new C64TerminalCpu(program,service,{rasterInterruptPeriod:2000,recordWrites:false});
  const read=cpu.read.bind(cpu);cpu.read=a=>{
   const value=read(a);if(!started||index!==faultIndex)return value;
   if(fault==='crc'&&a===0xdf0c)return value^8;
   if(fault==='length'&&a===0xdf06)return 255;
   if(fault==='commit'&&a===0xdff7)return value^8;
   return value;
  };
  cpu.runUntil(c=>acks.length===packets.length||c.pc===program.labels.terminal_error_hold,10_000_000);
  return {cpu,acks,requests,replays};
 }
 test(name+' normal packets never request replay',()=>{const r=run();assert.equal(r.requests,0);assert.equal(r.acks.length,4);});
 for(const fault of ['crc','length','commit'])for(const faultIndex of [0,1])
  test(`${name} persistent ${fault} corruption recovers ${faultIndex?'during gameplay':'before IRQ startup'}`,()=>{
   const r=run({fault,faultIndex});assert.deepEqual(r.acks,[0x33,0x34,0x35,0x36]);assert.equal(r.replays,1);assert.equal(r.cpu.ram[state.error],0);
  });
 test(name+' lost command is resent',()=>{const r=run({fault:'crc',drop:1});assert.equal(r.requests,2);assert.equal(r.acks.length,4);});
 test(name+' damaged RAM replay is never ACKed',()=>{const r=run({fault:'crc',badDma:true});assert.equal(r.replays,3);assert.deepEqual(r.acks,[0x33]);assert.equal(r.cpu.ram[state.error],6);});
 test(name+' unavailable DMA/old firmware has a bounded failure',()=>{const r=run({fault:'crc',noResponse:true});assert.deepEqual(r.acks,[0x33]);assert.equal(r.cpu.ram[state.error],12);});
}
