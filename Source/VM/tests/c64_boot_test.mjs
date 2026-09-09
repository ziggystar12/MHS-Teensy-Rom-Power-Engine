#!/usr/bin/env node
// Boot the actual Doom CRT from reset in VICE. With no Teensy service the
// correct endpoint is the terminal's bounded WAIT error, with SID silent.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadVmTerminal} from '../client/host/stream-terminal.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const options={crt:path.join(root,'build/doom-client/SD/DOOMVM.crt'),manifest:path.join(root,'build/doom-client/client.json'),
  out:path.join(root,'build/doom-client/c64-boot'),standard:'ntsc',vice:process.env.MPE_VICE??path.join(root,'build/toolchain/vice/x64sc.exe')};
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i].replace(/^--/,'');assert.ok(Object.hasOwn(options,key)&&process.argv[i+1],`Unknown/incomplete option ${key}`);options[key]=process.argv[i+1];}
assert.ok(['pal','ntsc'].includes(options.standard));for(const key of ['crt','manifest','out','vice'])options[key]=path.resolve(options[key]);
fs.mkdirSync(options.out,{recursive:true});const manifest=JSON.parse(fs.readFileSync(options.manifest,'utf8'));
assert.equal(manifest.format,'M3TP-DOOMVM-terminal');
const {buildMpe3TitleTerminal,MPE3_TITLE_TERMINAL_STATE:stateAddress}=await loadVmTerminal(path.join(root,'Source/VM/client'),{videoSelectors:manifest.videoSelectors??false,musicPackets:manifest.musicPackets??false});
const terminal=buildMpe3TitleTerminal({gameplay:true,enable1351Mouse:false,packetReplay:manifest.packetReplay??false,statusRecovery:manifest.statusRecovery??false,diagnosticTitle:manifest.diagnosticTitle,diagnosticFooter:manifest.diagnosticFooter});
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(digest(terminal.prg),manifest.terminalPrgSha256);
const crt=fs.readFileSync(options.crt),bank0=Buffer.alloc(0x4000,0xff);assert.equal(crt.subarray(0,16).toString('ascii'),'C64 CARTRIDGE   ');
const banks=[];for(let p=crt.readUInt32BE(16);p<crt.length;){assert.equal(crt.subarray(p,p+4).toString(),'CHIP');const n=crt.readUInt32BE(p+4),bank=crt.readUInt16BE(p+10),address=crt.readUInt16BE(p+12);assert.equal(n,0x2010);if(bank===0)crt.copy(bank0,address-0x8000,p+16,p+n);banks.push(bank);p+=n;}
assert.ok(!banks.includes(58));const payload=terminal.prg.subarray(2);assert.deepEqual(bank0.subarray(0xfd,0xfd+payload.length),payload);
const start=Buffer.from([0xa9,1,0x8d,0xf4,0xdf]),offset=payload.indexOf(start);assert.ok(offset>=0&&payload.indexOf(start,offset+1)<0);const startWritten=0x0801+offset+start.length;
const file=n=>path.join(options.out,n),slash=s=>s.replaceAll('\\','/'),hex=n=>`$${n.toString(16).padStart(4,'0')}`;
const save=(n,a,b)=>`bsave "${slash(file(n))}" 0 ${hex(a)} ${hex(b)}`;const write=(n,lines)=>fs.writeFileSync(file(n),lines.join('\n')+'\n');
for(const n of ['monitor.log','vice.log','stdout.txt','stderr.txt','payload.bin','start-io2.bin','start-sid.bin','state.bin','screen.bin','timeout-sid.bin','applied-sid.bin','result.json','screen.txt'])fs.rmSync(file(n),{force:true});
const play=(id,n)=>`command ${id} "playback \\"${slash(file(n))}\\""`;
const sid=Buffer.alloc(25);sid[0]=0x34;sid[1]=0x12;sid[2]=0x00;sid[3]=0x08;sid[4]=0x41;sid[5]=0x00;sid[6]=0xf0;sid[24]=0x0f;
const bytes=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join(' '),stage=terminal.stageAddress,applySid=terminal.labels.apply_sid;
write('reset.mon',['bank cpu','break $0810',play(1,'entry.mon'),'x']);
write('entry.mon',['disable 1',save('payload.bin',0x0801,terminal.codeEnd-1),`break ${hex(startWritten)}`,play(2,'start.mon'),'x']);
write('start.mon',['disable 2',save('start-io2.bin',0xdff0,0xdfff),save('start-sid.bin',0xd400,0xd418),`break ${hex(terminal.labels.terminal_error_hold)}`,play(3,'timeout.mon'),'x']);
write('timeout.mon',['disable 3',save('state.bin',0x02a0,0x02df),save('screen.bin',0x0400,0x07e7),save('timeout-sid.bin',0xd400,0xd418),
  `> ${hex(stage+6).slice(1)} 1a`,`> ${hex(stage+8).slice(1)} 01`,`> ${hex(stage+9).slice(1)} ${bytes(sid)}`,
  `> 3000 20 ${(applySid&255).toString(16).padStart(2,'0')} ${(applySid>>8).toString(16).padStart(2,'0')} ea`,`break $3003`,play(4,'sid.mon'),'g $3000']);
write('sid.mon',['disable 4',save('applied-sid.bin',0xd400,0xd418),'quit']);
const vice=spawnSync(options.vice,['-default',`-${options.standard}`,'-console','-directory',path.dirname(path.dirname(options.vice)),'-initbreak','reset','-warp','+sound','+easyflashcrtwrite','-cartcrt',options.crt,'-monlogname',file('monitor.log'),'-monlog','-moncommands',file('reset.mon'),'-limitcycles','40000000','-logfile',file('vice.log')],{cwd:options.out,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
fs.writeFileSync(file('stdout.txt'),vice.stdout??'');fs.writeFileSync(file('stderr.txt'),vice.stderr??'');assert.ifError(vice.error);assert.equal(vice.status,0,`VICE failed; inspect ${options.out}`);
assert.deepEqual(fs.readFileSync(file('payload.bin')),payload);const io2=fs.readFileSync(file('start-io2.bin'));assert.equal(io2.subarray(0,4).toString(),'M3TP');assert.equal(io2[4],1);
assert.equal(io2[11],options.standard==='ntsc'?0x83:0x82,'START must publish the detected C64 standard and border-stream capability');
const silent=Buffer.alloc(25);assert.deepEqual(fs.readFileSync(file('start-sid.bin')),silent);assert.deepEqual(fs.readFileSync(file('timeout-sid.bin')),silent);
assert.deepEqual(fs.readFileSync(file('applied-sid.bin')),sid,'actual C64 SID receiver did not apply the 25-register body');
const state=fs.readFileSync(file('state.bin')),value=a=>state[a-0x02a0];assert.equal(value(stateAddress.error),2);assert.equal(value(stateAddress.startupStage),3);assert.equal(value(stateAddress.baseReady),0);
const screen=fs.readFileSync(file('screen.bin')),decode=b=>[...b].map(v=>String.fromCharCode(v<32?v+64:v)).join('');const lines=Array.from({length:25},(_,y)=>decode(screen.subarray(y*40,y*40+40)).trimEnd());
assert.equal(lines[0],manifest.diagnosticTitle);assert.equal(lines[5],'NO PACKET - SERVICE OR LINK STALLED');fs.writeFileSync(file('screen.txt'),lines.join('\n')+'\n');
const report={passed:true,crt:options.crt,sha256:digest(crt),standard:options.standard,terminalBytes:terminal.prg.length,startCommand:'M3TP',boundedNoServiceError:true,sidSilentWithoutPackets:true,sidPacketReplay:true,
  scope:'C64 CPU and memory-map proof in VICE; no Teensy service, audible SID output, custom-bus timing, or physical acceptance'};
fs.writeFileSync(file('result.json'),JSON.stringify(report,null,2)+'\n');console.log(`DoomVM C64 boot passed (${options.standard}): reset -> terminal -> M3TP START -> bounded WAIT. ${file('result.json')}`);
