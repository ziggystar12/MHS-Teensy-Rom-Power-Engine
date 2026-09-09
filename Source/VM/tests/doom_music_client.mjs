import assert from 'node:assert/strict';
import path from 'node:path';
import {loadVmTerminal} from '../client/host/stream-terminal.mjs';
import {C64TerminalCpu} from './helpers/c64-terminal-cpu.mjs';
import {crc16Ccitt} from './helpers/crc16.mjs';
const {buildMpe3TitleTerminal,MPE3_TITLE_TERMINAL_STATE:s}=await loadVmTerminal(path.resolve('Source/VM/client'),{videoSelectors:true,musicPackets:true});
const p=buildMpe3TitleTerminal({gameplay:true,enable1351Mouse:false,packetReplay:true,statusRecovery:true});
const wire=(type,seq,flags,payload)=>{const b=Buffer.alloc(payload.length+10);b.set([77,51,1,type,seq,flags,payload.length,0]);b.set(payload,8);b.writeUInt16LE(crc16Ccitt(b.subarray(0,-2)),b.length-2);return b;};
const sid=Buffer.alloc(26);sid[0]=1;sid[1]=34;sid[2]=18;sid[5]=0x41;sid[7]=0xf0;sid[25]=15;
const packets=[wire(1,1,0x0b,Buffer.from([0,0,0,0,0,0,0,0,0,0,0x10,1])),wire(2,2,0x21,sid),...Array.from({length:20},(_,n)=>wire(2,n+3,0x20,sid))];
let index=0,started=false,consumed,videoWrites=0,replays=0;
const service={onWrite(c,a,v){
 if(index>=2&&index<packets.length&&[0xdd00,0xd018,0xd011,0xd016,0xd015].includes(a))videoWrites++;
 if(a===0xdff4&&v===1&&!started){started=true;publish(c);}
 if(a===0xdff4&&v===6){replays++;c.ram.set(packets[index],p.stageAddress);c.ram[0x02f0]=0xa5;}
 if(a===0xdff6&&started){assert.equal(v,index+1);index++;
  if(index===2){consumed=c.ram[s.consumedTicks];c.ram[0x02e3]=1;c.ram[0x02e8]=1;c.ram[0xdd00]=1;c.ram[0xd018]=0x38;c.ram[0xd016]=8;}
  if(index===3)consumed=c.ram[s.consumedTicks]; // Previous frame's post-ACK wait has now finished.
  if(index>3)assert.equal(c.ram[s.consumedTicks],consumed,'audio-only must not wait a display frame');
  if(index<packets.length)publish(c);
 }
}};
function publish(c){c.ram.set(packets[index],0xdf00);c.ram[0xdff7]=index+1;c.ram[0xdff5]=2;}
const cpu=new C64TerminalCpu(p,service,{rasterInterruptPeriod:2000,recordWrites:false});
const read=cpu.read.bind(cpu);cpu.read=a=>{const v=read(a);return index===10&&a===0xdf0c?v^1:v;};
cpu.runUntil(c=>index===packets.length||c.pc===p.labels.terminal_error_hold,1000000);
assert.equal(index,packets.length);assert.equal(cpu.ram[s.error],0);assert.equal(videoWrites,0);assert.equal(replays,1);
assert.equal(cpu.ram[0xdd00],1);assert.equal(cpu.ram[0xd018],0x38);assert.equal(cpu.ram[0x02e3],1);assert.equal(cpu.ram[0xd400],34);
console.log('PASS 20 music-only packets preserve F5 bank/kernel/VIC state, avoid frame waits, and apply SID registers through actual 6510 receiver');
