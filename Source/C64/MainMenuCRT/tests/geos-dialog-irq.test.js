'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { desktopMachine } = require('./desktop-machine');
const { backendPETSCII } = require('./backend-petscii');

const cpuSource = fs.readFileSync(path.join(__dirname, 'geos-color-publication.test.js'), 'utf8');
const opcodeStart = cpuSource.indexOf('const opcodes = new Map();');
const opcodeEnd = cpuSource.indexOf("test('assembled renderer", opcodeStart);
const opcodes = vm.runInNewContext(cpuSource.slice(opcodeStart, opcodeEnd) + '\nopcodes;');

// Nominal NMOS 6502 instruction clocks, including taken/page-crossing branches
// and indexed reads. VIC DMA is not emulated; these are CPU blackout bounds.
function clocks(cpu) {
    const pc = cpu.pc, opcode = cpu.m[pc], [op, mode] = opcodes.get(opcode) || [];
    assert.ok(op, `cycle decoder supports $${opcode.toString(16)}`);
    if (/^B(PL|MI|VC|VS|CC|CS|NE|EQ)$/.test(op)) {
        const taken = { BPL: !(cpu.p & 128), BMI: cpu.p & 128, BVC: !(cpu.p & 64), BVS: cpu.p & 64,
            BCC: !(cpu.p & 1), BCS: cpu.p & 1, BNE: !(cpu.p & 2), BEQ: cpu.p & 2 }[op];
        const next = (pc + 2) & 65535, displacement = cpu.m[(pc + 1) & 65535];
        const target = (next + (displacement < 128 ? displacement : displacement - 256)) & 65535;
        return 2 + Number(!!taken) + Number(!!taken && (next & 0xff00) !== (target & 0xff00));
    }
    if (op === 'JSR' || op === 'RTS') return 6;
    if (op === 'JMP') return 3;
    if (op === 'PHP' || op === 'PHA') return 3;
    if (op === 'PLP' || op === 'PLA') return 4;
    if (!mode || mode === 'acc' || mode === 'imm') return 2;
    if (['ASL', 'LSR', 'ROL', 'ROR', 'INC', 'DEC'].includes(op)) return { zp: 5, zpx: 6, abs: 6, abx: 7 }[mode];
    if (['STA', 'STX', 'STY'].includes(op)) return { zp: 3, zpx: 4, zpy: 4, abs: 4, abx: 5, aby: 5, inx: 6, iny: 6 }[mode];
    const base = { zp: 3, zpx: 4, zpy: 4, abs: 4, abx: 4, aby: 4, inx: 6, iny: 5 }[mode];
    if (!['abx', 'aby', 'iny'].includes(mode)) return base;
    const operand = cpu.m[(pc + 1) & 65535];
    const address = mode === 'iny' ? cpu.m[operand] | cpu.m[(operand + 1) & 255] << 8 : operand | cpu.m[(pc + 2) & 65535] << 8;
    const indexed = (address + (mode === 'abx' ? cpu.x : cpu.y)) & 65535;
    return base + Number((address & 0xff00) !== (indexed & 0xff00));
}

function instrument(cpu, s, inject) {
    const sidPlayStub = s.GeosSettingsBase - 0x200;
    const step = cpu.step.bind(cpu);
    const stats = { cycles: 0, masked: 0, longestMask: 0, interrupts: 0, sidCalls: 0, mouseSamples: 0 };
    let span = 0, nextIRQ = 503;
    // The real wedge calls a deliberately scratch-heavy SID play stub. The
    // KERNAL prologue/epilogue is represented explicitly on the real CPU stack;
    // the actual wedge and Mouse1351IRQSample run without replacement.
    const sid = [0xa9, 0xa7];
    for (let address = 2; address < 0xa0; address++) sid.push(0x85, address);
    for (let address = 0xd0; address <= 0xff; address++) sid.push(0x85, address);
    sid.push(0xa2, 0x93, 0xa0, 0x6d, 0x60);
    assert.ok(sid.length <= 0x200, 'test SID routine fits below the settings overlay');
    Buffer.from(sid).copy(cpu.m, sidPlayStub);
    cpu.m[s.smcSIDPlayAddr + 1] = sidPlayStub & 255;
    cpu.m[s.smcSIDPlayAddr + 2] = sidPlayStub >> 8;
    cpu.m[s.smcSIDPauseStop + 1] = 0;
    cpu.m[s.smcIRQDefault + 1] = 0x31; cpu.m[s.smcIRQDefault + 2] = 0xea;
    Buffer.from([0xa9, 0x5b, 0x85, 0xf7, 0x85, 0xf8, 0xa2, 0xc3, 0xa0, 0x27,
        0x68, 0xa8, 0x68, 0xaa, 0x68, 0x40]).copy(cpu.m, 0xea31);
    const interrupt = () => {
        const before = [cpu.a, cpu.x, cpu.y, cpu.p & ~0x10, cpu.sp, cpu.pc, cpu.m[1]];
        assert.ok(cpu.m[1] & 2, 'KERNAL remains mapped at interrupt entry');
        cpu.m[0xdc0d] = 1; cpu.m[s.CIA1_RegA] = cpu.m[s.CIA1_RegB] = 255;
        cpu.m[s.PadlXReg] = (cpu.m[s.PadlXReg] + 2) & 127;
        cpu.m[s.PadlYReg] = (cpu.m[s.PadlYReg] + 2) & 127;
        cpu.push(cpu.pc >> 8); cpu.push(cpu.pc); cpu.push(cpu.p & ~0x10); cpu.p |= 4;
        cpu.push(cpu.a); cpu.push(cpu.x); cpu.push(cpu.y); cpu.pc = s.IRQwedge;
        for (let instructions = 0;; instructions++) {
            assert.ok(instructions < 5000, 'IRQ completes');
            if (cpu.pc === s.Mouse1351IRQSample) stats.mouseSamples++;
            if (cpu.pc === sidPlayStub) stats.sidCalls++;
            if (cpu.m[cpu.pc] === 0x40) {
                cpu.p = cpu.pop() | 0x20;
                const low = cpu.pop(); cpu.pc = low | cpu.pop() << 8;
                break;
            }
            step();
        }
        stats.interrupts++;
        assert.deepEqual([cpu.a, cpu.x, cpu.y, cpu.p & ~0x10, cpu.sp, cpu.pc, cpu.m[1]], before,
            'real SID/mouse wedge restores registers, flags, stack, PC and interrupted $01 bank');
    };
    cpu.step = () => {
        if (inject && stats.cycles >= nextIRQ && !(cpu.p & 4)) {
            interrupt(); nextIRQ = stats.cycles + 2048;
        }
        const cost = clocks(cpu), masked = cpu.p & 4;
        assert.ok(Number.isFinite(cost));
        step(); stats.cycles += cost;
        if (masked || cpu.p & 4) {
            stats.masked += cost; span += cost;
            stats.longestMask = Math.max(stats.longestMask, span);
        } else span = 0;
    };
    return stats;
}

test('native dialog rendering services real SID/mouse IRQs without changing pixels or commands', t => desktopMachine(t,
    async ({ s, fresh, stub, local, pixel }) => {
        const drawChoice = cpu => {
            cpu.a = 1; cpu.call(s.GeosDialogOpen);
            cpu.a = s.GeosFirmwareTitle & 255; cpu.y = s.GeosFirmwareTitle >> 8;
            cpu.call(s.GeosDialogBegin);
            cpu.call(s.GeosDialogButtons);
            cpu.call(s.GeosDialogPublish);
        };
        const drawMusic = (cpu, name = 'Initial Tune.sid') => {
            cpu.m[s.GeosControlMode] = 9;
            Buffer.from(name + '\0').copy(cpu.m, s.GeosMusicName);
            cpu.call(s.GeosRichBegin);
            cpu.call(s.GeosControlDraw);
            cpu.call(s.GeosRichPublish);
            cpu.call(s.GeosBitmapPublishColors);
            cpu.call(s.GeosDialogRestoreBank);
        };
        const cases = [
            ['loading', () => {}, cpu => cpu.call(s.GeosBitmapWaitBegin), 1200000],
            ['activity', cpu => { cpu.call(s.GeosBitmapWaitBegin); cpu.m[s.TODTenthSecBCD]++; }, cpu => cpu.call(s.GeosBitmapWaitAnimate), 60000],
            ['body', cpu => cpu.call(s.GeosBitmapWaitBegin), cpu => local(cpu, 'Aa_1.hex '.repeat(31))],
            ['error', cpu => { cpu.call(s.GeosBitmapWaitBegin); local(cpu, 'Read failed. Keep this message.'); }, cpu => cpu.call(s.GeosBitmapWaitError)],
            ['information', () => {}, cpu => local(cpu, 'Drive not present. Please connect it and try again.', 'GeosBitmapShowMessage')],
            ['choice', drawChoice, cpu => { cpu.a = s.ChrCRSRRight; cpu.call(s.GeosDialogKey); }, 110000],
            ['action-status', cpu => cpu.call(s.GeosBitmapWaitBegin), cpu => local(cpu, 'Remove the tag, then choose OK.', 'GeosActionStatus')],
            ['file-dialog', cpu => { cpu.m[s.GeosFileLastState] = s.rfosBusy; cpu.m[s.IO1Port + s.rRegFileOpProgress] = 58; }, cpu => cpu.call(s.GeosFileDraw), 1400000],
            ['music-selection', drawMusic, cpu => { cpu.a = 3; cpu.call(s.GeosControlSetSelection); }, 70000],
            ['music-play-pause', cpu => {
                drawMusic(cpu); cpu.m[s.GeosControlSelection] = 1;
                cpu.m[s.IO1Port + s.rwRegStatus] = s.rsReady;
            }, cpu => cpu.call(s.GeosMusicActivate), 100000],
            ['music-repaint', cpu => {
                drawMusic(cpu, 'Death Is No Evil');
                cpu.call(s.GeosBitmapWaitBegin);
            }, cpu => cpu.call(s.GeosControlRepaint)],
            ['firmware-cancel', cpu => {
                cpu.m[s.IO1Port + s.rRegFirmwareTargetState] = 1;
                stub(cpu, 'WaitForTRWaitMsg'); stub(cpu, 'ListAndDone');
                stub(cpu, 'GetIn', c => { c.a = c.nz(s.ChrReturn); });
                stub(cpu, 'IRQDisable', () => assert.fail('cancel must keep SID/mouse IRQ enabled'));
                stub(cpu, 'StartSelItem_WaitForTRDots', () => assert.fail('cancel must not start firmware update'));
            }, cpu => cpu.call(s.GeosFirmwareConfirm)],
        ];
        const report = [];
        for (const [name, prepare, run, maxCycles, servicesIRQ = true] of cases) await t.test(name, () => {
            const executions = [];
            for (const mode of ['plain', 'injected', 'caller-masked']) {
                const cpu = fresh(), commands = [];
                cpu.p &= ~4;
                cpu.m.fill(0x55, s.GeosBitmapRAM, s.GeosBitmapRAMEnd);
                cpu.m.fill(0xaa, s.GeosRichCanvas, s.GeosRichCanvas + 8000);
                cpu.m.fill(0x61, s.C64ScreenRAM, s.C64ScreenRAM + 1000);
                let serial = 0, selected = 0;
                const streams = {
                    [s.rsstFileOpName]: Buffer.from('Copy of Original.Name.bin'),
                    [s.rsstFileOpMessage]: backendPETSCII('Delete this file permanently?'),
                    [s.rsstFirmwareName]: Buffer.from('MPE_Firmware-V1.0.7.hex'),
                };
                const original = cpu.step.bind(cpu);
                cpu.step = () => {
                    const address = cpu.m[cpu.pc + 1] | cpu.m[cpu.pc + 2] << 8;
                    if (cpu.m[cpu.pc] === 0xad && address === s.IO1Port + s.rwRegSerialString) {
                        const text = streams[selected] || []; cpu.m[address] = text[serial++] || 0;
                    }
                    original();
                };
                cpu.onWrite = (address, value) => {
                    if (address === s.IO1Port + s.rwRegSerialString) { selected = value; serial = 0; }
                    if (address === s.IO1Port + s.wRegControl) commands.push(value);
                };
                prepare(cpu);
                const beforeBitmap = Buffer.from(cpu.m.subarray(s.GeosBitmapRAM, s.GeosBitmapRAMEnd));
                const beforeColors = Buffer.from(cpu.m.subarray(s.C64ScreenRAM, s.C64ScreenRAM + 1000));
                if (mode === 'caller-masked') cpu.p |= 4;
                const stats = instrument(cpu, s, mode === 'injected');
                run(cpu);
                if (name === 'choice') {
                    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
                        if (x >= 62 && x < 256 && y >= 142 && y < 153) continue;
                        const address = (y >> 3) * 320 + (x >> 3) * 8 + (y & 7);
                        const oldPixel = Number(!!(beforeBitmap[address] & (128 >> (x & 7))));
                        assert.equal(pixel(cpu, x, y), oldPixel, `choice publish stays inside button band at ${x},${y}`);
                    }
                    for (let row = 0; row < 25; row++) for (let col = 0; col < 40; col++) {
                        if (col >= 7 && col < 32 && row >= 17 && row < 20) continue;
                        assert.equal(cpu.m[s.C64ScreenRAM + row * 40 + col], beforeColors[row * 40 + col]);
                    }
                }
                const pixels = Buffer.concat([cpu.m.subarray(s.GeosBitmapRAM, s.GeosBitmapRAMEnd),
                    cpu.m.subarray(s.C64ScreenRAM, s.C64ScreenRAM + 1000)]);
                if (name === 'music-play-pause') assert.equal(cpu.m[s.IO1Port + s.rwRegPwrUpDefaults] & s.rpudSIDPauseMask, 1, 'pause persists startup music off');
                executions.push({ pixels, commands, hash: crypto.createHash('sha256').update(pixels).digest('hex'), ...stats });
                assert.equal(cpu.m[1], 0x37, 'caller bank restored');
                assert.equal(cpu.p & 4, mode === 'caller-masked' ? 4 : 0, 'caller IRQ state retained');
            }
            const [plain, interrupted, callerMasked] = executions;
            assert.deepEqual(interrupted.pixels, plain.pixels, 'interrupts preserve exact bitmap and color publication');
            assert.deepEqual(interrupted.commands, plain.commands, 'interrupts preserve backend commands');
            assert.deepEqual(callerMasked.pixels, plain.pixels, 'a caller-owned critical section renders identically');
            assert.deepEqual(callerMasked.commands, plain.commands);
            assert.equal(callerMasked.interrupts, 0, 'drawing does not enable a caller-disabled IRQ');
            report.push({ name, hash: plain.hash, cycles: plain.cycles, longestMask: plain.longestMask,
                interrupts: interrupted.interrupts, sidCalls: interrupted.sidCalls, mouseSamples: interrupted.mouseSamples });
            t.diagnostic(JSON.stringify(report.at(-1)));
            if (maxCycles) assert.ok(plain.cycles < maxCycles, `${name}: ${plain.cycles}/${maxCycles} cycle ceiling`);
            assert.ok(plain.longestMask <= 96, `${name}: IRQ masked for ${plain.longestMask} CPU cycles`);
            assert.equal(interrupted.interrupts > 0, servicesIRQ, servicesIRQ ? 'IRQs execute during drawing' : 'no-pixel action completes before an IRQ period');
            assert.equal(interrupted.sidCalls, name === 'music-play-pause' ? 0 : interrupted.interrupts);
            assert.equal(interrupted.mouseSamples, interrupted.interrupts);
        });
        await t.test('mouse coordinates/button snapshot retains its short critical section', () => {
            const cpu = fresh(); cpu.p &= ~4;
            cpu.m[s.MouseActive] = 1; cpu.m[s.MouseLogicalX] = 90; cpu.m[s.MouseLogicalY] = 65;
            const stats = instrument(cpu, s, false);
            cpu.call(s.GeosDialogPointer);
            assert.deepEqual([cpu.m[s.MouseFrameX], cpu.m[s.MouseFrameY], cpu.m[s.MouseFrameDown]], [90, 65, 0]);
            assert.ok(stats.longestMask > 0 && stats.longestMask <= 96, 'atomic input snapshot remains bounded');
            assert.equal(cpu.p & 4, 0);
            t.diagnostic(`mouse snapshot masks ${stats.longestMask} CPU cycles`);
        });
        const output = path.resolve(__dirname, '../../../../build/ui-proof');
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'dialog-irq-cycles.json'), JSON.stringify(report, null, 2) + '\n');
    }));
