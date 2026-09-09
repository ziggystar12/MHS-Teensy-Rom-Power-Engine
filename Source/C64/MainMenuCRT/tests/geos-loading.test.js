'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { desktopMachine } = require('./desktop-machine');
const { backendPETSCII } = require('./backend-petscii');

test('assembled shared loading/status display and launch routing', t => desktopMachine(t, async ({ s, fresh, stub, pixel, region, local, capture }) => {
    const seeded = () => {
        const cpu = fresh();
        cpu.m.fill(0x55, s.GeosBitmapRAM, s.GeosBitmapRAMEnd);
        cpu.m.fill(0xaa, s.GeosRichCanvas, s.GeosRichCanvas + 8000);
        cpu.m.fill(0x61, s.C64ScreenRAM, s.C64ScreenRAM + 1000);
        return cpu;
    };
    const outsideIntact = cpu => {
        for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
            if (x >= 24 && x < 296 && y >= 42 && y < 158) continue;
            assert.equal(pixel(cpu, x, y), x % 2, `outside pixel ${x},${y}`);
        }
        for (let row = 0; row < 25; row++) for (let col = 0; col < 40; col++) {
            if (row >= 5 && row < 20 && col >= 3 && col < 37) continue;
            assert.equal(cpu.m[s.C64ScreenRAM + row * 40 + col], 0x61);
        }
    };
    await t.test('frame publication preserves exact outside pixels and publishes pixels before colors', () => {
        const cpu = seeded(), writes = []; cpu.p &= ~4;
        cpu.onWrite = address => writes.push(address);
        cpu.call(s.GeosBitmapWaitBegin);
        assert.equal(cpu.m[1], 0x37); assert.equal(cpu.p & 4, 0);
        outsideIntact(cpu);
        for (let x = 24; x < 296; x++) assert.ok(pixel(cpu, x, 42) && pixel(cpu, x, 157));
        for (let y = 42; y < 158; y++) assert.ok(pixel(cpu, 24, y) && pixel(cpu, 295, y));
        const lastPixel = writes.findLastIndex(a => a >= s.GeosBitmapRAM && a < s.GeosBitmapRAMEnd);
        const firstColor = writes.findIndex(a => a >= s.C64ScreenRAM && a < s.C64ScreenRAM + 1000);
        assert.ok(lastPixel < firstColor, 'complete bitmap precedes palette');
        assert.ok(!writes.some(a => [0xd011, 0xd016, 0xd018].includes(a)), 'no VIC mode change');
    });
    await t.test('activity fills left to right on CIA tenths without claiming a percentage', () => {
        const cpu = seeded(); cpu.call(s.GeosBitmapWaitBegin);
        assert.equal(cpu.m[s.GeosBitmapWaitCol], 10, 'ten complete sweeps remain before a preflight timeout');
        const initial = region(cpu, 31, 132, 258, 7);
        cpu.call(s.GeosBitmapWaitAnimate); assert.deepEqual(region(cpu, 31, 132, 258, 7), initial);
        const writes = [];
        cpu.onWrite = address => {
            if (address >= s.GeosBitmapRAM && address < s.GeosBitmapRAMEnd) {
                const offset = address - s.GeosBitmapRAM;
                const y = Math.floor(offset / 320) * 8 + (offset & 7), col = Math.floor(offset % 320 / 8);
                assert.ok(y >= 132 && y < 139 && col >= 3 && col < 37, 'activity publishes only its seven scanlines');
                writes.push('pixel');
            }
            if (address >= s.C64ScreenRAM && address < s.C64ScreenRAM + 1000) {
                const offset = address - s.C64ScreenRAM, row = Math.floor(offset / 40), col = offset % 40;
                assert.ok(row >= 16 && row < 18 && col >= 3 && col < 37, 'activity publishes only touched color cells');
                writes.push('color');
            }
        };
        for (let step = 1; step <= 29; step++) {
            writes.length = 0;
            cpu.m[s.TODTenthSecBCD] = (3 + step) % 10; cpu.call(s.GeosBitmapWaitAnimate);
            const phase = step % 29; assert.equal(cpu.m[s.GeosBitmapWaitPhase], phase);
            const fillRight = 33 + phase * 9 + 2;
            for (let x = 33; x < 287; x++) assert.equal(pixel(cpu, x, 135), Number(x < fillRight));
            assert.equal(pixel(cpu, 33, 135), 1, 'fill stays anchored at the left edge');
            if (phase === 28) assert.ok(region(cpu, 33, 134, 254, 3).every(x => x), 'last phase fills the track');
            assert.ok(writes.includes('pixel') && writes.includes('color'));
            assert.ok(writes.lastIndexOf('pixel') < writes.indexOf('color'), 'activity pixels precede their colors');
        }
        assert.equal(cpu.m[s.GeosBitmapWaitCol], 9, 'one complete 29-tenth sweep consumes one timeout unit');
        assert.deepEqual(region(cpu, 31, 132, 258, 7), initial); outsideIntact(cpu);
    });
    await t.test('firmware preflight has deterministic STOP, click, and 29-second timeout cancellation', () => {
        const ioStatus = s.IO1Port + s.rwRegStatus, ioControl = s.IO1Port + s.wRegControl;
        const run = reason => {
            const cpu = seeded(), commands = []; let polls = 0;
            cpu.m[ioStatus] = 0;
            cpu.onWrite = (address, value) => { if (address === ioControl) commands.push(value); };
            if (reason === 'STOP') stub(cpu, 'GetIn', current => { current.a = current.nz(s.ChrStop); });
            cpu.hooks.set(s.UiWaitPoll, current => {
                polls++;
                if (reason === 'click') current.m[s.MouseClickEdge] = 1;
                if (reason === 'timeout' && polls === 1) {
                    current.m[s.GeosBitmapWaitCol] = 1;
                    current.m[s.GeosBitmapWaitPhase] = 28;
                    current.m[s.TODTenthSecBCD] = (current.m[s.TODTenthSecBCD] + 1) % 10;
                }
            });
            cpu.a = s.rCtlFirmwareDiscoverWAIT;
            cpu.call(s.GeosFirmwareRequest);
            assert.equal(cpu.a, s.rCtlFirmwareCancel, `${reason} reports a cancelled request`);
            assert.equal(cpu.p & 2, 0, `${reason} cannot be mistaken for target state 1`);
            assert.equal(cpu.m[s.UiWaitCancelable], 0, `${reason} disarms the preflight hook`);
            assert.deepEqual(commands, [s.rCtlFirmwareDiscoverWAIT, s.rCtlFirmwareCancel]);
            return polls;
        };
        assert.equal(run('STOP'), 1);
        assert.equal(run('click'), 1);
        assert.equal(run('timeout'), 2, 'the final activity wrap reaches zero and exits on its next poll');
    });
    await t.test('actual firmware movement stays non-cancellable after preflight', () => {
        const cpu = seeded(), ioStatus = s.IO1Port + s.rwRegStatus, ioControl = s.IO1Port + s.wRegControl;
        const commands = []; let polls = 0, keyReads = 0;
        cpu.p |= 4;
        cpu.m[ioStatus] = 0;
        stub(cpu, 'GetIn', current => { keyReads++; current.a = current.nz(s.ChrStop); });
        cpu.onWrite = (address, value) => { if (address === ioControl) commands.push(value); };
        cpu.hooks.set(s.UiWaitPoll, current => {
            polls++;
            current.m[s.MouseClickEdge] = 1;
            current.m[s.GeosBitmapWaitCol] = 0;
            if (polls === 3) current.m[ioStatus] = s.rsReady;
        });
        cpu.call(s.StartSelItem_WaitForTRDots);
        assert.equal(polls, 3, 'transfer ignores cancel inputs until the backend becomes ready');
        assert.equal(keyReads, 0, 'non-cancellable transfer does not consume STOP');
        assert.deepEqual(commands, [s.rCtlStartSelItemWAIT]);
        assert.equal(cpu.p & 1, 1, 'stable ready returns the normal completion state');
    });
    await t.test('stable ready and message handshake fully drains serial input before acknowledging', () => {
        const cpu = seeded(), ioStatus = s.IO1Port + s.rwRegStatus, ioString = s.IO1Port + s.rwRegSerialString;
        const statuses = [s.rsReady, 0, ...Array(6).fill(s.rsC64Message), ...Array(6).fill(s.rsReady)];
        const message = Buffer.concat([Buffer.from([5, 0x90]), backendPETSCII('FILE ERROR: ' + 'X'.repeat(300)), Buffer.from([0])]);
        const visible = [], positions = [], acknowledgements = []; let reads = 0, serial = 0, selected = false;
        const step = cpu.step.bind(cpu);
        cpu.step = () => {
            const opcode = cpu.m[cpu.pc], address = cpu.m[cpu.pc + 1] | cpu.m[cpu.pc + 2] << 8;
            if ([0xad, 0xcd].includes(opcode) && address === ioStatus) { assert.ok(statuses.length); cpu.m[address] = statuses.shift(); reads++; }
            if (opcode === 0xad && address === ioString) { assert.ok(selected); cpu.m[address] = message[serial++]; }
            step();
        };
        cpu.onWrite = (address, value) => {
            if (address === ioString) { assert.equal(value, s.rsstSerialStringBuf); selected = true; }
            if (address === ioStatus) acknowledgements.push([value, reads, serial]);
        };
        cpu.hooks.set(s.GeosDialogGlyph, c => { visible.push(c.a); positions.push([c.m[s.RichX] + c.m[s.RichXHi] * 256, c.m[s.RichY]]); });
        cpu.call(s.WaitForTRWaitMsg);
        assert.deepEqual(acknowledgements, [[s.rsContinue, 8, message.length]]);
        assert.equal(statuses.length, 0); assert.equal(visible.length, 258);
        assert.equal(Buffer.from(visible.slice(0, 12)).toString('ascii'), 'FILE ERROR: ');
        assert.deepEqual(positions, Array.from({ length: 258 }, (_, i) => [31 + i % 43 * 6, 60 + Math.floor(i / 43) * 10]));
        outsideIntact(cpu);
    });
    await t.test('error retains the complete body until the shared OK result', () => {
        const cpu = seeded(); cpu.call(s.GeosBitmapWaitBegin);
        local(cpu, 'FILE COULD NOT BE LOADED. ' + 'CHECK THE MEDIA AND TRY AGAIN. '.repeat(7));
        capture(cpu, 'loading-message');
        const body = region(cpu, 31, 60, 258, 59); let inputs = 0;
        stub(cpu, 'IRQEnable');
        stub(cpu, 'GetIn', c => { assert.deepEqual(region(c, 31, 60, 258, 59), body); inputs++; c.a = c.nz(s.ChrReturn); });
        stub(cpu, 'PrintString', () => assert.fail('bitmap error must not use KERNAL text'));
        cpu.call(s.AnyKeyErrMsgWait);
        capture(cpu, 'error-message');
        assert.equal(inputs, 1); assert.deepEqual(region(cpu, 31, 60, 258, 59), body);
        assert.ok(region(cpu, 284, 46, 7, 7).includes(1), 'error restores its actionable close glyph');
        assert.ok(region(cpu, 31, 132, 258, 7).every(x => !x), 'activity removed'); outsideIntact(cpu);
    });
    await t.test('short message clears stale body; animation does not clear the latest message', () => {
        const cpu = seeded(); cpu.call(s.GeosBitmapWaitBegin);
        const heading = region(cpu, 31, 45, 240, 10), track = region(cpu, 31, 132, 258, 7);
        local(cpu, 'X'.repeat(258)); assert.ok(region(cpu, 31, 110, 258, 7).includes(1));
        local(cpu, 'READY'); assert.ok(region(cpu, 31, 60, 30, 7).includes(1));
        assert.ok(region(cpu, 31, 70, 258, 49).every(x => !x));
        assert.deepEqual(region(cpu, 31, 45, 240, 10), heading); assert.deepEqual(region(cpu, 31, 132, 258, 7), track);
        cpu.m[s.TODTenthSecBCD]++; cpu.call(s.GeosBitmapWaitAnimate); assert.ok(region(cpu, 31, 60, 30, 7).includes(1)); outsideIntact(cpu);
    });
    await t.test('information uses the same window and OK button without waiting or accessing backend', () => {
        const cpu = seeded(), headings = []; cpu.p &= ~4;
        cpu.hooks.set(s.RichText, c => headings.push(c.a | c.y << 8));
        const step = cpu.step.bind(cpu);
        cpu.step = () => {
            const opcode = cpu.m[cpu.pc], address = cpu.m[cpu.pc + 1] | cpu.m[cpu.pc + 2] << 8;
            assert.ok(!([0xad, 0x8d, 0xcd].includes(opcode) && address >= s.IO1Port && address < s.IO1Port + 256)); step();
        };
        local(cpu, 'DEVICE NOT PRESENT. CHECK THE DRIVE CONNECTION AND TRY AGAIN.', 'GeosBitmapShowMessage');
        assert.deepEqual(headings, [s.MsgGeosInformation, s.GeosDialogOKText]);
        assert.ok(region(cpu, 31, 70, 258, 7).includes(1)); assert.ok(region(cpu, 62, 142, 82, 11).includes(1));
        assert.equal(cpu.m[1], 0x37); assert.equal(cpu.p & 4, 0); outsideIntact(cpu);
    });
    await t.test('classic firmware and SID/art viewer paths retain their original text launch behavior', () => {
        for (const [type, viewer] of [[s.rtFileHex, null], [s.rtFileSID, 'SIDLoadInit'], [s.rtFileKla, 'LoadViewKoala'], [s.rtFileArt, 'LoadViewKoala']]) {
            const cpu = fresh(), calls = [];
            cpu.m[s.GeosBitmapActive] = type === s.rtFileHex ? 0 : 1;
            cpu.m[s.IO1Port + s.rRegItemTypePlusIOH] = type; cpu.m[s.IO1Port + s.rRegStrAvailable] = 1;
            for (const label of ['Mouse1351Hide', 'IRQDisable', 'IRQEnable', 'SendChar', 'PrintSerialString', 'PrintString', 'SIDLoadInit', 'ShowSIDInfoPage', 'LoadViewKoala', 'XferCopyRun', 'AnyKeyErrMsgWait', 'ListMenuItems']) stub(cpu, label, () => calls.push(label));
            stub(cpu, 'PrintBanner', c => { calls.push('PrintBanner'); c.m[s.GeosBitmapActive] = 0; });
            stub(cpu, 'GetIn', c => { c.a = c.nz(0x4e); });
            stub(cpu, 'StartSelItem_WaitForTRDots', () => calls.push('start'));
            cpu.call(s.RunSelected);
            assert.ok(calls.includes('PrintBanner')); if (viewer) assert.ok(calls.includes(viewer)); else assert.ok(!calls.includes('start'));
        }
    });
    await t.test('ROM and PRG launches keep bitmap while compact launches retain their banner', () => {
        for (const type of [s.rtFileCrt, s.rtFilePrg, s.rtFileP00]) for (const bitmap of [0, 1]) {
            const cpu = fresh(), calls = [];
            cpu.m[s.GeosBitmapActive] = bitmap;
            cpu.m[s.IO1Port + s.rRegItemTypePlusIOH] = type;
            cpu.m[s.IO1Port + s.rRegStrAvailable] = 1;
            for (const label of ['Mouse1351Hide', 'IRQDisable', 'IRQEnable', 'XferCopyRun', 'AnyKeyErrMsgWait', 'ListMenuItems']) stub(cpu, label, () => calls.push(label));
            stub(cpu, 'PrintBanner', c => { calls.push('PrintBanner'); c.m[s.GeosBitmapActive] = 0; });
            stub(cpu, 'StartSelItem_WaitForTRDots', c => calls.push(['start', c.m[s.GeosBitmapActive]]));
            cpu.call(s.RunSelected);
            assert.deepEqual(calls.filter(Array.isArray), [['start', bitmap]]);
            assert.equal(calls.includes('PrintBanner'), !bitmap);
            assert.ok(calls.includes('XferCopyRun'));
        }
    });
}));
