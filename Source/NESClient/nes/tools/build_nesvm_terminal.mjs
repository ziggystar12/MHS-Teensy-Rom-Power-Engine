#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {NES_INPUT} from './nes_terminal.mjs';
import {buildNesNuflixClient,nesNuflixState} from './nes_nuflix.mjs';
process.on('uncaughtException',error=>{console.error(error.message);process.exitCode=1;});

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const agiRoot=path.resolve(root,'vm/client');
const options={};
for(let i=2;i<process.argv.length;i+=2){
  const k=process.argv[i],v=process.argv[i+1];
  if(!['--output-prg','--output-boot-bank','--manifest'].includes(k)||!v)throw new Error(`Unknown/incomplete option ${k}`);
  options[k]=path.resolve(v);
}
for(const k of ['--output-prg','--output-boot-bank','--manifest'])if(!options[k])throw new Error(`${k} is required`);
const terminalSource=path.join(agiRoot,'host/mpe3-title-terminal.mjs');
const bootSource=path.join(agiRoot,'host/install-boot-bank.mjs');
for(const f of [terminalSource,bootSource])if(!fs.statSync(f,{throwIfNoEntry:false})?.isFile())throw new Error(`Missing shared source ${f}`);
const {buildCartridgeBootBank}=await import(pathToFileURL(bootSource).href);
const text={title:'NESVM - STANDARD / PAN / NUFLIX',footer:'FIRE:A POTX:B SPC:B RET:START SH:SEL',loading:'NESVM STANDARD PAN NUFLIX'};
const terminal=await buildNesNuflixClient({diagnosticTitle:text.title,diagnosticFooter:text.footer});
const boot=buildCartridgeBootBank(terminal.prg,{loadingText:text.loading,cartridgeFormat:'easyflash-1m'});
if(boot.length!==0x4000)throw new Error('NESVM boot bank must be exactly 16 KiB');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const write=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);};
write(options['--output-prg'],terminal.prg);write(options['--output-boot-bank'],boot);
const manifest={format:'M3TP-NESVM-terminal',diagnosticTitle:text.title,diagnosticFooter:text.footer,loadingText:text.loading,
  terminalPrg:options['--output-prg'],terminalPrgBytes:terminal.prg.length,terminalPrgSha256:digest(terminal.prg),
  bootBank:options['--output-boot-bank'],bootBankBytes:boot.length,bootBankSha256:digest(boot),
  codeEnd:terminal.codeEnd,stageAddress:terminal.stageAddress,labels:terminal.labels,inputProtocol:'MPE-HELD-VIDEO-V1',
  chunks:terminal.chunks.map(c=>({address:c.address,bytes:c.bytes.length,sha256:digest(c.bytes)})),
  inputFields:{...NES_INPUT,active:nesNuflixState(NES_INPUT.active),pending:nesNuflixState(NES_INPUT.pending),protocol:0x91,cameraProtocol:0x83},
  sharpDefault:false,videoModes:['Standard','Pan and scan','NUFLIX','Sharp'],videoDefault:0,nuflixF5:true,minimumFirmwareVersion:'1.2.6',
  videoSelector:'Commodore+Control+unshifted F1/F3/F5/F7',romDirectory:'/NESVM/ROMS',saveDirectory:'/NESVM/SAVES',
  audioProtocol:'NES-SID-V1',audioPacketBytes:26,audioScope:'basic NTSC SID register mapping',
  nesOverlaySha256:digest(fs.readFileSync(path.join(here,'nes_terminal.mjs'))),sharedTerminalSha256:digest(fs.readFileSync(terminalSource)),
  sharedBootSha256:digest(fs.readFileSync(bootSource))};
write(options['--manifest'],`${JSON.stringify(manifest,null,2)}\n`);
console.log(`Built NESVM terminal: ${terminal.prg.length} bytes, code end $${terminal.codeEnd.toString(16)}`);
