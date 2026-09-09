import assert from "node:assert/strict";

const C = 0x01;
const Z = 0x02;
const I = 0x04;
const D = 0x08;
const B = 0x10;
const U = 0x20;
const V = 0x40;
const N = 0x80;

function hex(value, width = 4) {
  return value.toString(16).padStart(width, "0");
}
// Small, deterministic NMOS 6502 executor for ROM-level regression tests.
// It intentionally implements only documented instructions reached by the
// AGI-ANTIC picture publisher, and fails loudly if that contract expands.
export class Atari6502Cpu {
  constructor(rom) {
    assert.ok(Buffer.isBuffer(rom) || rom instanceof Uint8Array);
    assert.equal(rom.length % 0x2000, 0, "Atarimax ROM must contain complete 8K banks");
    this.rom = rom;
    this.ram = new Uint8Array(0x10000);
    this.bank = 0;
    this.cartridgeEnabled = true;
    this.resetRegisters();
  }

  resetRegisters() {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xfd;
    this.pc = 0;
    this.p = U;
  }

  installRuntimeBanks(startBank, count) {
    for (let bank = startBank; bank < startBank + count; bank += 1) {
      const offset = bank * 0x2000;
      const end = offset + 0x2000;
      let cursor = offset;
      for (;;) {
        assert.ok(cursor + 4 <= end, `missing runtime terminator in bank ${bank}`);
        const destination = this.rom[cursor] | (this.rom[cursor + 1] << 8);
        const length = this.rom[cursor + 2] | (this.rom[cursor + 3] << 8);
        cursor += 4;
        if (length === 0) break;
        assert.ok(cursor + length <= end, `runtime record crosses bank ${bank}`);
        assert.ok(destination + length <= 0x10000,
          `runtime record in bank ${bank} crosses the 6502 address space`);
        this.ram.set(this.rom.subarray(cursor, cursor + length), destination);
        cursor += length;
      }
    }
  }

  read(address) {
    address &= 0xffff;
    if (address === 0xd40b) return 0x70; // post-playfield publication edge
    if (address === 0xd580) {
      this.cartridgeEnabled = false;
      return 0;
    }
    if (this.cartridgeEnabled && address >= 0xa000 && address < 0xc000) {
      return this.rom[this.bank * 0x2000 + address - 0xa000];
    }
    return this.ram[address];
  }

  write(address, value) {
    address &= 0xffff;
    value &= 0xff;
    if (address >= 0xd500 && address < 0xd580) {
      this.bank = address - 0xd500;
      this.cartridgeEnabled = true;
    }
    // Writes also reach RAM-under-ROM in the cartridge window. Keeping the
    // hardware registers mirrored makes their final publication state testable.
    this.ram[address] = value;
  }

  flag(mask) {
    return (this.p & mask) !== 0;
  }

  setFlag(mask, enabled) {
    this.p = enabled ? this.p | mask : this.p & ~mask;
  }

  setNz(value) {
    value &= 0xff;
    this.setFlag(Z, value === 0);
    this.setFlag(N, (value & 0x80) !== 0);
    return value;
  }

  fetch() {
    const value = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return value;
  }

  fetchWord() {
    const low = this.fetch();
    return low | (this.fetch() << 8);
  }

  zeroPageWord(address) {
    return this.read(address & 0xff) | (this.read((address + 1) & 0xff) << 8);
  }

  push(value) {
    this.write(0x100 | this.sp, value);
    this.sp = (this.sp - 1) & 0xff;
  }

  pop() {
    this.sp = (this.sp + 1) & 0xff;
    return this.read(0x100 | this.sp);
  }

  compare(register, value) {
    const result = (register - value) & 0xff;
    this.setFlag(C, register >= value);
    this.setNz(result);
  }

  adc(value) {
    assert.equal(this.flag(D), false, "test CPU does not emulate decimal ADC");
    const old = this.a;
    const sum = old + value + (this.flag(C) ? 1 : 0);
    const result = sum & 0xff;
    this.setFlag(C, sum > 0xff);
    this.setFlag(V, ((~(old ^ value) & (old ^ result)) & 0x80) !== 0);
    this.a = this.setNz(result);
  }

  sbc(value) {
    assert.equal(this.flag(D), false, "test CPU does not emulate decimal SBC");
    const old = this.a;
    const sum = old + (value ^ 0xff) + (this.flag(C) ? 1 : 0);
    const result = sum & 0xff;
    this.setFlag(C, sum > 0xff);
    this.setFlag(V, (((old ^ result) & (old ^ value)) & 0x80) !== 0);
    this.a = this.setNz(result);
  }

  branch(condition) {
    const offset = this.fetch();
    if (condition) this.pc = (this.pc + (offset < 0x80 ? offset : offset - 0x100)) & 0xffff;
  }

  rotateLeft(value) {
    const carry = this.flag(C) ? 1 : 0;
    this.setFlag(C, (value & 0x80) !== 0);
    return this.setNz(((value << 1) | carry) & 0xff);
  }

  rotateRight(value) {
    const carry = this.flag(C) ? 0x80 : 0;
    this.setFlag(C, (value & 1) !== 0);
    return this.setNz((value >>> 1) | carry);
  }

  shiftLeft(value) {
    this.setFlag(C, (value & 0x80) !== 0);
    return this.setNz((value << 1) & 0xff);
  }

  shiftRight(value) {
    this.setFlag(C, (value & 1) !== 0);
    return this.setNz(value >>> 1);
  }

  step() {
    const opcodeAddress = this.pc;
    const opcode = this.fetch();
    let address;
    let value;
    switch (opcode) {
      case 0x05: this.a = this.setNz(this.a | this.read(this.fetch())); break;
      case 0x06: address = this.fetch(); this.write(address, this.shiftLeft(this.read(address))); break;
      case 0x08: this.push(this.p | B | U); break;
      case 0x09: this.a = this.setNz(this.a | this.fetch()); break;
      case 0x0a: this.a = this.shiftLeft(this.a); break;
      case 0x0d: this.a = this.setNz(this.a | this.read(this.fetchWord())); break;
      case 0x0e: address = this.fetchWord(); this.write(address, this.shiftLeft(this.read(address))); break;
      case 0x10: this.branch(!this.flag(N)); break;
      case 0x18: this.setFlag(C, false); break;
      case 0x20: {
        address = this.fetchWord();
        const returnAddress = (this.pc - 1) & 0xffff;
        this.push(returnAddress >>> 8);
        this.push(returnAddress & 0xff);
        this.pc = address;
        break;
      }
      case 0x24: value = this.read(this.fetch()); this.setFlag(Z, (this.a & value) === 0); this.setFlag(N, value & 0x80); this.setFlag(V, value & 0x40); break;
      case 0x28: this.p = (this.pop() | U) & ~B; break;
      case 0x29: this.a = this.setNz(this.a & this.fetch()); break;
      case 0x2a: this.a = this.rotateLeft(this.a); break;
      case 0x2c: value = this.read(this.fetchWord()); this.setFlag(Z, (this.a & value) === 0); this.setFlag(N, value & 0x80); this.setFlag(V, value & 0x40); break;
      case 0x2d: this.a = this.setNz(this.a & this.read(this.fetchWord())); break;
      case 0x2e: address = this.fetchWord(); this.write(address, this.rotateLeft(this.read(address))); break;
      case 0x30: this.branch(this.flag(N)); break;
      case 0x38: this.setFlag(C, true); break;
      case 0x48: this.push(this.a); break;
      case 0x49: this.a = this.setNz(this.a ^ this.fetch()); break;
      case 0x4a: this.a = this.shiftRight(this.a); break;
      case 0x4c: this.pc = this.fetchWord(); break;
      case 0x4e: address = this.fetchWord(); this.write(address, this.shiftRight(this.read(address))); break;
      case 0x58: this.setFlag(I, false); break;
      case 0x5d: this.a = this.setNz(this.a ^ this.read((this.fetchWord() + this.x) & 0xffff)); break;
      case 0x60: this.pc = ((this.pop() | (this.pop() << 8)) + 1) & 0xffff; break;
      case 0x65: this.adc(this.read(this.fetch())); break;
      case 0x66: address = this.fetch(); this.write(address, this.rotateRight(this.read(address))); break;
      case 0x68: this.a = this.setNz(this.pop()); break;
      case 0x69: this.adc(this.fetch()); break;
      case 0x6a: this.a = this.rotateRight(this.a); break;
      case 0x6c: {
        address = this.fetchWord();
        const highAddress = (address & 0xff00) | ((address + 1) & 0xff);
        this.pc = this.read(address) | (this.read(highAddress) << 8);
        break;
      }
      case 0x6d: this.adc(this.read(this.fetchWord())); break;
      case 0x70: this.branch(this.flag(V)); break;
      case 0x78: this.setFlag(I, true); break;
      case 0x79: this.adc(this.read((this.fetchWord() + this.y) & 0xffff)); break;
      case 0x7d: this.adc(this.read((this.fetchWord() + this.x) & 0xffff)); break;
      case 0x84: this.write(this.fetch(), this.y); break;
      case 0x85: this.write(this.fetch(), this.a); break;
      case 0x86: this.write(this.fetch(), this.x); break;
      case 0x88: this.y = this.setNz((this.y - 1) & 0xff); break;
      case 0x8a: this.a = this.setNz(this.x); break;
      case 0x8c: this.write(this.fetchWord(), this.y); break;
      case 0x8d: this.write(this.fetchWord(), this.a); break;
      case 0x8e: this.write(this.fetchWord(), this.x); break;
      case 0x90: this.branch(!this.flag(C)); break;
      case 0x91: this.write((this.zeroPageWord(this.fetch()) + this.y) & 0xffff, this.a); break;
      case 0x94: this.write((this.fetch() + this.x) & 0xff, this.y); break;
      case 0x95: this.write((this.fetch() + this.x) & 0xff, this.a); break;
      case 0x96: this.write((this.fetch() + this.y) & 0xff, this.x); break;
      case 0x98: this.a = this.setNz(this.y); break;
      case 0x99: this.write((this.fetchWord() + this.y) & 0xffff, this.a); break;
      case 0x9a: this.sp = this.x; break;
      case 0x9d: this.write((this.fetchWord() + this.x) & 0xffff, this.a); break;
      case 0xa0: this.y = this.setNz(this.fetch()); break;
      case 0xa2: this.x = this.setNz(this.fetch()); break;
      case 0xa4: this.y = this.setNz(this.read(this.fetch())); break;
      case 0xa5: this.a = this.setNz(this.read(this.fetch())); break;
      case 0xa6: this.x = this.setNz(this.read(this.fetch())); break;
      case 0xa8: this.y = this.setNz(this.a); break;
      case 0xa9: this.a = this.setNz(this.fetch()); break;
      case 0xaa: this.x = this.setNz(this.a); break;
      case 0xac: this.y = this.setNz(this.read(this.fetchWord())); break;
      case 0xad: this.a = this.setNz(this.read(this.fetchWord())); break;
      case 0xae: this.x = this.setNz(this.read(this.fetchWord())); break;
      case 0xb0: this.branch(this.flag(C)); break;
      case 0xb1: this.a = this.setNz(this.read((this.zeroPageWord(this.fetch()) + this.y) & 0xffff)); break;
      case 0xb4: this.y = this.setNz(this.read((this.fetch() + this.x) & 0xff)); break;
      case 0xb5: this.a = this.setNz(this.read((this.fetch() + this.x) & 0xff)); break;
      case 0xb6: this.x = this.setNz(this.read((this.fetch() + this.y) & 0xff)); break;
      case 0xb8: this.setFlag(V, false); break;
      case 0xb9: this.a = this.setNz(this.read((this.fetchWord() + this.y) & 0xffff)); break;
      case 0xba: this.x = this.setNz(this.sp); break;
      case 0xbc: this.y = this.setNz(this.read((this.fetchWord() + this.x) & 0xffff)); break;
      case 0xbd: this.a = this.setNz(this.read((this.fetchWord() + this.x) & 0xffff)); break;
      case 0xbe: this.x = this.setNz(this.read((this.fetchWord() + this.y) & 0xffff)); break;
      case 0xc0: this.compare(this.y, this.fetch()); break;
      case 0xc4: this.compare(this.y, this.read(this.fetch())); break;
      case 0xc6: address = this.fetch(); this.write(address, this.setNz((this.read(address) - 1) & 0xff)); break;
      case 0xc8: this.y = this.setNz((this.y + 1) & 0xff); break;
      case 0xc9: this.compare(this.a, this.fetch()); break;
      case 0xca: this.x = this.setNz((this.x - 1) & 0xff); break;
      case 0xcc: this.compare(this.y, this.read(this.fetchWord())); break;
      case 0xcd: this.compare(this.a, this.read(this.fetchWord())); break;
      case 0xce: address = this.fetchWord(); this.write(address, this.setNz((this.read(address) - 1) & 0xff)); break;
      case 0xd0: this.branch(!this.flag(Z)); break;
      case 0xd8: this.setFlag(D, false); break;
      case 0xd9: this.compare(this.a, this.read((this.fetchWord() + this.y) & 0xffff)); break;
      case 0xdd: this.compare(this.a, this.read((this.fetchWord() + this.x) & 0xffff)); break;
      case 0xe0: this.compare(this.x, this.fetch()); break;
      case 0xe4: this.compare(this.x, this.read(this.fetch())); break;
      case 0xe6: address = this.fetch(); this.write(address, this.setNz((this.read(address) + 1) & 0xff)); break;
      case 0xe8: this.x = this.setNz((this.x + 1) & 0xff); break;
      case 0xe9: this.sbc(this.fetch()); break;
      case 0xea: break;
      case 0xec: this.compare(this.x, this.read(this.fetchWord())); break;
      case 0xed: this.sbc(this.read(this.fetchWord())); break;
      case 0xee: address = this.fetchWord(); this.write(address, this.setNz((this.read(address) + 1) & 0xff)); break;
      case 0xf0: this.branch(this.flag(Z)); break;
      case 0xf8: this.setFlag(D, true); break;
      default:
        assert.fail(`unsupported opcode $${hex(opcode, 2)} at $${hex(opcodeAddress)}`);
    }
  }

  call(address, { a = 0, x = 0, y = 0, maxInstructions = 1_000_000,
    returnAddress = 0x0200 } = {}) {
    this.a = a & 0xff;
    this.x = x & 0xff;
    this.y = y & 0xff;
    this.p = U;
    this.sp = 0xfb;
    this.pc = address & 0xffff;
    const sentinel = (returnAddress - 1) & 0xffff;
    this.write(0x01fc, sentinel & 0xff);
    this.write(0x01fd, sentinel >>> 8);
    for (let instructions = 1; instructions <= maxInstructions; instructions += 1) {
      this.step();
      if (this.pc === returnAddress) {
        return { instructions, a: this.a, x: this.x, y: this.y, p: this.p,
          carry: this.flag(C), pc: this.pc };
      }
    }
    assert.fail(`subroutine $${hex(address)} did not return after ${maxInstructions} instructions; pc=$${hex(this.pc)}`);
  }
}
