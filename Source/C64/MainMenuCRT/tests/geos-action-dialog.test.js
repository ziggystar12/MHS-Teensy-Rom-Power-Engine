'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { desktopMachine } = require('./desktop-machine');
const { backendPETSCII } = require('./backend-petscii');

test('normal desktop shortcut and NFC prompts execute shared bitmap dialogs', t => desktopMachine(t, async ({ s, fresh, stub, region, capture }) => {
    const fixture = (options = {}) => {
        const cpu = fresh(), io = s.IO1Port;
        cpu.m[s.GeosSurfaceMode] = s.GeosSurfaceBrowser;
        const state = { commands: [], frames: [], redraws: 0, highlights: 0, launches: 0, pending: false,
            message: backendPETSCII(options.message || 'Operation completed for Text.txt'), serial: 0,
            answers: [...(options.answers || [s.ChrReturn])], glyphs: [] };
        const step = cpu.step.bind(cpu);
        cpu.step = () => {
            const opcode = cpu.m[cpu.pc], address = cpu.m[cpu.pc + 1] | cpu.m[cpu.pc + 2] << 8;
            if ([0xad, 0xcd].includes(opcode) && address === io + s.rwRegStatus) cpu.m[address] = state.pending ? s.rsC64Message : s.rsReady;
            if (opcode === 0xad && address === io + s.rwRegSerialString) cpu.m[address] = state.message[state.serial++] || 0;
            step();
        };
        cpu.onWrite = (address, value) => {
            if (address === io + s.wRegControl) {
                state.commands.push(value); state.pending = true;
                if (value === s.rCtlMountDxxFileWAIT) cpu.m[io + s.rwRegScratch] = options.mountReady === false ? 0 : 1;
                if (value === s.rCtlWriteNFCTagCheckWAIT) cpu.m[io + s.rRegLastHourBCD] = options.nfcReady === false ? 0 : 1;
            }
            if (address === io + s.rwRegSerialString) { assert.equal(value, s.rsstSerialStringBuf); state.serial = 0; }
            if (address === io + s.rwRegStatus && value === s.rsContinue) state.pending = false;
            assert.ok(![0xd011, 0xd016, 0xd018].includes(address), 'prompt cannot change VIC mode');
        };
        stub(cpu, 'PrintBanner', () => assert.fail('ordinary desktop action cannot open a text banner'));
        stub(cpu, 'TextScreenMemColor', () => assert.fail('ordinary desktop action cannot switch to text'));
        stub(cpu, 'ListMenuItems', () => state.redraws++);
        stub(cpu, 'HighlightCurrent', () => state.highlights++);
        stub(cpu, 'Load8Run', () => state.launches++);
        stub(cpu, 'GetIn', c => {
            assert.ok(state.answers.length, 'modal consumes only supplied input');
            assert.equal(c.m[s.GeosBitmapActive], 1);
            assert.ok(region(c, 24, 42, 272, 116).includes(1), 'actual dialog pixels precede input');
            assert.deepEqual(region(c, 31, 60, 258, 59), state.lastBackendBody, 'filename/result/error survives instruction and button changes');
            state.frames.push(c.m[s.GeosDialogMode]);
            const value = state.answers.shift(); c.a = c.nz(value);
            if (options.capture) capture(c, options.capture);
        });
        cpu.hooks.set(s.GeosDialogGlyph, c => state.glyphs.push(c.a));
        cpu.hooks.set(s.GeosBitmapWaitDone, c => { state.lastBackendBody = region(c, 31, 60, 258, 59); });
        return { cpu, state };
    };
    const key = (value, options) => {
        const context = fixture(options); context.cpu.a = value; context.cpu.call(s.ReadKeyboardReady); return context;
    };
    await t.test('auto-launch, KERNAL, REU and all hotkey assignments keep their exact commands', () => {
        for (const [value, command] of [[0xc1, s.rCtlSetAutoLaunchWAIT], [0xcb, s.rCtlSetKERNALBinWAIT], [0xd2, s.rCtlSetREUFileWAIT]]) {
            const { state } = key(value); assert.deepEqual(state.commands, [command]); assert.deepEqual(state.frames, [0]);
            assert.equal(state.redraws, 1); assert.equal(state.highlights, 1);
            assert.ok(Buffer.from(state.glyphs).toString('ascii').includes('Operation completed for Text.txt'));
        }
        for (let index = 0; index < s.NumHotKeys; index++) {
            const { cpu, state } = key(33 + index); assert.deepEqual(state.commands, [s.rCtlHotKeySetLaunch]);
            assert.equal(cpu.m[s.IO1Port + s.rwRegScratch], 128 | index);
        }
    });
    await t.test('mounting offers Cancel by default and runs only on explicit confirmation', () => {
        for (const [answer, launches] of [[s.ChrReturn, 0], [0x4e, 0], [0x59, 1]]) {
            const { state } = key(0xcd, { answers: [answer], capture: 'disk-run-confirmation' });
            assert.deepEqual(state.commands, [s.rCtlMountDxxFileWAIT]); assert.equal(state.launches, launches);
            assert.deepEqual(state.frames, [1]);
        }
        const { state } = key(0xcd, { mountReady: false }); assert.equal(state.launches, 0); assert.deepEqual(state.frames, [0]);
    });
    await t.test('NFC cancel never writes; explicit Write and every outcome re-enable the NFC service', () => {
        for (const [answer, write] of [[s.ChrReturn, false], [0x4e, false], [0x59, true]]) {
            const { state } = key(s.ChrLeftArrow, { answers: [answer, s.ChrReturn] });
            assert.deepEqual(state.commands, [s.rCtlWriteNFCTagCheckWAIT, ...(write ? [s.rCtlWriteNFCTagWAIT] : []), s.rCtlNFCReEnableWAIT]);
            assert.deepEqual(state.frames, [1, 0]); assert.equal(state.highlights, 1);
        }
        const { state } = key(s.ChrQuestionMark, { nfcReady: false, message: 'NFC reader error', answers: [s.ChrReturn] });
        assert.deepEqual(state.commands, [s.rCtlWriteNFCTagCheckWAIT, s.rCtlNFCReEnableWAIT]);
        assert.ok(Buffer.from(state.glyphs).toString('ascii').includes('NFC reader error'));
        assert.ok(Buffer.from(state.glyphs).toString('ascii').includes('Remove the tag, then choose OK.'));
    });
    await t.test('classic view and unrelated keys retain their existing routing', () => {
        for (const value of [0xc1, 0xcb, 0xd2, 0xcd, 33]) {
            const { cpu, state } = fixture(); cpu.m[s.GeosBitmapActive] = 0;
            cpu.a = value; cpu.call(s.GeosActionKey); assert.equal(cpu.p & 1, 0); assert.equal(cpu.a, value); assert.deepEqual(state.commands, []);
        }
        for (const value of [s.ChrF1, s.ChrF5, 0x41]) {
            const { cpu, state } = fixture(); cpu.a = value; cpu.call(s.GeosActionKey);
            assert.equal(cpu.p & 1, 0); assert.equal(cpu.a, value); assert.deepEqual(state.commands, []);
        }
    });
}));
