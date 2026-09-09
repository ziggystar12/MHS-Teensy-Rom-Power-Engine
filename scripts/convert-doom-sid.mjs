// Compile a bounded, single-SID PAL VBI tune to fixed-size SD music records.
// Executes the supplied player's documented 6502 code offline, not on Teensy.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {C64TerminalCpu} from '../Source/VM/tests/helpers/c64-terminal-cpu.mjs';
import {crc16Ccitt} from '../Source/VM/tests/helpers/crc16.mjs';
const [input,output,target='pal']=process.argv.slice(2);
assert.ok(input&&output&&['pal','ntsc'].includes(target),'Usage: node scripts/convert-doom-sid.mjs input.sid output.s3m [pal|ntsc]');
const sid=fs.readFileSync(input),word=n=>sid.readUInt16BE(n);
assert.ok(sid.length>=126&&sid.subarray(0,4).toString()==='PSID');
assert.equal(word(4),2,'Only PSID v2 supported');assert.equal(sid.readUInt32BE(18),0,'CIA/digi tunes unsupported');
assert.equal(word(118)&15,4,'Require standard PAL VBI tune');assert.equal(word(14),1,'Require single subtune');
assert.equal(word(16),1);assert.equal(sid[122]|sid[123],0,'Only one SID supported');
let offset=word(6),load=word(8);assert.ok(offset>=124&&offset<sid.length);
if(!load){load=sid.readUInt16LE(offset);offset+=2;}
const data=sid.subarray(offset),end=load+data.length,init=word(10)||load,play=word(12);
assert.ok(load>=0x0400&&end<=0xd000&&init>=load&&init<end&&play>=load&&play<end);
class SidCpu extends C64TerminalCpu {
  constructor(){const address=Buffer.from([load&255,load>>8]);super({prg:Buffer.concat([address,data]),labels:{entry:init}},null,{rasterInterruptPeriod:0,recordWrites:false});this.gates=0;this.sidWrites=[];}
  step(){switch(this.ram[this.pc]){
    case 0xe5:this.fetch();this.sbc(this.read(this.fetch()));return;
    case 0xf5:this.fetch();this.sbc(this.read((this.fetch()+this.x)&255));return;
    case 0xf9:this.fetch();this.sbc(this.read((this.fetchWord()+this.y)&65535));return;
    default:super.step();
  }}
  read(a){a&=65535;assert.ok(a<0xd000||a>=0xe000,'Tune reads hardware/ROM; unsupported');return this.ram[a];}
  write(a,v){a&=65535;v&=255;
    assert.ok((a>=2&&a<512)||(a>=load&&a<end)||(a>=0xd400&&a<=0xd418),'Tune writes outside its RAM/SID sandbox: '+a.toString(16));
    if(a>=0xd400&&a<=0xd418){const reg=a-0xd400;
      if([4,11,18].includes(reg)&&!(this.ram[a]&1)&&(v&1))this.gates|=1<<((reg-4)/7);
      this.sidWrites.push([reg,v]);}
    this.ram[a]=v;
  }
}
const cpu=new SidCpu();cpu.call(init,{maxInstructions:100000});
const frames=[],seen=new Map();let loop=0,maxInstructions=0;
for(let n=0;n<=60000;n++){
  const state=crypto.createHash('sha256').update(cpu.ram.subarray(2,256)).update(cpu.ram.subarray(load,end)).update(cpu.ram.subarray(0xd400,0xd419)).digest('hex');
  if(seen.has(state)){loop=seen.get(state);break;}
  assert.ok(n<60000,'No exact player-state loop within 20 minutes');seen.set(state,n);
  cpu.gates=0;cpu.sidWrites=[];const call=cpu.call(play,{maxInstructions:20000});maxInstructions=Math.max(maxInstructions,call.instructions);
  const frame=Buffer.alloc(28);frame[0]=cpu.gates;frame.set(cpu.ram.subarray(0xd400,0xd419),1);
  if(target==='ntsc')for(const base of [1,8,15])frame.writeUInt16LE(Math.round(frame.readUInt16LE(base)*985248/1022727),base);
  frame.writeUInt16LE(crc16Ccitt(frame.subarray(0,26)),26);frames.push(frame);
}
assert.ok(frames.length>50&&loop<frames.length&&frames.some(f=>f[25]&15));
const header=Buffer.alloc(32);header.write('M3SM');header[4]=1;header[5]=target==='ntsc'?1:0;header.writeUInt16LE(28,6);
header.writeUInt32LE(20000,8);header.writeUInt32LE(frames.length,12);header.writeUInt32LE(loop,16);
header.writeUInt16LE(crc16Ccitt(header.subarray(0,30)),30);
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,Buffer.concat([header,...frames]));
const text=n=>sid.subarray(n,n+32).toString('latin1').replace(/\0.*$/s,'');
const report={name:text(22),author:text(54),released:text(86),sourceSha256:crypto.createHash('sha256').update(sid).digest('hex'),
  outputSha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'),target,frames:frames.length,loopStart:loop,
  seconds:frames.length/50,loopSeconds:(frames.length-loop)/50,maxInstructionsPerTick:maxInstructions,load,init,play,
  scope:'SID register-frame rendition; no digi/CIA/RSID/multi-SID support; original tune remains private'};
fs.writeFileSync(output+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
