'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { desktopMachine } = require('./desktop-machine');

// Execute the retained renderer and its actual SID/mouse IRQ wedge. This is a
// deterministic CPU test; VIC bus steals, KERNAL keyboard scanning and real SID
// tune execution remain hardware boundaries.
test('menus update retained Home/SD/IEC surfaces without directory work or long IRQ masking', async t => desktopMachine(t, async ({ s, fresh, stub }) => {
    const io = s.IO1Port;
    const copyText = (cpu, label, text) => Buffer.from(text + '\0', 'ascii').copy(cpu.m, s[label]);
    const word = (cpu, label, value) => { cpu.m[s[label + 'Lo']] = value & 255; cpu.m[s[label + 'Hi']] = value >> 8; };
    function prepared(surface) {
        const cpu = fresh(); cpu.p = 0x20;
        cpu.m[s.GeosSurfaceMode] = surface;
        cpu.m[s.GeosOverlayMode] = 0;
        cpu.m[io + s.rwRegMenuView] = 2;
        cpu.m[io + s.rWRegCurrMenuWAIT] = s.rmtSD;
        cpu.m[io + s.rRegNumItemsOnPage] = 16;
        cpu.m[io + s.rRegViewCountLo] = 80;
        cpu.m[io + s.rRegViewCountHi] = 0;
        cpu.m[io + s.rwRegViewTopLo] = 8;
        cpu.m[io + s.rwRegViewTopHi] = 0;
        cpu.m[io + s.rwRegCursorItemOnPg] = 7;
        cpu.m[io + s.rwRegSelItemOnPage] = 7;
        cpu.m[s.GeosIECCount] = 16;
        cpu.m[s.GeosIECSelection] = 7;
        cpu.m[s.GeosIECDevice] = 8;
        word(cpu, 'GeosIECTotal', 80); word(cpu, 'GeosIECTop', 8);
        copyText(cpu, 'GeosBrowserTitle', surface === s.GeosSurfaceIEC ? 'Drive 8' : 'SD Card');
        copyText(cpu, 'GeosBrowserPath', '/Games/Adventure/');
        for (let item = 0; item < 16; item++) {
            const label = `Example Game File ${String(item + 1).padStart(2, '0')}.PRG`.slice(0, 22);
            Buffer.from(label + '\0').copy(cpu.m, s.GeosRichFileLabels + item * 23);
            cpu.m[s.GeosBrowserIcons + item] = s.GeosIconProgram;
            Buffer.from(label.slice(0, 16)).copy(cpu.m, s.GeosIECEntries + item * 20);
            cpu.m[s.GeosIECEntries + item * 20 + 16] = 0x50;
        }
        cpu.call(s.GeosBrowserReadState);
        cpu.call(s.GeosBitmapConvertScreen);
        return cpu;
    }
    function nested(cpu, address) {
        const returnAddress = cpu.pc, stack = cpu.sp;
        cpu.push((returnAddress - 1) >> 8); cpu.push(returnAddress - 1);
        cpu.pc = address;
        for (let instructions = 0; cpu.pc !== returnAddress; instructions++) {
            assert.ok(instructions < 500000, 'nested reference renderer returns');
            cpu.hooks.get(cpu.pc)?.(cpu); cpu.step();
        }
        assert.equal(cpu.sp, stack);
    }
    function fullFrameReference(cpu) {
        const reference = fresh(); reference.m.set(cpu.m); reference.p = 0x20;
        // Independently compose the menu into the complete off-screen frame,
        // then publish all8000 pixels. This bypasses the optimized restore and
        // direct-visible menu painter rather than testing it against itself.
        stub(reference, 'GeosMenuPaint');
        reference.hooks.set(s.GeosRichPublish, current => {
            if (current.m[s.GeosOverlayMode] === s.GeosOverlayMenu) nested(current, s.GeosRichMenu);
        });
        reference.call(s.GeosBitmapConvertScreen);
        return reference.m.slice(0x2000, 0x3f40);
    }
    function identity(cpu) {
        return Buffer.concat([
            Buffer.from([cpu.m[io + s.rwRegViewTopLo], cpu.m[io + s.rwRegViewTopHi],
                cpu.m[io + s.rwRegCursorItemOnPg], cpu.m[io + s.rwRegSelItemOnPage],
                cpu.m[s.GeosIECSelection], cpu.m[s.GeosIECTopLo], cpu.m[s.GeosIECTopHi]]),
            cpu.m.slice(s.GeosIECEntries, s.GeosIECEntries + 16 * 20),
            cpu.m.slice(s.GeosRichFileLabels, s.GeosRichFileLabels + 16 * 23),
        ]);
    }
    function instrument(cpu) {
        // Minimal KERNAL entry/exit envelope around the production IRQ wedge.
        // The SID callback changes all three registers to prove restoration.
        const irqEntry = 0x1800, irqExit = 0x1830, sidPlay = 0x1850, sidCounter = 0x18f0;
        Buffer.from([0x48, 0x8a, 0x48, 0x98, 0x48, 0x4c, s.IRQwedge & 255, s.IRQwedge >> 8]).copy(cpu.m, irqEntry);
        Buffer.from([0x68, 0xa8, 0x68, 0xaa, 0x68, 0x40]).copy(cpu.m, irqExit);
        Buffer.from([0xee, sidCounter & 255, sidCounter >> 8, 0xa9, 0xa5, 0xa2, 0x5a, 0xa0, 0x3c, 0x60]).copy(cpu.m, sidPlay);
        cpu.m[s.smcIRQDefault + 1] = irqExit & 255; cpu.m[s.smcIRQDefault + 2] = irqExit >> 8;
        cpu.m[s.smcSIDPlayAddr + 1] = sidPlay & 255; cpu.m[s.smcSIDPlayAddr + 2] = sidPlay >> 8;
        cpu.m[s.smcSIDPauseStop + 1] = 0;
        cpu.m[s.MouseActive] = cpu.m[s.MouseMenuEnabled] = cpu.m[s.MouseCalibrated] = 1;
        cpu.m[s.MouseLogicalX] = 80; cpu.m[s.MouseLogicalY] = 100;
        cpu.m[s.MouseOldPotX] = cpu.m[s.MouseOldPotY] = 64;
        cpu.m[s.CIA1_RegA] = cpu.m[s.CIA1_RegB] = 255;
        cpu.m[s.PadlXReg] = cpu.m[s.PadlYReg] = 64;
        const originalStep = cpu.step.bind(cpu), originalAddress = cpu.address.bind(cpu);
        const originalWrite = cpu.onWrite.bind(cpu);
        let measurement, inIRQ = false, masked = 0, sinceIRQ = 0;
        function rawStep() {
            if (cpu.m[cpu.pc] !== 0x40) return originalStep();
            cpu.pc++; cpu.p = cpu.pop() | 0x20; cpu.pc = cpu.pop() | cpu.pop() << 8;
        }
        cpu.address = mode => {
            const address = originalAddress(mode);
            if (measurement && !inIRQ && address >= io && address < io + 256) measurement.backendAddresses++;
            return address;
        };
        cpu.onWrite = (address, value) => {
            originalWrite(address, value);
            if (!measurement || inIRQ) return;
            if (address >= 0x2000 && address < 0x3f40) {
                assert.ok(address < 0x2f00, 'menu pixels stay within top96 scanlines');
                measurement.pixelWrites++;
            }
            assert.ok(address < 0xa000 || address >= 0xbf40, 'menu must preserve every base-canvas byte');
            assert.ok(address < 0x0400 || address >= 0x07e8, 'monochrome menu does not change visible colors');
        };
        function deliverIRQ() {
            const state = [cpu.pc, cpu.sp, cpu.a, cpu.x, cpu.y, cpu.p & ~0x10, cpu.m[1]];
            const beforeMouse = cpu.m[s.MouseLogicalX];
            cpu.m[s.PadlXReg] = cpu.m[s.MouseOldPotX] === 64 ? 68 : 64;
            cpu.m[s.CIA1_RegA] = cpu.m[s.CIA1_RegB] = 255;
            cpu.m[0xdc0d] = 1;
            cpu.push(cpu.pc >> 8); cpu.push(cpu.pc); cpu.push(cpu.p & ~0x10);
            cpu.p |= 4; cpu.pc = irqEntry; inIRQ = true;
            for (let steps = 0; cpu.pc !== state[0]; steps++) {
                assert.ok(steps < 1500, 'production IRQ returns');
                cpu.hooks.get(cpu.pc)?.(cpu); rawStep();
            }
            inIRQ = false;
            assert.deepEqual([cpu.pc, cpu.sp, cpu.a, cpu.x, cpu.y, cpu.p & ~0x10, cpu.m[1]], state, 'IRQ restores registers, flags, stack and interrupted bank');
            measurement.irqs++;
            if (cpu.m[s.MouseLogicalX] !== beforeMouse) measurement.mouseSamples++;
        }
        cpu.step = () => {
            const before = cpu.p; rawStep();
            if (!measurement || inIRQ) return;
            measurement.instructions++; sinceIRQ++;
            if ((before | cpu.p) & 4) masked++;
            if (!(cpu.p & 4)) { measurement.maxMaskedInstructions = Math.max(measurement.maxMaskedInstructions, masked); masked = 0; }
            if (sinceIRQ >= 2048 && !(cpu.p & 4) && cpu.pc !== 0xffff) { deliverIRQ(); sinceIRQ = 0; }
        };
        return (entry, prepare = () => {}) => {
            measurement = { instructions: 0, maxMaskedInstructions: 0, backendAddresses: 0, pixelWrites: 0, irqs: 0, mouseSamples: 0 };
            masked = sinceIRQ = 0; cpu.m[sidCounter] = 0; prepare(); cpu.call(s[entry]);
            const result = measurement; measurement = undefined;
            assert.equal(cpu.p & 4, 0, 'menu restores interrupt-enabled entry state');
            assert.equal(cpu.m[sidCounter], result.irqs & 255, 'every injected timer IRQ reached the SID callback');
            assert.ok(result.irqs > 10, 'timer IRQs run throughout menu work');
            assert.equal(result.mouseSamples, result.irqs, 'actual1351 sampler keeps accepting movement during painting');
            assert.ok(result.maxMaskedInstructions <= 20, `only brief snapshots mask IRQs: ${result.maxMaskedInstructions} instructions`);
            assert.equal(result.backendAddresses, 0, 'menu-only operation never touches backend registers');
            return result;
        };
    }
    for (const [name, surface] of [['Home', s.GeosSurfaceHome], ['SD16', s.GeosSurfaceBrowser], ['IEC16', s.GeosSurfaceIEC]]) {
        await t.test(`${name}: open, change row, switch every menu and close preserve the underlying files`, () => {
            const cpu = prepared(surface), base = cpu.m.slice(0xa000, 0xbf40), files = identity(cpu);
            const measure = instrument(cpu), records = [];
            function action(name, entry, prepare, closing = false) {
                const result = measure(entry, prepare);
                assert.ok(result.instructions < (closing ? 50000 : 150000), `${name} bounded: ${result.instructions} instructions`);
                assert.deepEqual(cpu.m.subarray(0xa000, 0xbf40), base, 'retained base remains unchanged');
                assert.deepEqual(identity(cpu), files, 'selected raw file, top row, IEC records and labels remain unchanged');
                assert.deepEqual(cpu.m.subarray(0x2000, 0x3f40), fullFrameReference(cpu), `${name} matches a full composed frame`);
                assert.equal(cpu.m[s.RichAddressBias + 1], 0x80, 'subsequent drawing targets the off-screen canvas');
                records.push(`${name}=${result.instructions}/${result.irqs}IRQ`);
            }
            action('open', 'GeosShellToggleMenu', () => { cpu.a = s.GeosMenuDesk; });
            action('row', 'GeosShellCursorDown');
            for (const menu of [s.GeosMenuFile, s.GeosMenuEdit, s.GeosMenuView, s.GeosMenuDisk, s.GeosMenuDesk]) {
                action(`switch${menu}`, 'GeosShellToggleMenu', () => { cpu.a = menu; });
            }
            action('close', 'GeosShellToggleMenu', () => { cpu.a = s.GeosMenuDesk; }, true);
            t.diagnostic(`${name} ${records.join(' ')}`);
        });
    }
}));
