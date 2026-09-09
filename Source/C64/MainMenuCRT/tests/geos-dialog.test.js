'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { desktopMachine } = require('./desktop-machine');

test('shared assembled modal input and firmware confirmation', t => desktopMachine(t, async ({ s, fresh, stub, region, capture }) => {
    const open = (cpu, mode = 1) => { cpu.a = mode; cpu.call(s.GeosDialogOpen); };
    const key = (cpu, value) => { cpu.a = value; cpu.call(s.GeosDialogKey); return cpu.a; };
    const pointer = (cpu, x, y, down) => {
        cpu.m[s.MouseActive] = 1;
        cpu.m[s.MouseLogicalX] = x / 2;
        cpu.m[s.MouseLogicalY] = y;
        cpu.m[s.MouseLeftDown] = down;
        cpu.call(s.GeosDialogPointer);
        return cpu.a;
    };
    await t.test('Return defaults to Cancel; only fresh explicit confirm paths return affirmative', () => {
        const cpu = fresh(); open(cpu);
        assert.equal(key(cpu, s.ChrReturn), 1);
        for (const value of [0x59, 0xd9]) assert.equal(key(cpu, value), 2);
        assert.equal(key(cpu, s.ChrCRSRRight), 0);
        assert.equal(key(cpu, s.ChrReturn), 2);
        for (const value of [s.ChrStop, s.ChrHome, 27, 0x4e, 0xce]) assert.equal(key(cpu, value), 1);
        for (const value of [s.ChrF1, s.ChrF5, 65]) assert.equal(key(cpu, value), 0);
        for (const mode of [0, 3]) { open(cpu, mode); assert.equal(key(cpu, 0x59), 0); }
        open(cpu, 2);
        for (const value of [0x59, s.ChrReturn, s.ChrStop]) assert.equal(key(cpu, value), 0);
    });
    await t.test('launch key and mouse hold must be released before activation', () => {
        const cpu = fresh(); cpu.m[0xcb] = 1; cpu.m[198] = 4;
        cpu.m[s.MouseLeftDown] = 1; cpu.m[s.MouseClickEdge] = 1;
        open(cpu);
        assert.equal(cpu.m[198], 0); assert.equal(cpu.m[s.MouseClickEdge], 0);
        stub(cpu, 'GetIn', c => { c.a = c.nz(0x59); });
        cpu.call(s.GeosDialogPoll); assert.equal(cpu.a, 0, 'held Y ignored');
        cpu.m[0xcb] = 64;
        cpu.call(s.GeosDialogPoll); assert.equal(cpu.a, 0, 'release drains queued repeat');
        cpu.call(s.GeosDialogPoll); assert.equal(cpu.a, 2, 'fresh Y accepted');
        assert.equal(pointer(cpu, 190, 146, 0), 0, 'opening mouse release ignored');
        assert.equal(pointer(cpu, 190, 146, 1), 0, 'press alone does not confirm');
        assert.equal(pointer(cpu, 190, 146, 0), 2);
    });
    await t.test('buttons and X use matching press/release within their visible rectangles', () => {
        for (const [x, y, expected] of [[62, 142, 1], [142, 152, 1], [174, 142, 2], [254, 152, 2], [282, 44, 1], [292, 54, 1]]) {
            const cpu = fresh(); open(cpu);
            assert.equal(pointer(cpu, x, y, 1), 0);
            assert.equal(pointer(cpu, x, y, 0), expected, `${x},${y}`);
        }
        for (const [x, y] of [[60, 142], [144, 142], [172, 142], [256, 142], [190, 141], [190, 153], [282, 55]]) {
            const cpu = fresh(); open(cpu);
            assert.equal(pointer(cpu, x, y, 1), 0);
            assert.equal(pointer(cpu, x, y, 0), 0, `outside ${x},${y}`);
        }
        for (const [endX, endY] of [[20, 20], [80, 146], [282, 48]]) {
            const cpu = fresh(); open(cpu);
            pointer(cpu, 190, 146, 1);
            assert.equal(pointer(cpu, endX, endY, 0), 0, 'dragging to another control cannot activate');
        }
        const cpu = fresh(); open(cpu);
        pointer(cpu, 282, 48, 1);
        assert.equal(pointer(cpu, 80, 146, 0), 0, 'X and Cancel are distinct hit targets');
    });
    await t.test('joystick fire and direction require a fresh edge', () => {
        const cpu = fresh(); cpu.m[s.Joystick2Sample] = 0xef; open(cpu);
        cpu.call(s.GeosDialogJoystick); assert.equal(cpu.a, 0);
        cpu.m[s.Joystick2Sample] = 255; cpu.call(s.GeosDialogJoystick); assert.equal(cpu.a, 0);
        cpu.m[s.Joystick2Sample] = 0xf7; cpu.call(s.GeosDialogJoystick); assert.equal(cpu.a, 0);
        cpu.m[s.Joystick2Sample] = 0xef; cpu.call(s.GeosDialogJoystick); assert.equal(cpu.a, 2);
        cpu.call(s.GeosDialogJoystick); assert.equal(cpu.a, 0);
    });
    await t.test('firmware presents every exact filename byte and waits for affirmative before disabling mouse IRQ', () => {
        const names = [
            ['MPE_Firmware-V1.0.5.hex', 'firmware-confirmation'],
            ['MPE_Firmware-v1.0.4.' + 'aB_{x}.'.repeat(33) + '.hex', 'firmware-long-filename'],
        ];
        for (const [name, artifact] of names) for (const answer of [s.ChrReturn, 0x4e, 0x59]) {
            const cpu = fresh(), calls = [], glyphs = [];
            let serial = 0;
            cpu.m[s.IO1Port + s.rRegItemTypePlusIOH] = s.rtFileHex;
            cpu.m[s.IO1Port + s.rRegFirmwareTargetState] = 1;
            cpu.onWrite = (address, value) => {
                if (address === s.IO1Port + s.rwRegSerialString) {
                    assert.equal(value, s.rsstFirmwareName); serial = 0;
                }
                if (address === s.IO1Port + s.wRegControl) calls.push(value);
            };
            const step = cpu.step.bind(cpu);
            cpu.step = () => {
                const address = cpu.m[cpu.pc + 1] | cpu.m[cpu.pc + 2] << 8;
                if (cpu.m[cpu.pc] === 0xad && address === s.IO1Port + s.rwRegSerialString) cpu.m[address] = serial < name.length ? name.charCodeAt(serial++) : 0;
                step();
            };
            cpu.hooks.set(s.GeosDialogGlyph, c => {
                if (c.m[s.RichY] < 120) glyphs.push([c.a, c.m[s.RichX] + c.m[s.RichXHi] * 256, c.m[s.RichY]]);
            });
            stub(cpu, 'GetIn', c => {
                assert.deepEqual(calls, [s.rCtlFirmwarePrepareWAIT], 'only read-only capture before answer');
                assert.ok(region(c, 31, 60, 258, 57).includes(1), 'filename visible before answer');
                capture(c, artifact);
                c.a = c.nz(answer);
            });
            stub(cpu, 'WaitForTRWaitMsg');
            for (const label of ['IRQDisable', 'StartSelItem_WaitForTRDots', 'AnyKeyErrMsgWait', 'ListAndDone']) stub(cpu, label, () => calls.push(label));
            stub(cpu, 'PrintBanner', () => assert.fail('desktop confirmation must remain bitmap'));
            cpu.a = s.rtFileHex; cpu.call(s.RunSelectedBinary);
            assert.equal(Buffer.from(glyphs.map(g => g[0])).toString('ascii'), name);
            assert.ok(glyphs.every(([, x, y]) => x >= 31 && x <= 283 && y >= 60 && y <= 110));
            assert.deepEqual(calls, answer === 0x59 ? [s.rCtlFirmwarePrepareWAIT, s.rCtlFirmwareCheckWAIT,
                'IRQDisable', 'StartSelItem_WaitForTRDots', 'AnyKeyErrMsgWait', s.rCtlFirmwareCancel, 'ListAndDone'] :
                [s.rCtlFirmwarePrepareWAIT, s.rCtlFirmwareCancel, 'ListAndDone']);
        }
    });
    await t.test('invalid preparation and changed target check prevent update and clear capture', () => {
        for (const failPrepare of [true, false]) {
            const cpu = fresh(), commands = [], calls = [], glyphs = [];
            const answers = failPrepare ? [s.ChrReturn] : [0x59, s.ChrReturn];
            cpu.onWrite = (address, value) => {
                if (address === s.IO1Port + s.wRegControl) commands.push(value);
            };
            const step = cpu.step.bind(cpu);
            cpu.step = () => {
                const address = cpu.m[cpu.pc + 1] | cpu.m[cpu.pc + 2] << 8;
                if (cpu.m[cpu.pc] === 0xad && address === s.IO1Port + s.rwRegSerialString) cpu.m[address] = 0;
                step();
            };
            stub(cpu, 'WaitForTRWaitMsg', c => {
                const changed = failPrepare || commands.at(-1) === s.rCtlFirmwareCheckWAIT;
                c.m[s.IO1Port + s.rRegFirmwareTargetState] = changed ? 2 : 1;
            });
            stub(cpu, 'GetIn', c => { assert.ok(answers.length); c.a = c.nz(answers.shift()); });
            for (const label of ['IRQDisable', 'StartSelItem_WaitForTRDots']) stub(cpu, label, () => assert.fail('changed firmware target must not start'));
            stub(cpu, 'ListAndDone', () => calls.push('done'));
            cpu.hooks.set(s.GeosDialogGlyph, c => glyphs.push(c.a));
            cpu.call(s.GeosFirmwareConfirm);
            assert.deepEqual(commands, failPrepare ? [s.rCtlFirmwarePrepareWAIT, s.rCtlFirmwareCancel] :
                [s.rCtlFirmwarePrepareWAIT, s.rCtlFirmwareCheckWAIT, s.rCtlFirmwareCancel]);
            assert.deepEqual(calls, ['done']);
            assert.ok(Buffer.from(glyphs).toString('ascii').includes('Firmware selection changed. Choose the file again.'));
        }
    });
}));
