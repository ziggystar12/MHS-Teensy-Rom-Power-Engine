// Independent VICE execution checks the offline converter's final SID state.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const [input,stream,outArg]=process.argv.slice(2);assert.ok(input&&stream&&outArg);
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(outArg);fs.mkdirSync(out,{recursive:true});
const sid=fs.readFileSync(input),music=fs.readFileSync(stream);assert.equal(music[5],0,'Compare unadjusted PAL stream');
let offset=sid.readUInt16BE(6),load=sid.readUInt16BE(8);if(!load){load=sid.readUInt16LE(offset);offset+=2;}
const init=sid.readUInt16BE(10)||load,play=sid.readUInt16BE(12);
fs.writeFileSync(path.join(out,'tune.prg'),Buffer.concat([Buffer.from([load&255,load>>8]),sid.subarray(offset)]));
const vice=process.env.VICE_EXE;assert.ok(vice,'Set VICE_EXE to the x64sc executable');
for(const count of [1,852,music.readUInt32LE(12)]){
 const dir=path.join(out,String(count));fs.mkdirSync(dir,{recursive:true});const file=n=>path.join(dir,n).replaceAll('\\','/');
 const w=(n,s)=>fs.writeFileSync(file(n),s.join('\n')+'\n');
 const bytes=b=>b.map(x=>x.toString(16).padStart(2,'0')).join(' ');
 // Counter at $0400, wrapper at $0300; neither overlaps the supplied tune.
 const code=[0xa9,0,0xa2,0,0xa0,0,0x20,play&255,play>>8,0xad,0,4,0xd0,3,0xce,1,4,0xce,0,4,0xad,0,4,0x0d,1,4,0xd0,0xe4,0xea];
 w('start.mon',['bank cpu',`load "${path.join(out,'tune.prg').replaceAll('\\','/')}" 0`,
   `> 0300 a9 00 a2 00 a0 00 20 ${bytes([init&255,init>>8])} ea`,'break $0309',`command 1 "playback \\"${file('play.mon')}\\""`,'g $0300']);
 w('play.mon',['disable 1',`> 0300 ${bytes(code)}`,`> 0400 ${bytes([count&255,count>>8])}`,
   'break $031c',`command 2 "playback \\"${file('done.mon')}\\""`,'g $0300']);
 w('done.mon',['disable 2',`bsave "${file('sid.bin')}" 0 $d400 $d418`,'quit']);
 const r=spawnSync(vice,['-default','-pal','-console','-directory',path.dirname(path.dirname(vice)),'-initbreak','reset','-warp','+sound',
   '-moncommands',file('start.mon'),'-limitcycles','40000000'],{cwd:dir,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1000000});
 fs.writeFileSync(file('vice.log'),(r.stdout??'')+(r.stderr??''));assert.ifError(r.error);assert.equal(r.status,0);
 assert.deepEqual(fs.readFileSync(file('sid.bin')),music.subarray(32+(count-1)*28+1,32+(count-1)*28+26),'VICE SID mismatch at tick '+count);
}
console.log('PASS original SID player in independent VICE matches all 25 converted registers at tick 1, loop entry and loop end');
