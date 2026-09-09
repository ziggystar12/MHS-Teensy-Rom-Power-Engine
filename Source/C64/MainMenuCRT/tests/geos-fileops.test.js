'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { desktopMachine } = require('./desktop-machine');
const { backendPETSCII } = require('./backend-petscii');

test('file operations execute current desktop routing through shared modal', t => desktopMachine(t, async ({ s, fresh, stub, region }) => {
    const fixture = (options = {}) => {
        const cpu = fresh(), io = s.IO1Port;
        cpu.m[s.GeosSurfaceMode] = options.surface ?? s.GeosSurfaceBrowser;
        cpu.m[io + s.rWRegCurrMenuWAIT] = options.source ?? s.rmtSD;
        cpu.m[io + s.rwRegCursorItemOnPg] = 7;
        const state = { status: options.status ?? 0, progress: 0, commands: [], writes: [], redraws: 0, waits: 0,
            events: [...(options.events || [])], glyphs: [], serialReads: [], names: 0, messages: 0,
            name: Buffer.from(options.name || 'Text_Name{1}.txt', 'latin1'), message: backendPETSCII('RESULT'), selector: 0, serial: 0 };
        const step = cpu.step.bind(cpu);
        cpu.step = () => {
            const opcode = cpu.m[cpu.pc], address = cpu.m[cpu.pc + 1] | cpu.m[cpu.pc + 2] << 8;
            if (opcode === 0xad) {
                if (address === io + s.rRegFileOpState) cpu.m[address] = state.status;
                if (address === io + s.rRegFileOpProgress) cpu.m[address] = state.progress;
                if (address === io + s.rwRegSerialString) {
                    const bytes = state.selector === s.rsstFileOpName ? state.name : state.message;
                    cpu.m[address] = bytes[state.serial++] || 0; state.serialReads.push([state.selector, cpu.m[address]]);
                }
            }
            step();
        };
        cpu.onWrite = (address, value) => {
            if (address < io || address >= io + 256) return;
            state.writes.push([address - io, value]);
            if (address === io + s.rwRegSerialString) {
                state.selector = value; state.serial = 0;
                if (value === s.rsstFileOpName) state.names++; else if (value === s.rsstFileOpMessage) state.messages++;
            }
            if (address === io + s.wRegControl) {
                state.commands.push(value);
                const transitions = options.transitions || { 57: 2, 58: 3, 59: 6, 60: 5, 61: 4 };
                if (Object.hasOwn(transitions, value)) state.status = transitions[value];
            }
        };
        stub(cpu, 'WaitForTRWaitMsg', () => state.waits++);
        stub(cpu, 'GeosShellRedraw', () => state.redraws++);
        stub(cpu, 'GetIn', c => {
            assert.ok(state.events.length, `input exhausted: status${state.status}, commands${state.commands}`);
            const event = state.events.shift(), value = typeof event === 'function' ? event(c, state) : event;
            c.a = c.nz(typeof value === 'string' ? value.charCodeAt(0) : value || 0);
        });
        cpu.hooks.set(s.GeosDialogGlyph, c => {
            if (c.m[s.RichY] < 120) state.glyphs.push([c.a, c.m[s.RichX] + c.m[s.RichXHi] * 256, c.m[s.RichY]]);
        });
        return { cpu, state };
    };
    const run = (entry, options) => { const context = fixture(options); context.cpu.call(s[entry]); return context; };
    const mouse = (x, y, down) => c => {
        c.m[s.MouseActive] = 1; c.m[s.MouseLogicalX] = x / 2; c.m[s.MouseLogicalY] = y; c.m[s.MouseLeftDown] = down; return 0;
    };
    await t.test('protocol constants and removable-device scope remain enforced', () => {
        for (const [name, value] of Object.entries({ rCtlFileCopyWAIT: 57, rCtlFilePasteWAIT: 58, rCtlFileDeletePrepareWAIT: 59,
            rCtlFileCancel: 60, rCtlFileDeleteConfirmWAIT: 61, rRegFileOpState: 63, rsstFileOpName: 9, rsstFileOpMessage: 10 })) assert.equal(s[name], value);
        for (const entry of ['GeosFileCopy', 'GeosFilePaste', 'GeosFileDelete']) for (const [surface, source] of [[0, 1], [2, 1], [1, 2], [1, 3], [1, 255]]) {
            const { cpu, state } = run(entry, { surface, source });
            assert.deepEqual(state.writes, []); assert.equal(cpu.m[s.GeosNotice], s.GeosNoticeFileScope); assert.equal(state.redraws, 1);
        }
    });
    await t.test('Edit menu copy/paste and shifted shortcuts retain correct captured selection', () => {
        for (const source of [s.rmtSD, s.rmtUSBDrive]) for (const [selection, command] of [[0, 57], [1, 58]]) {
            const { cpu, state } = fixture({ source, events: [s.ChrReturn] });
            cpu.m[s.GeosActiveMenu] = s.GeosMenuEdit; cpu.m[s.GeosMenuSelection] = selection; cpu.m[s.GeosOverlayMode] = s.GeosOverlayMenu;
            cpu.call(s.GeosShellMenuActivate);
            assert.deepEqual(state.commands, [command]); assert.deepEqual(state.writes[0], [s.rwRegSelItemOnPage, 7]); assert.equal(state.redraws, 1);
        }
        for (const [key, command] of [[0xc3, 57], [0xd0, 58], [0xc4, 59]]) {
            const { cpu, state } = fixture({ events: command === 59 ? [s.ChrReturn, s.ChrReturn] : [s.ChrReturn] });
            cpu.a = key; cpu.call(s.GeosShellHandleKey); assert.deepEqual(state.commands, command === 59 ? [59, 60] : [command]);
        }
        for (const key of [0x43, 0x50, 0x44]) { const { cpu, state } = fixture(); cpu.a = key; cpu.call(s.GeosShellHandleKey); assert.deepEqual(state.commands, []); }
        for (const overlay of [s.GeosOverlayMenu, s.GeosOverlayControl, s.GeosOverlayArrange]) {
            const { cpu, state } = fixture(); cpu.m[s.GeosOverlayMode] = overlay;
            cpu.a = 0xc4; cpu.call(s.GeosShellHandleKey); assert.deepEqual(state.commands, [], 'open overlay keeps shortcut ownership');
        }
    });
    await t.test('delete defaults to Cancel; only Y or selected affirmative confirms prepared state', () => {
        const cancel = run('GeosFileDelete', { events: [s.ChrReturn, s.ChrReturn] }); assert.deepEqual(cancel.state.commands, [59, 60]);
        for (const events of [[0x59, s.ChrReturn], [0xd9, s.ChrReturn], [s.ChrCRSRRight, s.ChrReturn, s.ChrReturn]]) {
            const { state } = run('GeosFileDelete', { events }); assert.deepEqual(state.commands, [59, 61]); assert.equal(state.waits, 2);
        }
        const { cpu, state } = fixture({ status: 3 });
        cpu.m[s.GeosFileLastState] = 6;
        stub(cpu, 'GeosFileLoop');
        cpu.call(s.GeosFileConfirm); assert.deepEqual(state.commands, [], 'stale drawn confirmation cannot authorize current target');
    });
    await t.test('cancel aliases and irrelevant navigation never escape the modal', () => {
        for (const key of [s.ChrStop, s.ChrHome, 27, 0x4e, 0xce]) {
            const { state } = run('GeosFileDelete', { events: [key, s.ChrReturn] }); assert.deepEqual(state.commands, [59, 60]);
        }
        const { state } = run('GeosFilePaste', { transitions: { 58: 1, 60: 5 }, events: [s.ChrF1, s.ChrF5, s.ChrUpArrow, s.ChrHome, s.ChrReturn] });
        assert.deepEqual(state.commands, [58, 60]);
    });
    await t.test('mouse confirms only matching visible button press/release, not the opening click', () => {
        const approved = run('GeosFileDelete', { events: [mouse(190, 146, 1), mouse(190, 146, 0), s.ChrReturn] });
        assert.deepEqual(approved.state.commands, [59, 61]);
        const dragged = run('GeosFileDelete', { events: [mouse(190, 146, 1), mouse(80, 146, 0), s.ChrReturn, s.ChrReturn] });
        assert.deepEqual(dragged.state.commands, [59, 60]);
        const held = fixture({ events: [mouse(190, 146, 0), s.ChrReturn, s.ChrReturn] });
        held.cpu.m[s.MouseLeftDown] = 1; held.cpu.m[s.MouseClickEdge] = 1; held.cpu.call(s.GeosFileDelete);
        assert.deepEqual(held.state.commands, [59, 60]);
    });
    await t.test('busy progress changes its bar without rereading the name; terminal states await OK', () => {
        const { cpu, state } = run('GeosFilePaste', { transitions: { 58: 1 }, events: [(_c, st) => { st.progress = 25; }, (c, st) => {
            assert.equal(st.names, 1); assert.ok(region(c, 60, 134, 50, 3).every(x => x)); st.progress = 80;
        }, (_c, st) => { st.status = 3; }, 'Y', s.ChrReturn] });
        assert.deepEqual(state.commands, [58]); assert.equal(state.names, 2); assert.equal(state.redraws, 1); assert.equal(cpu.m[s.GeosFileLastState], 3);
        for (const status of [2, 3, 4, 5]) assert.deepEqual(run('GeosFileCopy', { transitions: { 57: status }, events: ['Y', s.ChrReturn] }).state.commands, [57]);
    });
    await t.test('complete255-byte filenames preserve case/dots and sanitize controls within six rows', () => {
        const name = String.fromCharCode(3, 13, 31, 127, 128, 164, 255) + 'Text_{Name}.'.repeat(20) + 'a'.repeat(8);
        assert.equal(name.length, 255);
        const { cpu, state } = run('GeosFileDelete', { name, events: [s.ChrReturn, s.ChrReturn] });
        const glyphs = state.glyphs.slice(0, 255); assert.equal(glyphs.length, 255);
        assert.equal(Buffer.from(glyphs.map(g => g[0])).toString('latin1'), '?'.repeat(7) + name.slice(7));
        assert.ok(glyphs.every(([, x, y]) => x >= 31 && x <= 283 && y >= 60 && y <= 110));
        assert.equal(glyphs[254][2], 110); assert.ok(state.serialReads.some(([selector, value]) => selector === s.rsstFileOpName && value === 0));
        const glyph = code => cpu.m.subarray(s.GeosRichFont + (code - 32) * 8, s.GeosRichFont + (code - 31) * 8);
        assert.notDeepEqual(glyph(95), glyph(36), 'underscore is not dollar sign');
        assert.notDeepEqual(glyph(97), glyph(65), 'lowercase is visually distinct');
        assert.notDeepEqual(glyph(46), glyph(63), 'dot is real punctuation');
    });
}));
