'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { desktopMachine } = require('./desktop-machine');

test('V to classic view keeps keyboard selection and visible highlight together', t =>
  desktopMachine(t, ({ s, fresh, stub }) => {
    const cpu = fresh();
    const cursor = s.IO1Port + s.rwRegCursorItemOnPg;
    const page = s.IO1Port + s.rwRegPageNumber;
    const count = 5;
    const rowAddress = row => cpu.m.readUInt16LE(s.TblRowToMemLoc + row * 2) + 1;
    const paintList = () => {
      cpu.m[s.GeosBitmapActive] = cpu.m[s.GeosViewMode];
      for (let row = 0; row < count; row++)
        cpu.m.fill(0x30 + row, rowAddress(row), rowAddress(row) + 40);
    };
    stub(cpu, 'ListMenuItems', paintList); // Backend supplies rows; production code moves/highlights them.
    stub(cpu, 'WaitForTRWaitMsg');
    stub(cpu, 'WaitForJSorKey');
    cpu.m[s.GeosSurfaceMode] = s.GeosSurfaceBrowser;
    cpu.m[s.GeosOverlayMode] = s.GeosOverlayNone;
    cpu.m[s.IO1Port + s.rRegNumItemsOnPage] = count;
    cpu.m[s.IO1Port + s.rRegNumPages] = 3;
    cpu.m[page] = 1;
    cpu.m[cursor] = 2;
    // Reproduce the desktop sampler's pre-switch CIA state too.
    cpu.m[s.CIA1_DDRB] = 255;
    cpu.m[s.CIA1_RegB] = 0;
    cpu.m[s.Joystick2Sample] = 0xee; // Stale held up/fire must not starve keyboard input.
    const key = code => { cpu.a = code; cpu.call(s.ReadKeyboardReady); };
    const expectSelection = (selection, expectedPage) => {
      assert.equal(cpu.m[cursor], selection, 'backend selection');
      assert.equal(cpu.m[page], expectedPage, 'backend page');
      for (let row = 0; row < count; row++) {
        const expected = (0x30 + row) ^ (row === selection ? 0x80 : 0);
        assert.deepEqual(cpu.m.subarray(rowAddress(row), rowAddress(row) + 40),
          Buffer.alloc(40, expected), `page ${expectedPage}: highlight row ${row}`);
      }
    };
    key(0x56); // Actual V shortcut, then normal keyboard dispatch for every arrow.
    assert.equal(cpu.m[s.GeosViewMode], 0);
    assert.equal(cpu.m[s.CIA1_DDRB], 0);
    assert.equal(cpu.m[s.CIA1_DDRA], 255);
    assert.equal(cpu.m[s.Joystick2Sample], 255);
    expectSelection(2, 1);
    for (const [code, selection, expectedPage] of [
      [s.ChrCRSRDn, 3, 1], [s.ChrCRSRDn, 4, 1], [s.ChrCRSRDn, 0, 2],
      [s.ChrCRSRUp, 4, 1], [s.ChrCRSRUp, 3, 1],
      [s.ChrCRSRRight, 0, 2], [s.ChrCRSRLeft, 0, 1],
      [s.ChrCRSRUp, 4, 3], [s.ChrCRSRDn, 0, 1],
    ]) { key(code); expectSelection(selection, expectedPage); }
    // Returning to the GUI and switching back must not retain a stale row.
    key(0x56);
    assert.equal(cpu.m[s.GeosViewMode], 1);
    cpu.m[cursor] = 3;
    key(0x56);
    expectSelection(3, 1);
    key(s.ChrCRSRUp);
    expectSelection(2, 1);
  }, { apps: false }));
