#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const options={};
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];if(!['--boot-bank','--output','--manifest','--id'].includes(k)||!v)throw new Error(`Unknown/incomplete option ${k}`);options[k]=k==='--id'?v:path.resolve(v);}
const id=options['--id']??'NESVM';if(!/^[A-Z][A-Z0-9]{0,22}$/.test(id))throw Error('Invalid package ID');
const inputProtocol=id==='AGIVM'?'AGI-INPUT-V1':id==='DOSVM'?'DOS-INPUT-V2':'NES-INPUT-V1';
const audioProtocol=id==='AGIVM'?'AGI-SID-V1':id==='DOSVM'?'DOS-SID-V1':'NES-SID-V1';
for(const k of ['--boot-bank','--output','--manifest'])if(!options[k])throw new Error(`${k} is required`);
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
const crc32=b=>{let c=0xffffffff;for(const n of b)c=(c>>>8)^crcTable[(c^n)&255];return(c^0xffffffff)>>>0;};
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const boot=fs.readFileSync(options['--boot-bank']);if(boot.length!==0x4000)throw new Error('boot bank must be exactly 16 KiB');
const descriptor=Buffer.alloc(128);descriptor.write('VMH1',0,'ascii');descriptor[4]=2;descriptor[5]=descriptor.length;descriptor[6]=3;
descriptor.write(id,16,'ascii');descriptor.write('/VMS/'+id,48,'ascii');descriptor.write(inputProtocol,80,'ascii');
descriptor.write(audioProtocol,112,'ascii');
descriptor.writeUInt32LE(crc32(boot),8);
descriptor.writeUInt32LE(crc32(descriptor.subarray(0,124)),124);
const header=Buffer.alloc(0x40);header.write('C64 CARTRIDGE   ',0,'ascii');header.writeUInt32BE(0x40,16);header.writeUInt16BE(0x0100,20);header.writeUInt16BE(0x20,22);header[24]=1;header.write('MHS VM CLIENT ABI2',32,'ascii');
const chip=(bank,address,payload)=>{if(payload.length!==0x2000)throw new Error('CHIP payload must be 8 KiB');const h=Buffer.alloc(16);h.write('CHIP');h.writeUInt32BE(0x2010,4);h.writeUInt16BE(2,8);h.writeUInt16BE(bank,10);h.writeUInt16BE(address,12);h.writeUInt16BE(0x2000,14);return Buffer.concat([h,payload]);};
const native=Buffer.alloc(0x2000);descriptor.copy(native);
const crt=Buffer.concat([header,chip(0,0x8000,boot.subarray(0,0x2000)),chip(0,0xa000,boot.subarray(0x2000)),chip(1,0x8000,native)]);
if(crt.length!==0x6070)throw new Error('unexpected NESVM CRT length');
fs.mkdirSync(path.dirname(options['--output']),{recursive:true});fs.writeFileSync(options['--output'],crt);
const manifest={format:'VMH1',protocol:2,packageId:id,nativeLauncherId:'MHS VM CLIENT ABI2',cartridge:options['--output'],cartridgeBytes:crt.length,
  cartridgeSha256:digest(crt),bootBankSha256:digest(boot),descriptorBytes:descriptor.length,descriptorCrc32:descriptor.readUInt32LE(124),
  packageRoot:'/VMS/'+id,inputProtocol,audioProtocol,audioPacketBytes:id==='AGIVM'?37:id==='DOSVM'?27:26,basicSid:true,chipBanks:[0,0,1],mailboxBank:58,mailboxChipRecords:0};
fs.mkdirSync(path.dirname(options['--manifest']),{recursive:true});fs.writeFileSync(options['--manifest'],`${JSON.stringify(manifest,null,2)}\n`);
console.log(`Built ${options['--output']} ${crt.length} bytes SHA-256 ${manifest.cartridgeSha256}`);
