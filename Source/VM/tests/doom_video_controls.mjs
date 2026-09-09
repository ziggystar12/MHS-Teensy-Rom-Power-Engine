// Actual CIA matrix -> emitted Doom keyboard/FIFO -> checksum-protected host
// envelope. This is not a physical bus or VIC timing test.
import assert from 'node:assert/strict';
import path from 'node:path';
import {C64TerminalCpu} from './helpers/c64-terminal-cpu.mjs';
import {loadVmTerminal} from '../client/host/stream-terminal.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
const {buildMpe3TitleTerminal}=await loadVmTerminal(path.join(root,'Source/VM/client'),{videoSelectors:true,musicPackets:true});
const program=buildMpe3TitleTerminal({gameplay:true,enable1351Mouse:false,packetReplay:true,statusRecovery:true});
const l=program.labels,mods=[[7,2],[7,5]],sent=[];
let acknowledge=true;
const cpu=new C64TerminalCpu(program,{onWrite(c,a,v){
  if(a!==0xdff4||v!==3)return;
  const p=[c.ram[0xdff8],c.ram[0xdff9],c.ram[0xdffa],c.ram[0xdffd],c.ram[0xdffe]];
  assert.equal(p.reduce((a,b)=>a^b,0xa5),c.ram[0xdfff]);sent.push(p);
  if(acknowledge)c.ram[0xdffc]=p[4];
}},{rasterInterruptPeriod:0,recordWrites:false});
function call(name){cpu.sp=0xfd;cpu.push(0x7f);cpu.push(0xfe);cpu.pc=l[name];cpu.runUntil(c=>c.pc===0x7fff,100000);}
function scan(keys){cpu.controls.matrix.fill(0);for(const [r,c] of keys)cpu.controls.matrix[r]|=1<<c;call('dos_capture_input');}
function drain(){for(let n=0;n<34;n++)call('sample_game_input');}
function reset(){call('game_input_init');cpu.ram[0xdffc]=0;scan([]);drain();sent.length=0;}
const selectors=()=>sent.filter(p=>p[3]===0x90);
// Both standards use the exact same CRT. Metadata goes first, needs no key
// press, and is immutable across retries while real controls queue behind it.
for(const [saved,standard] of [[0,1],[1,0],[255,0]]){
  cpu.ram[0x02d6]=saved;call('game_input_init');cpu.ram[0xdffc]=0;sent.length=0;
  acknowledge=false;call('sample_game_input');const first=sent.at(-1);
  assert.deepEqual(first.slice(0,4),[0,standard,0,0x91]);
  scan([]);scan([[1,1]]);call('sample_game_input');assert.deepEqual(sent.at(-1),first);
  acknowledge=true;cpu.ram[0xdffc]=first[4];drain();
  assert.deepEqual(sent.at(-1).slice(0,4),[119,17,0,0x80]);
}
for(const [column,mode,pcScan] of [[4,0,59],[5,1,61],[6,2,63],[3,3,65]]){
  reset();scan([[0,column]]);drain();assert.equal(selectors().length,0);
  assert.equal(sent.at(-1)[1],pcScan,'plain F-key stays PC input');
  for(const keys of [[[0,column],mods[0]],[[0,column],mods[1]],
    [[0,column],...mods,[1,7]],[[0,column],...mods,[6,4]]]){
    reset();scan(keys);drain();assert.equal(selectors().length,0,'requires both modifiers and no Shift');
  }
  reset();scan([[0,column],...mods]);drain();assert.deepEqual(selectors().map(p=>p.slice(0,4)),[[0,mode,0,0x90]]);
  assert.equal(sent.length,1,'selector does not leak a PC key/fire/cursor snapshot');
  scan([[0,column],...mods]);scan([[0,column]]);drain();assert.equal(sent.length,1,'held key/modifier-first release does not retrigger');
  scan([]);drain();assert.equal(sent.at(-1)[3],0x80,'release resumes ordinary controls');
}
reset();scan([[0,3],[0,6],...mods]);drain();assert.equal(selectors().length,0,'multiple F keys rejected');
// Pending input is frozen across resend while another mode queues behind it.
reset();acknowledge=false;scan([[0,6],...mods]);call('sample_game_input');const frozen=sent.at(-1);
scan([]);scan([[0,3],...mods]);call('sample_game_input');assert.deepEqual(sent.at(-1),frozen);
acknowledge=true;cpu.ram[0xdffc]=frozen[4];drain();assert.equal(selectors().at(-1)[1],3);
// Even a released short tap survives a full capture queue.
reset();cpu.ram[l.dos_queue_head]=0;cpu.ram[l.dos_queue_tail]=31;
scan([[0,6],...mods]);scan([]);assert.equal(cpu.ram[l.dos_video_choice],2);
cpu.ram[l.dos_queue_head]=31;scan([]);drain();assert.equal(selectors().at(-1)[1],2);
reset();scan([[1,1]]);drain();assert.deepEqual(sent.at(-1).slice(0,4),[119,17,0,0x80]);
scan([]);cpu.controls.port2Bits=17;scan([]);drain();assert.equal(sent.at(-1)[2],17);
console.log(`PASS Doom PAL/NTSC metadata and retries, F1/F3/F5/F7 selectors, ghost-safe chords, Shift/plain keys, held/released, immutable retry, full FIFO, movement/joystick; code end $${program.codeEnd.toString(16)}`);
