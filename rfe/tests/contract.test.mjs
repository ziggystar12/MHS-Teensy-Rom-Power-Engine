// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TARGET,validateTargetContract,validateHostImage} from '../lib/contract.mjs';
import {decodeHostHex} from '../lib/image.mjs';

function host(bytes=0x2000){
  const p=Buffer.alloc(bytes),base=TARGET.flash.slot0Base;
  p.writeUInt32LE(0x42464346,0);p.writeUInt32LE(0x432000d1,0x1000);
  p.writeUInt32LE(base+0x1101,0x1004);p.writeUInt32LE(base+0x1020,0x1010);
  p.writeUInt32LE(base+0x1000,0x1014);p.writeUInt32LE(base,0x1020);p.writeUInt32LE(bytes,0x1024);
  return p;
}
const record=(address,type,data=[])=>{
  const row=Buffer.from([data.length,address>>8,address&255,type,...data,0]);
  row[row.length-1]=-row.reduce((sum,v)=>sum+v,0)&255;return ':'+row.toString('hex').toUpperCase();
};
const upper=record(0,4,[0x60,0x76]),eof=record(0,1);
const hex=(...rows)=>[upper,...rows,eof].join('\n')+'\n';

test('revision 3 preserves ABI2 budgets and remains explicitly noninstallable',()=>{
  assert.equal(validateTargetContract().installable,false);
  assert.equal(TARGET.flash.payloadBytes+TARGET.flash.metadataBytes,TARGET.flash.slotBytes);
  assert.equal(TARGET.flash.slot0Base+TARGET.flash.payloadBytes,TARGET.flash.metadataBase);
  assert.equal(TARGET.flash.metadataBase+4096,TARGET.flash.reserveBase);
  assert.equal(Object.isFrozen(TARGET.flash),true);
  for(const mutate of [t=>t.installable=true,t=>t.flash.slot0Base=0x60700000,t=>t.vm.abi=3,
    t=>t.requirements.sources.push('USB'),t=>t.wire.headerBytes=128,t=>t.launch.encoding='invented',t=>t.blockers.pop()]){
    const changed=structuredClone(TARGET);mutate(changed);assert.throws(()=>validateTargetContract(changed));
  }
});
test('valid raw host envelopes admit slot0 and the exact 380KiB boundary only',()=>{
  for(const bytes of [0x2000,380*1024]){
    const p=host(bytes),report=validateHostImage(p);
    assert.equal(report.imageEnd,TARGET.flash.slot0Base+bytes);
    assert.equal(report.bootData.bytes,bytes);assert.equal(report.installable,false);
    assert.equal(report.blockers.length,TARGET.blockers.length);assert.match(report.sha256,/^[a-f0-9]{64}$/);
  }
});
test('raw validation rejects relocated, truncated, overlong and inconsistent startup envelopes',()=>{
  const mutations=[p=>p.writeUInt32LE(0,0),p=>p.writeUInt32LE(0,0x1000),
    p=>p.writeUInt32LE(TARGET.flash.slot0Base+0x1100,0x1004),
    p=>p.writeUInt32LE(0x60701101,0x1004),p=>p.writeUInt32LE(TARGET.flash.payloadLimit+1,0x1004),
    p=>p.writeUInt32LE(1,0x1008),p=>p.writeUInt32LE(1,0x100c),
    p=>p.writeUInt32LE(0x60701020,0x1010),p=>p.writeUInt32LE(0x60701000,0x1014),
    p=>p.writeUInt32LE(TARGET.flash.metadataBase,0x1018),p=>p.writeUInt32LE(1,0x101c),
    p=>p.writeUInt32LE(0x60700000,0x1020),p=>p.writeUInt32LE(p.length-4,0x1024),p=>p.writeUInt32LE(1,0x1028)];
  for(const mutate of mutations){const p=host();mutate(p);assert.throws(()=>validateHostImage(p));}
  assert.throws(()=>validateHostImage(host().subarray(0,4096)),/shorter/);
  assert.throws(()=>validateHostImage(Buffer.concat([host(),Buffer.alloc(4)])),/length differs/);
  assert.throws(()=>validateHostImage(host(384*1024)),/overlaps metadata/);
  assert.throws(()=>validateHostImage('not bytes'),/binary/);
});
test('strict HEX preserves sparse erased gaps and accepts CRLF, with no .trx codec',()=>{
  const decoded=decodeHostHex(hex(record(0,0,[1,2,3,4]),record(12,0,[5,6,7,8])).replaceAll('\n','\r\n'));
  assert.deepEqual([...decoded.payload],[1,2,3,4,255,255,255,255,255,255,255,255,5,6,7,8]);
  assert.equal(decoded.report.dataBytes,8);assert.equal(decoded.report.installable,false);
});
test('strict HEX rejects corruption, omitted EOF, overlap, unsupported and out-of-slot records',()=>{
  const data=record(0,0,[1,2,3,4]),valid=hex(data);
  for(const bad of [valid.replace(data,data.slice(0,-2)+'00'),valid.replace(':04',':05'),
    [upper,data].join('\n'),valid+data,valid+eof,hex(data,data),hex(record(0,0)),
    hex(record(0,2,[0x60,0x76])),hex(record(0xfffe,0,[1,2,3,4])),
    [record(0,4,[0x60,0x70]),data,eof].join('\n'),
    [upper,data,record(0,4,[0x60,0x7b]),record(0xf000,0,[1]),eof].join('\n'),
    hex(record(4,0,[1,2,3,4])),valid.replace(upper,':GG'),valid+' ',valid.replace(data,data+'\u00e9')])
    assert.throws(()=>decodeHostHex(bad));
});
test('HEX type05 uses linker ENTRY(ImageVectorTable), independently of the Thumb reset vector',()=>{
  const p=host(),rows=[];
  // Match the real linked host: ELF entry 60761000, ResetHandler 607615f1.
  p.writeUInt32LE(TARGET.flash.slot0Base+0x15f1,0x1004);
  for(let offset=0;offset<p.length;offset+=16)rows.push(record(offset,0,[...p.subarray(offset,offset+16)]));
  const entry=Buffer.alloc(4);entry.writeUInt32BE(TARGET.flash.slot0Base+TARGET.image.ivtOffset);
  const good=decodeHostHex(hex(...rows,record(0,5,entry)));
  assert.equal(validateHostImage(good.payload).entry,TARGET.flash.slot0Base+0x15f1);
  entry.writeUInt32BE(TARGET.flash.slot0Base+0x15f1);
  assert.throws(()=>decodeHostHex(hex(...rows,record(0,5,entry))),/linker ImageVectorTable/);
  assert.throws(()=>decodeHostHex(hex(...rows,record(1,5,entry))),/invalid/);
});
test('actual linked host HEX passes decoding and raw-envelope validation',{
  skip:!process.env.RFE_HOST_HEX&&'Set RFE_HOST_HEX to validate a compiled host artifact'
},()=>{
  const decoded=decodeHostHex(fs.readFileSync(process.env.RFE_HOST_HEX));
  const report=validateHostImage(decoded.payload);
  assert.equal(decoded.report.startEntry,TARGET.flash.slot0Base+TARGET.image.ivtOffset);
  assert.equal(report.bootData.bytes,decoded.report.imageBytes);
  assert.equal(report.sha256,decoded.report.sha256);
  assert.equal(report.installable,false);
});
