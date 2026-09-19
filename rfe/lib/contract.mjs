// SPDX-License-Identifier: MIT
// Build-side proposal contract. This is not an RFE package codec or TR loader.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const freeze=value=>{
  if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
};
export const TARGET=freeze(JSON.parse(fs.readFileSync(new URL('../target.json',import.meta.url),'utf8')));

export function validateTargetContract(target=TARGET){
  assert.equal(target.schemaVersion,1,'Unsupported RFE contract schema');
  assert.equal(target.proposalRevision,3,'Expected proposal revision 3');
  assert.equal(target.status,'development','RFE remains development-only');
  assert.equal(target.installable,false,'No authoritative installable RFE package exists');
  assert.deepEqual(target.flash,{slot0Base:0x60760000,slotBytes:384*1024,payloadBytes:380*1024,
    payloadLimit:0x607bf000,metadataBase:0x607bf000,metadataBytes:4096,reserveBase:0x607c0000,
    slot1Base:0x60700000,slot1Status:'reserved',eraseSectorBytes:4096},'Revision-3 flash partition differs');
  assert.deepEqual(target.vm,{abi:2,codeBase:0x18000,codeLimit:0x30000,codeBytes:96*1024,
    dataBase:0x20014000,dataLimit:0x20044000,dataBytes:192*1024,guestBase:0x20200000,guestBytes:512*1024},'Existing ABI-2 module budgets must remain unchanged');
  assert.deepEqual(target.image,{format:'teensy-linked-raw',flashConfigBytes:512,flashConfigMagic:0x42464346,
    ivtOffset:0x1000,ivtMagic:0x432000d1,bootDataOffset:0x1020,entryMinOffset:0x1000,entryMaxOffset:0x3000},'Linked image envelope differs');
  assert.deepEqual(target.requirements,{busOwnership:'fullDMA',sources:['SD'],associations:['mpe','nes','gb','gbc','gc','gg']});
  assert.equal(target.wire.format,null,'Package format remains unresolved');
  assert.equal(target.wire.headerBytes,null,'Do not infer a wire header size');
  assert.equal(target.wire.codecImplemented,false);
  assert.equal(target.bus.revision,null,'Upstream bus revision remains unresolved');
  assert.equal(target.bus.implemented,false);
  assert.equal(target.launch.eepromAddressCandidate,4235);
  assert.equal(target.launch.minBootIndicatorCandidate,4);
  assert.equal(target.launch.status,'provisional');
  assert.equal(target.launch.encoding,null);
  assert.equal(target.launch.eepromMapMagic,null);
  assert.deepEqual(target.blockers.map(blocker=>blocker.id),[
    'authoritative-header-codec','shared-bus-export','eeprom-launch-encoding-map',
    'crash-contract-legacy-abi-overlap','loader-hardware-validation']);
  for(const blocker of target.blockers)assert.ok(typeof blocker.detail==='string'&&blocker.detail.length);
  assert.deepEqual(target.acceptance,{linkedImageValidation:false,physicalHardware:false,installablePackage:false});
  return {passed:true,status:'development',installable:false,blockers:target.blockers};
}

// Verifies the existing Teensy linked-image envelope at the proposed slot0
// address. Metadata-sector bytes and any invented .trx header are excluded.
export function validateHostImage(input){
  validateTargetContract();
  assert.ok(input instanceof Uint8Array,'Host payload must be binary bytes');
  const payload=Buffer.from(input.buffer,input.byteOffset,input.byteLength);
  const {slot0Base:base,payloadBytes,payloadLimit}=TARGET.flash;
  const {ivtOffset,ivtMagic,bootDataOffset,flashConfigMagic,entryMinOffset,entryMaxOffset}=TARGET.image;
  assert.ok(payload.length>=bootDataOffset+12,'Host payload is shorter than BootData');
  assert.ok(payload.length<=payloadBytes,'Host payload overlaps metadata or exceeds slot0');
  assert.equal(payload.length%4,0,'Linked host payload must be word aligned');
  const word=offset=>payload.readUInt32LE(offset);
  assert.equal(word(0),flashConfigMagic,'Missing Teensy flash configuration magic');
  assert.equal(word(ivtOffset),ivtMagic,'Missing Teensy image vector magic');
  const entry=word(ivtOffset+4),entryAddress=entry-(entry&1);
  assert.ok((entry&1)&&entryAddress>=base+entryMinOffset&&entryAddress<=base+entryMaxOffset&&
    entryAddress+2<=base+payload.length,'Invalid slot0 Thumb startup entry');
  assert.equal(word(ivtOffset+8),0,'Reserved IVT word is nonzero');
  assert.equal(word(ivtOffset+12),0,'DCD startup is unsupported for this host image');
  assert.equal(word(ivtOffset+16),base+bootDataOffset,'BootData pointer differs from slot0 image');
  assert.equal(word(ivtOffset+20),base+ivtOffset,'IVT self pointer differs from slot0 image');
  const csf=word(ivtOffset+24);
  assert.ok(csf===0||(csf%4===0&&csf>=base+bootDataOffset+12&&csf+4<=base+payload.length),'CSF pointer outside host payload');
  assert.equal(word(ivtOffset+28),0,'Reserved IVT word is nonzero');
  const bootData={base:word(bootDataOffset),bytes:word(bootDataOffset+4),plugin:word(bootDataOffset+8)};
  assert.equal(bootData.base,base,'Host BootData base must be slot0');
  assert.equal(bootData.bytes,payload.length,'BootData length differs from exact linked payload');
  assert.equal(bootData.plugin,0,'Boot plugin mode is unsupported');
  return {schemaVersion:1,passed:true,status:'development',installable:false,base,imageBytes:payload.length,
    imageEnd:base+payload.length,payloadLimit,entry,bootData,sha256:crypto.createHash('sha256').update(payload).digest('hex'),
    vm:TARGET.vm,blockers:TARGET.blockers,physicalHardware:false,
    scope:'Linked raw image envelope and slot bounds only; no package codec, TR loader, bus compatibility or runtime execution proof'};
}

validateTargetContract();
