'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {desktopMachine} = require('./desktop-machine');
const releaseOptions = process.env.GUI_CONTROL_RELEASE_HEX ? {
    releasedHex: path.resolve(process.env.GUI_CONTROL_RELEASE_HEX),
    releasedSha256: process.env.GUI_CONTROL_RELEASE_SHA256
} : {};

test('startup SID and menu-bar Control Panel coexist', t => desktopMachine(t, async ({s, fresh, stub, menuDir}) => {
    await t.test('packaged loader installs the assembled settings without corruption', () => {
        const cpu = fresh();
        const expected = Buffer.from(cpu.m.subarray(s.GeosSettingsBase, s.GeosSettingsEnd));
        const text = fs.readFileSync(path.resolve(menuDir, '../../Teensy/TRMenuFiles/ROMs/DesktopShell.prg.h'), 'utf8');
        const prg = Buffer.from([...text.matchAll(/0x([0-9a-f]{2})/gi)].map(m => parseInt(m[1], 16)));
        cpu.m.fill(0); cpu.m[1] = 0x37;
        prg.subarray(2).copy(cpu.m, prg.readUInt16LE(0));
        cpu.pc = 0x080d;
        for (let steps = 0; cpu.pc !== s.MainCodeRAMStart; steps++) {
            assert.ok(steps < 1000000, 'loader returns');
            cpu.step();
        }
        assert.deepEqual(cpu.m.subarray(s.GeosSettingsBase, s.GeosSettingsEnd), expected);
    });
    for (const tune of ['Div_Death_Is_no_Evil', 'Popcorn']) {
      const header = fs.readFileSync(path.resolve(menuDir, `../../Teensy/TRMenuFiles/SIDs/${tune}.sid.h`), 'utf8');
      const sid = Buffer.from([...header.matchAll(/0x([0-9a-f]{2})/gi)].map(m => parseInt(m[1], 16)));
      const offset = sid.readUInt16BE(6), load = sid.readUInt16LE(offset);
      for (const surface of [s.GeosSurfaceHome, s.GeosSurfaceBrowser, s.GeosSurfaceIEC]) {
        const cpu = fresh();
        const settings = Buffer.from(cpu.m.subarray(s.GeosSettingsBase, s.GeosSettingsEnd));
        sid.subarray(offset + 2).copy(cpu.m, load);
        cpu.a = 0;
        cpu.call(sid.readUInt16BE(10));
        for (let frame = 0; frame < 120; frame++) cpu.call(sid.readUInt16BE(12));
        assert.deepEqual(cpu.m.subarray(s.GeosSettingsBase, s.GeosSettingsEnd), settings, `${tune} preserves settings code`);
        cpu.m[s.GeosSurfaceMode] = surface;
        cpu.m[s.rwRegMenuView + s.IO1Port] = 2;
        cpu.m[s.rRegNumItemsOnPage + s.IO1Port] = 16;
        cpu.m[s.rwRegCursorItemOnPg + s.IO1Port] = 7;
        // KERNAL character output and Teensy strings are outside this CPU model.
        for (const name of ['TextScreenMemColor', 'SendChar', 'GeosDrawHeader', 'GeosDrawFooter', 'GeosDrawStatus']) stub(cpu, name);
        // Start from a retained frame with a live directory underneath it.
        // Opening settings must also work while the backend cannot respond.
        cpu.m[s.rwRegStatus + s.IO1Port] = s.rsChangeMenu;
        cpu.m[s.MouseActive] = 1;
        const click = (x, y) => {
            cpu.m[s.MouseLogicalX] = x;
            cpu.m[s.MouseLogicalY] = y;
            cpu.m[s.MouseClickEdge] = cpu.m[s.MouseLeftDown] = 1;
            cpu.call(s.Mouse1351ProcessMenu);
            cpu.m[s.MouseLeftDown] = 0;
            cpu.call(s.Mouse1351ProcessMenu);
        };
        const address = cpu.address.bind(cpu);
        cpu.address = mode => {
            const result = address(mode);
            assert.ok(result < s.IO1Port || result >= s.IO1Port + 256,
                'Control Panel opening must not read or write the file backend');
            return result;
        };
        click(4, 4);
        assert.equal(cpu.m[s.GeosOverlayMode], s.GeosOverlayMenu);
        assert.equal(cpu.m[s.GeosActiveMenu], s.GeosMenuDesk);
        // An IRQ between the two clicks must not damage the open menu/settings.
        cpu.call(sid.readUInt16BE(12));
        click(40, 26);
        assert.equal(cpu.m[s.GeosOverlayMode], s.GeosOverlayControl);
        assert.equal(cpu.m[s.GeosSurfaceMode], s.GeosSurfaceHome, 'file window closes before panel opens');
        assert.equal(cpu.m[s.rwRegCursorItemOnPg + s.IO1Port], 7, 'opening settings does not alter the selected file');
      }
    }
}, releaseOptions));

test('play/pause saves the startup preference and waits for EEPROM completion', t => desktopMachine(t, ({s, fresh, stub}) => {
    for (const state of [0, 1, 0xfe, 0xff]) for (const saved of [0xa6, 0xa7]) {
        const cpu = fresh();
        cpu.p &= ~4;
        cpu.m[s.smcSIDPauseStop + 1] = state;
        cpu.m[s.IO1Port + s.rwRegPwrUpDefaults] = saved;
        const next = state < 2 ? state ^ 1 : state;
        const expected = state < 2 ? (saved & 0xfe) | next : saved;
        let writes = 0, pending = 0, stored = saved;
        cpu.onWrite = (address, value) => {
            if (address !== s.IO1Port + s.rwRegPwrUpDefaults) return;
            writes++;
            assert.equal(value, expected);
            if (next) for (const register of [0xd404, 0xd40b, 0xd412]) assert.equal(cpu.m[register], 0);
            cpu.m[s.IO1Port + s.rwRegStatus] = s.rsWriteEEPROM;
            pending = 24;
        };
        const step = cpu.step.bind(cpu);
        cpu.step = () => {
            if (pending && !--pending) {
                stored = cpu.m[s.IO1Port + s.rwRegPwrUpDefaults];
                cpu.m[s.IO1Port + s.rwRegStatus] = s.rsReady;
            }
            step();
        };
        cpu.call(s.ToggleSIDMusic);
        assert.equal(cpu.m[s.smcSIDPauseStop + 1], next);
        assert.equal(writes, Number(saved !== expected));
        assert.equal(pending, 0, 'save is complete before returning to input');
        assert.equal(stored, expected);
        assert.equal(cpu.p & 4, 0, 'save keeps interrupts enabled');
        const reboot = fresh();
        reboot.m[s.IO1Port + s.rwRegPwrUpDefaults] = stored;
        stub(reboot, 'SIDStartupReady');
        reboot.call(s.SIDRestorePreference);
        assert.equal(reboot.m[s.smcSIDPauseStop + 1], expected & 1, 'cold boot restores the saved bit');
        reboot.m[s.smcSIDPauseStop + 1] = 0xff;
        reboot.call(s.SIDRestorePreference);
        assert.equal(reboot.m[s.smcSIDPauseStop + 1], 0xff, 'startup never enables a rejected SID');
    }
}, releaseOptions));
