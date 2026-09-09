// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
export class Emitter {
  constructor(base) { this.base=base; this.bytes=[]; this.labels={}; this.fixups=[]; }
  emit(...bytes) { this.bytes.push(...bytes); }
  label(name) { this.labels[name]=this.base+this.bytes.length; }
  abs(opcode,address) { this.emit(opcode); this.address(address); }
  address(value) {
    if (typeof value==='string') {this.fixups.push({offset:this.bytes.length,label:value}); this.emit(0,0);}
    else this.emit(value&255,value>>8);
  }
  branch(opcode,label) { this.emit(opcode); this.fixups.push({offset:this.bytes.length,label,relative:true}); this.emit(0); }
  set(address,value) { this.emit(0xa9,value); this.abs(0x8d,address); }
  finish() {
    for (const fixup of this.fixups) {
      const address=this.labels[fixup.label]; assert.notEqual(address,undefined,fixup.label);
      if (fixup.relative) {const delta=address-(this.base+fixup.offset+1); assert.ok(delta>=-128&&delta<=127); this.bytes[fixup.offset]=delta&255;}
      else {this.bytes[fixup.offset]=address&255; this.bytes[fixup.offset+1]=address>>8;}
    }
    return Buffer.from(this.bytes);
  }
}
