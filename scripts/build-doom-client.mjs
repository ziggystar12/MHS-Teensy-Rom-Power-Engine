// SPDX-License-Identifier: GPL-2.0-or-later
// Build the universal PAL/NTSC C64 launcher. No game data is needed.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {loadVmTerminal} from '../Source/VM/client/host/stream-terminal.mjs';
import {buildCartridgeBootBank} from '../Source/VM/client/host/install-boot-bank.mjs';
import {crc32} from './vm-image.mjs';
const root=path.resolve(import.meta.dirname,'..');
const out=path.resolve(process.argv[2]??path.join(root,'build/doom-client'));
const write=(name,data)=>{const p=path.join(out,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);};
const {buildMpe3TitleTerminal}=await loadVmTerminal(path.join(root,'Source/VM/client'),{videoSelectors:true,musicPackets:true});
const diagnosticTitle='DOOMVM E1M1 - WAITING FOR HOST';
const diagnosticFooter='CTRL FIRE  SPACE USE  RESET TO GUI';
const terminal=buildMpe3TitleTerminal({gameplay:true,enable1351Mouse:false,packetReplay:true,statusRecovery:true,diagnosticTitle,diagnosticFooter});
const boot=buildCartridgeBootBank(terminal.prg,{loadingText:'MHS DOOMVM E1M1',cartridgeFormat:'easyflash-1m'});
assert.equal(boot.length,16384);
const descriptor=Buffer.alloc(128);descriptor.write('VMH1');descriptor[4]=2;descriptor[5]=128;descriptor[6]=3;
descriptor.writeUInt32LE(crc32(boot),8);descriptor.write('DOOMVM',16);descriptor.write('/VMS/DOOMVM',48);
// Retain the existing input and sound protocol identifiers.
descriptor.write('DOS-INPUT-V2',80);descriptor.write('DOS-SID-V1',112);
descriptor.writeUInt32LE(crc32(descriptor.subarray(0,124)),124);
const header=Buffer.alloc(64);header.write('C64 CARTRIDGE   ');header.writeUInt32BE(64,16);
header.writeUInt16BE(0x100,20);header.writeUInt16BE(0x20,22);header[24]=1;header.write('MHS VM CLIENT ABI2',32);
const chip=(bank,address,bytes)=>{assert.equal(bytes.length,8192);const h=Buffer.alloc(16);h.write('CHIP');
    h.writeUInt32BE(8208,4);h.writeUInt16BE(2,8);h.writeUInt16BE(bank,10);h.writeUInt16BE(address,12);h.writeUInt16BE(8192,14);return Buffer.concat([h,bytes]);};
const native=Buffer.alloc(8192);descriptor.copy(native);
const crt=Buffer.concat([header,chip(0,0x8000,boot.subarray(0,8192)),chip(0,0xa000,boot.subarray(8192)),chip(1,0x8000,native)]);
assert.equal(crt.length,0x6070);
write('doomvm.prg',terminal.prg);
write('SD/DOOMVM.crt',crt);write('SD/VMS/DOOMVM/client.crt',crt);
write('SD/VMS/DOOMVM/manifest.vmi','VM1\nDOOMVM\ngbd\nengine.mvm\nclient.crt\nEND\n');
write('client.json',JSON.stringify({format:'M3TP-DOOMVM-terminal',diagnosticTitle,diagnosticFooter,
    terminalPrgSha256:crypto.createHash('sha256').update(terminal.prg).digest('hex'),
    stageAddress:terminal.stageAddress,codeEnd:terminal.codeEnd,labels:terminal.labels,
    packetReplay:true,statusRecovery:true,videoSelectors:true,musicPackets:true},null,2)+'\n');
console.log('Doom launcher written to '+path.join(out,'SD'));
