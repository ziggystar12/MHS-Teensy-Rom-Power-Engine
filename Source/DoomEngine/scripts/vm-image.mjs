// SPDX-License-Identifier: MIT
// Optional profile extends MVM1's reserved words; legacy headers stay identical.
import assert from 'node:assert/strict';
export const crc32=bytes=>{let c=0xffffffff;for(const v of bytes){c^=v;for(let b=0;b<8;b++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
export function packVmImage({code,data,bssBytes,entry,requiredServices,profile=0,rodata=Buffer.alloc(0)}){
    assert.ok(Buffer.isBuffer(code)&&Buffer.isBuffer(data)&&Buffer.isBuffer(rodata));
    for(const n of [bssBytes,entry,requiredServices,profile])assert.ok(Number.isInteger(n)&&n>=0&&n<=0xffffffff);
    assert.ok(code.length>0&&code.length<=98304&&data.length+bssBytes<=196608);
    assert.ok((entry&1)&&(entry&~1)>=0x18000&&(entry&~1)<0x18000+code.length);
    assert.ok((requiredServices&~511)===0);
    if(profile===0)assert.ok(rodata.length===0&&!(requiredServices&128));
    else {assert.equal(profile,1);assert.ok(rodata.length>0&&rodata.length<=98304);requiredServices|=128;}
    const payload=Buffer.concat([code,data,rodata]),h=Buffer.alloc(64);
    [0x314d564d,2,64,code.length,data.length,bssBytes,entry,0x18000,0x20014000,requiredServices,crc32(payload),0,profile,rodata.length,0,0]
        .forEach((n,i)=>h.writeUInt32LE(n>>>0,i*4));
    h.writeUInt32LE(crc32(h),44);return Buffer.concat([h,payload]);
}
