import assert from "node:assert/strict";
import { Atari6502Cpu } from "./atari-6502-cpu.mjs";
const I=0x04,B=0x10,U=0x20;
const CONTROL={commit:0xdff7,ack:0xdff6};

export function isPlaneAddress(address) {
  return (address >= 0x6000 && address < 0x7f40) ||
    (address >= 0x5c00 && address < 0x5fe8) ||
    (address >= 0x4000 && address < 0x43e8) ||
    (address >= 0xd800 && address < 0xdbe8);
}

// Test-only NMOS executor. The shared helper supplies instruction semantics,
// but none of its Atari cartridge mappings or special register reads apply.
// Raster interrupts are deterministic events, not a timing/performance model.
export class C64TerminalCpu extends Atari6502Cpu {
  constructor(program, service, { rasterInterruptPeriod = 500, recordWrites = true } = {}) {
    super(Buffer.alloc(0x2000));
    this.cartridgeEnabled = false;
    this.program = program;
    this.service = service;
    this.instructions = 0;
    this.rasterInterruptPeriod = rasterInterruptPeriod;
    this.irqCount = 0;
    this.recordWrites = recordWrites;
    this.writes = [];
    this.planeWrites = [];
    this.sidWrites = [];
    this.controls = { return: false, space: false, fire: false, port1Bits: 0, port2Bits: 0,
      potX:255,potY:255,matrix: new Uint8Array(8) };
    this.potReads=[];
    this.ram.set(program.prg.subarray(2), program.prg.readUInt16LE(0));
    this.pc = program.labels.entry;
  }

  read(address) {
    address &= 0xffff;
    this.service?.onRead?.(this, address);
    if (address === 0xd012) return Math.floor(this.instructions / 4) & 0xff;
    if (address === 0xd016) return this.ram[address] | 0xc0; // Unused VIC read bits.
    if (address === 0xdc0d || address === 0xdd0d) return 0;
    if(address===0xd419||address===0xd41a){
      const selected=(this.ram[0xdc02]&0xc0)===0xc0&&(this.ram[0xdc00]&0xc0)===0x40;
      this.potReads.push({address,instruction:this.instructions,selected});
      return selected?this.controls[address===0xd419?'potX':'potY']:255;
    }
    if (address === 0xdc00 || address === 0xdc01) return this.ciaPins()[address & 1];
    return this.ram[address];
  }

  ciaPins() {
    // The key switches connect PA rows to PB columns in both directions.
    // Joystick/mouse grounds therefore propagate through held keys even with
    // both DDRs set to input. This models physical ghosting and port sharing,
    // rather than presenting independently synthesized keyboard characters.
    let lowA = (this.ram[0xdc02] & ~this.ram[0xdc00]) | this.controls.port2Bits |
      (this.controls.fire ? 16 : 0);
    let lowB = (this.ram[0xdc03] & ~this.ram[0xdc01]) | this.controls.port1Bits;
    for(let pass=0;pass<16;pass++) {
      const beforeA=lowA,beforeB=lowB;
      for(let row=0;row<8;row++) {
        const keys=this.controls.matrix[row] | (row===0&&this.controls.return?2:0) |
          (row===7&&this.controls.space?16:0);
        if(lowA&(1<<row))lowB|=keys;
        if(lowB&keys)lowA|=1<<row;
      }
      if(lowA===beforeA&&lowB===beforeB)break;
    }
    return [~lowA&255,~lowB&255];
  }

  write(address, value) {
    address &= 0xffff;
    value &= 0xff;
    if (address === 0xd019) this.ram[address] &= ~value; // VIC write-one-to-clear IRQ status.
    else this.ram[address] = value;
    if (this.recordWrites) {
      const write = { address, value, pc: this.pc, instruction: this.instructions,
        sequence: this.ram[CONTROL.commit], irqCount: this.irqCount,
        displayEnabled: Boolean(this.ram[0xd011] & 0x10), hires: !(this.ram[0xd016] & 0x10) };
      this.writes?.push(write);
      // Count authored cell writes, including the staged base colors. Text
      // diagnostics share physical color RAM and the one-time base color copy
      // publishes it later; neither is a cell record publication.
      if (isPlaneAddress(address) && this.pc >= this.program?.labels.apply_cells &&
          this.pc < this.program?.labels.apply_cells_ok) this.planeWrites?.push(write);
      if (address >= 0xd400 && address <= 0xd418) this.sidWrites?.push(write);
    }
    this.service?.onWrite?.(this, address, value);
  }

  step() {
    this.instructions++;
    if (this.rasterInterruptPeriod > 0 && this.instructions % this.rasterInterruptPeriod === 0 &&
        (this.ram[0xd01a] & 1) !== 0) {
      this.ram[0xd019] |= 1;
    }
    if ((this.ram[0xd01a] & this.ram[0xd019] & 1) !== 0 && !this.flag(I)) {
      this.push(this.pc >>> 8);
      this.push(this.pc & 0xff);
      this.push((this.p | U) & ~B);
      this.setFlag(I, true);
      this.pc = this.ram[0xfffe] | (this.ram[0xffff] << 8);
      this.irqCount++;
      return;
    }
    const opcode = this.ram[this.pc];
    let address;
    switch (opcode) {
      case 0x3d: // AND abs,X
        this.fetch(); this.a = this.setNz(this.a & this.read((this.fetchWord() + this.x) & 0xffff)); return;
      case 0x26: // ROL zp
        this.fetch(); address = this.fetch(); this.write(address, this.rotateLeft(this.read(address))); return;
      case 0x40: // RTI
        this.fetch(); this.p = (this.pop() | U) & ~B; this.pc = this.pop() | (this.pop() << 8); return;
      case 0x45: // EOR zp
        this.fetch(); this.a = this.setNz(this.a ^ this.read(this.fetch())); return;
      case 0x4d: // EOR abs
        this.fetch(); this.a = this.setNz(this.a ^ this.read(this.fetchWord())); return;
      case 0x59: // EOR abs,Y
        this.fetch(); this.a = this.setNz(this.a ^ this.read((this.fetchWord() + this.y) & 0xffff)); return;
      case 0xc5: // CMP zp
        this.fetch(); this.compare(this.a, this.read(this.fetch())); return;
      case 0xfd: // SBC abs,X
        this.fetch(); this.sbc(this.read((this.fetchWord() + this.x) & 0xffff)); return;
      case 0xde: // DEC abs,X
        this.fetch(); address = (this.fetchWord() + this.x) & 0xffff;
        this.write(address, this.setNz((this.read(address) - 1) & 255)); return;
      case 0xfe: // INC abs,X
        this.fetch(); address = (this.fetchWord() + this.x) & 0xffff;
        this.write(address, this.setNz((this.read(address) + 1) & 255)); return;
      default:
        super.step();
    }
  }

  runUntil(predicate, maxInstructions = 5_000_000) {
    for (let step = 0; step < maxInstructions; step++) {
      if (predicate(this)) return this.instructions;
      this.step();
    }
    assert.fail(`terminal did not reach expected state; PC=$${this.pc.toString(16)}, ACK=${this.ram[CONTROL.ack]}`);
  }
}
