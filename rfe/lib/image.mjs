// SPDX-License-Identifier: MIT
// Strict linked HEX -> raw slot0 payload. No installable RFE wire format.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {TARGET} from './contract.mjs';

export function decodeHostHex(input){
  assert.ok(typeof input==='string'||input instanceof Uint8Array,'HEX input must be text or bytes');
  if(typeof input==='string')assert.ok(!/[^\x00-\x7f]/.test(input),'HEX contains non-ASCII text');
  const text=typeof input==='string'?input:Buffer.from(input).toString('latin1');
  assert.ok(!/[^\x00-\x7f]/.test(text),'HEX contains non-ASCII bytes');
  const {slot0Base:base,payloadBytes,payloadLimit}=TARGET.flash;
  const image=Buffer.alloc(payloadBytes,0xff),written=Buffer.alloc(payloadBytes);
  let upper=0,eof=false,minimum=Infinity,maximum=0,dataBytes=0,records=0,startEntry=null;
  const lines=text.split(/\r\n|\r|\n/);
  while(lines.length&&lines.at(-1)==='')lines.pop();
  for(const [index,line]of lines.entries()){
    const at='HEX line '+(index+1)+': ';
    assert.ok(!eof,at+'record after EOF');
    assert.match(line,/^:(?:[0-9a-fA-F]{2}){5,}$/,at+'invalid record syntax');
    const row=Buffer.from(line.slice(1),'hex'),count=row[0],address=row.readUInt16BE(1),type=row[3];
    assert.equal(row.length,count+5,at+'record length mismatch');
    assert.equal(row.reduce((sum,byte)=>sum+byte,0)&255,0,at+'record checksum mismatch');
    ++records;
    if(type===0){
      assert.ok(count>0,at+'empty data record');
      assert.ok(address+count<=65536,at+'data record crosses 64 KiB address boundary');
      const start=upper+address,end=start+count;
      assert.ok(start>=base&&end<=payloadLimit,at+'data outside slot0 payload');
      for(let i=0;i<count;i++){
        const offset=start-base+i;
        assert.equal(written[offset],0,at+'overlapping data');
        written[offset]=1;image[offset]=row[4+i];
      }
      minimum=Math.min(minimum,start);maximum=Math.max(maximum,end);dataBytes+=count;
    }else if(type===4){
      assert.ok(count===2&&address===0,at+'invalid extended linear address');
      upper=row.readUInt16BE(4)*65536;
    }else if(type===1){
      assert.ok(count===0&&address===0,at+'invalid EOF');eof=true;
    }else if(type===5){
      assert.ok(count===4&&address===0&&startEntry===null,at+'invalid or duplicate start linear address');
      startEntry=row.readUInt32BE(4);
    }else assert.fail(at+'unsupported record type '+type);
  }
  assert.ok(eof,'HEX missing EOF');
  assert.ok(dataBytes,'HEX has no data');
  assert.equal(minimum,base,'HEX must begin at slot0 base');
  const payload=image.subarray(0,maximum-base);
  if(startEntry!==null){
    // GNU objcopy emits the ELF ENTRY(ImageVectorTable), not the Thumb
    // ResetHandler stored in IVT word 1. The startup target is checked
    // separately by validateHostImage; do not conflate these two addresses.
    assert.equal(startEntry,base+TARGET.image.ivtOffset,'HEX start address differs from linker ImageVectorTable entry');
    assert.ok(payload.length>=TARGET.image.ivtOffset+32,'HEX start address lacks complete image vector table');
    assert.equal(payload.readUInt32LE(TARGET.image.ivtOffset),TARGET.image.ivtMagic,'HEX linker entry lacks image vector magic');
  }
  return {payload,report:{schemaVersion:1,passed:true,status:'development',installable:false,base,
    imageBytes:payload.length,imageEnd:maximum,dataBytes,records,startEntry,
    sha256:crypto.createHash('sha256').update(payload).digest('hex'),
    sourceHexSha256:crypto.createHash('sha256').update(text,'ascii').digest('hex'),
    scope:'Strict HEX decoding with erased gaps and slot0 bounds; not an installable RFE package'}};
}
