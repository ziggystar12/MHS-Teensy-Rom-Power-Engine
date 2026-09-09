'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { desktopMachine } = require('./desktop-machine');

test('native Appearance, Input and Storage settings execute assembled behavior', t => desktopMachine(t,
    async ({ s, fresh, stub, textAt }) => {
        const io = register => s.IO1Port + register;
        const petsciiAt = (cpu, address) => [...textAt(cpu, address)]
            .map(character => String.fromCharCode(character.charCodeAt(0) & 0x7f)).join('');
        const point = (cpu, x, y) => {
            cpu.m[s.MouseFrameX] = x >> 1;
            cpu.m[s.MouseFrameY] = y;
        };
        const key = (cpu, routine, value) => {
            cpu.a = value;
            cpu.call(s[routine]);
        };

        for (const page of [s.SettingsPageAppearance, s.SettingsPageInput]) {
            for (const input of ['Enter', 'double-click']) {
                await t.test(`${input} opens and publishes native category ${page} before accepting input`, () => {
                    const cpu = fresh();
                    cpu.m[s.MouseActive] = 1;
                    cpu.m[s.GeosDragCandidate] = 0xff;
                    cpu.m[io(s.rwRegStatus)] = s.rsReady;
                    // Start with the actual loading dialog the user saw before
                    // opening settings. The new modal must replace its pixels.
                    cpu.call(s.GeosBitmapWaitBegin);
                    const oldBitmap = Buffer.from(cpu.m.subarray(s.GeosBitmapRAM, s.GeosBitmapRAM + 8000));
                    cpu.m[s.GeosOverlayMode] = s.GeosOverlayControl;
                    cpu.m[s.GeosSurfaceMode] = s.GeosSurfaceHome;
                    cpu.m[s.GeosControlSelection] = page;
                    stub(cpu, 'GeosShellRedraw'); // The category return is outside this entry check.
                    stub(cpu, 'WaitForJSorKey');
                    let published = 0, colors = 0, entered = 0, pins = 0;
                    cpu.hooks.set(s.GeosRichPublish, () => { published++; });
                    cpu.hooks.set(s.GeosBitmapPublishColors, () => { colors++; });
                    cpu.hooks.set(s.SettingsPortDotLoop, () => {
                        assert.ok(++pins <= 18, 'both nine-pin connectors finish drawing');
                    });
                    cpu.hooks.set(s.SettingsLoop, current => {
                        entered++;
                        assert.equal(current.m[s.SettingsPage], page);
                        assert.ok(published > 0, 'settings bitmap is published before the modal input loop');
                        assert.ok(colors > 0, 'settings colors are published before the modal input loop');
                        assert.equal(current.m[1], 0x37, 'normal C64 bank is restored before input/IRQ service');
                        assert.notDeepEqual(current.m.subarray(s.GeosBitmapRAM, s.GeosBitmapRAM + 8000), oldBitmap,
                            'the loading dialog is replaced on the visible screen');
                    });
                    stub(cpu, 'GetIn', current => { current.a = current.nz(s.ChrStop); });
                    if (input === 'Enter') {
                        key(cpu, 'ReadKeyboardReady', s.ChrReturn);
                    } else {
                        cpu.m[s.RichItem] = page;
                        cpu.call(s.GeosPanelControlOrigin);
                        const x = (cpu.m[s.RichX] + 12) >> 1;
                        const y = cpu.m[s.RichY] + 8;
                        const click = () => {
                            cpu.m[s.MouseLogicalX] = x;
                            cpu.m[s.MouseLogicalY] = y;
                            cpu.m[s.MouseClickEdge] = cpu.m[s.MouseLeftDown] = 1;
                            cpu.call(s.Mouse1351ProcessMenu);
                            const activate = !!(cpu.p & 1);
                            if (activate) {
                                assert.equal(cpu.a, s.ChrReturn);
                                cpu.call(s.ReadKeyboardReady);
                            }
                            cpu.m[s.MouseLeftDown] = 0;
                            cpu.call(s.Mouse1351ProcessMenu);
                            return activate;
                        };
                        assert.equal(click(), false, 'first click only selects the category');
                        assert.equal(click(), true, 'second click opens the selected category');
                    }
                    assert.equal(entered, 1);
                    assert.equal(pins, page === s.SettingsPageInput ? 18 : 0);
                    assert.equal(cpu.m[1], 0x37);
                });
            }
        }

        await t.test('changing Appearance publishes the updated panel after its preference is saved', () => {
            const cpu = fresh();
            cpu.m[s.SettingsPage] = s.SettingsPageAppearance;
            cpu.m[s.GeosAppBackendAvailable] = 1;
            cpu.m[io(s.rwRegStatus)] = s.rsReady;
            cpu.call(s.SettingsDraw);
            const oldBitmap = Buffer.from(cpu.m.subarray(s.GeosBitmapRAM, s.GeosBitmapRAM + 8000));
            const oldColors = Buffer.from(cpu.m.subarray(s.C64ScreenRAM, s.C64ScreenRAM + 1000));
            let pending = 0, writes = 0, published = 0;
            cpu.onWrite = address => {
                if (address !== io(s.rwRegPwrUpDefaults3)) return;
                writes++;
                cpu.m[io(s.rwRegStatus)] = s.rsWriteEEPROM;
                pending = 24;
            };
            const step = cpu.step.bind(cpu);
            cpu.step = () => {
                if (pending && !--pending) cpu.m[io(s.rwRegStatus)] = s.rsReady;
                step();
            };
            cpu.hooks.set(s.GeosRichPublish, () => { published++; });
            key(cpu, 'SettingsAppearanceKey', s.ChrReturn);
            assert.equal(writes, 1);
            assert.equal(pending, 0, 'saved preference has completed before returning');
            assert.equal(cpu.m[s.GeosAppearancePrefs] & s.rpud3AppearanceDark, s.rpud3AppearanceDark);
            assert.equal(cpu.m[io(s.rwRegPwrUpDefaults3)] & s.rpud3AppearanceDark, s.rpud3AppearanceDark);
            assert.equal(published, 1, 'updated Appearance frame is published after the loading dialog');
            assert.notDeepEqual(cpu.m.subarray(s.GeosBitmapRAM, s.GeosBitmapRAM + 8000), oldBitmap);
            assert.notDeepEqual(cpu.m.subarray(s.C64ScreenRAM, s.C64ScreenRAM + 1000), oldColors);
            assert.equal(cpu.m[1], 0x37);
        });

        await t.test('overlay entry initializes each native page and refreshes Storage on open', () => {
            for (const page of [s.SettingsPageAppearance, s.SettingsPageInput, s.SettingsPageStorage]) {
                const cpu = fresh();
                let draws = 0;
                let refreshes = 0;
                let loops = 0;
                cpu.m[s.SettingsSelection] = 0xa5;
                cpu.m[s.SettingsDropdown] = 0xa5;
                cpu.m[s.SettingsExit] = 0xa5;
                cpu.m[s.MouseClickEdge] = 1;
                cpu.m[s.MouseOpenArmed] = 1;
                stub(cpu, 'SettingsDraw', () => { draws++; });
                stub(cpu, 'SettingsStorageRefresh', () => { refreshes++; });
                stub(cpu, 'DisplayTime');
                stub(cpu, 'Mouse1351SelectConfiguredPots');
                stub(cpu, 'SettingsMousePoll');
                stub(cpu, 'GetIn', current => {
                    loops++;
                    current.a = current.nz(s.ChrStop);
                });

                cpu.a = page;
                cpu.call(s.GeosPanelSettingsOpen);
                assert.equal(cpu.m[s.SettingsPage], page);
                assert.equal(cpu.m[s.SettingsSelection], 0);
                assert.equal(cpu.m[s.SettingsDropdown], 0);
                assert.equal(cpu.m[s.SettingsJoyLast], 0xff);
                assert.equal(cpu.m[s.MouseClickEdge], 0);
                assert.equal(cpu.m[s.MouseOpenArmed], 0);
                assert.equal(draws, 1);
                assert.equal(refreshes, +(page === s.SettingsPageStorage));
                assert.equal(loops, 1);
            }
        });

        await t.test('Appearance cycles and clicks exact choices while preserving unrelated defaults', () => {
            const cpu = fresh();
            const defaults = 0xc7;
            const unrelated = defaults & ~(s.rpud3AppearanceDark | s.rpud3BackgroundMask);
            let waits = 0;
            let draws = 0;
            cpu.m[s.GeosAppBackendAvailable] = 1;
            cpu.m[s.GeosAppearancePrefs] = s.rpud3BackgroundDots;
            cpu.m[io(s.rwRegPwrUpDefaults3)] = defaults;
            stub(cpu, 'WaitForTRWaitMsg', () => { waits++; });
            stub(cpu, 'SettingsDraw', () => { draws++; });

            cpu.m[s.SettingsSelection] = 0;
            key(cpu, 'SettingsAppearanceKey', s.ChrReturn);
            assert.equal(cpu.m[s.GeosAppearancePrefs], s.rpud3AppearanceDark);
            assert.equal(cpu.m[io(s.rwRegPwrUpDefaults3)], unrelated | s.rpud3AppearanceDark);

            cpu.m[s.SettingsSelection] = 1;
            for (const background of [s.rpud3BackgroundDithered, s.rpud3BackgroundBlank,
                s.rpud3BackgroundDots]) {
                key(cpu, 'SettingsAppearanceKey', s.ChrCRSRRight);
                assert.equal(cpu.m[s.GeosAppearancePrefs], s.rpud3AppearanceDark | background);
                assert.equal(cpu.m[io(s.rwRegPwrUpDefaults3)], unrelated | s.rpud3AppearanceDark | background);
            }
            key(cpu, 'SettingsAppearanceKey', s.ChrCRSRLeft);
            assert.equal(cpu.m[s.GeosAppearancePrefs], s.rpud3AppearanceDark | s.rpud3BackgroundBlank);
            assert.equal(waits, 5);
            assert.equal(draws, 5);

            for (const [x, y, initial, expected] of [
                [84, 66, s.rpud3AppearanceDark | s.rpud3BackgroundBlank, s.rpud3BackgroundBlank],
                [172, 66, s.rpud3BackgroundBlank, s.rpud3AppearanceDark | s.rpud3BackgroundBlank],
                [64, 116, s.rpud3AppearanceDark | s.rpud3BackgroundBlank, s.rpud3AppearanceDark],
                [160, 116, s.rpud3AppearanceDark, s.rpud3AppearanceDark | s.rpud3BackgroundDithered],
                [256, 116, s.rpud3AppearanceDark, s.rpud3AppearanceDark | s.rpud3BackgroundBlank],
            ]) {
                const clicked = fresh();
                clicked.m[s.GeosAppBackendAvailable] = 0;
                clicked.m[s.GeosAppearancePrefs] = initial;
                clicked.m[io(s.rwRegPwrUpDefaults3)] = 0x5a;
                stub(clicked, 'SettingsDraw');
                point(clicked, x, y);
                clicked.call(s.SettingsAppearanceClick);
                assert.equal(clicked.m[s.GeosAppearancePrefs], expected, `choice at ${x},${y}`);
                assert.equal(clicked.m[io(s.rwRegPwrUpDefaults3)], 0x5a,
                    'an unavailable backend leaves persistent storage untouched');
            }
        });

        await t.test('Input dropdown enforces one mouse and applies changed layouts immediately', () => {
            const cases = [
                { layout: s.rpud3InputMouse1Joy2, port: 0, toggle: true, choice: 0,
                    expected: s.rpud3InputJoy1Joy2 },
                { layout: s.rpud3InputMouse1Joy2, port: 1, toggle: true, choice: 1,
                    expected: s.rpud3InputJoy1Mouse2 },
                { layout: s.rpud3InputJoy1Mouse2, port: 0, toggle: true, choice: 1,
                    expected: s.rpud3InputMouse1Joy2 },
                { layout: s.rpud3InputJoy1Mouse2, port: 0, toggle: false, choice: 1,
                    expected: s.rpud3InputJoy1Mouse2 },
                { layout: s.rpud3InputJoy1Joy2, port: 1, toggle: true, choice: 1,
                    expected: s.rpud3InputJoy1Mouse2 },
            ];
            for (const { layout, port, toggle, choice, expected } of cases) {
                const cpu = fresh();
                const base = 0xb9 & ~s.rpud3InputLayoutMask;
                let waits = 0;
                let hides = 0;
                let draws = 0;
                cpu.m[s.GeosInputLayout] = layout;
                cpu.m[io(s.rwRegPwrUpDefaults3)] = base | layout;
                cpu.m[s.MouseActive] = 1;
                cpu.m[s.MouseMenuEnabled] = 1;
                cpu.m[s.MouseClickEdge] = 1;
                cpu.m[s.SettingsSelection] = port;
                stub(cpu, 'WaitForTRWaitMsg', () => { waits++; });
                stub(cpu, 'Mouse1351HideForRedraw', () => { hides++; });
                stub(cpu, 'SettingsDraw', () => { draws++; });

                key(cpu, 'SettingsInputKey', s.ChrReturn);
                assert.equal(cpu.m[s.SettingsDropdown], port + 1);
                assert.equal(cpu.m[s.SettingsDropChoice], choice, `port ${port + 1} reflects live layout ${layout}`);
                if (toggle) key(cpu, 'SettingsInputKey', s.ChrCRSRDn);
                key(cpu, 'SettingsInputKey', s.ChrReturn);

                const changed = expected !== layout;
                assert.equal(cpu.m[s.SettingsDropdown], 0);
                assert.equal(cpu.m[s.GeosInputLayout], expected);
                assert.equal(cpu.m[io(s.rwRegPwrUpDefaults3)], base | expected);
                assert.equal(waits, +changed, 'persistence waits only for a changed defaults byte');
                assert.equal(hides, +changed, 'a changed layout immediately resets the live pointer');
                assert.equal(cpu.m[s.MouseActive], changed ? 0 : 1);
                assert.equal(cpu.m[s.MouseClickEdge], changed ? 0 : 1);
                assert.equal(draws, toggle ? 3 : 2);
            }

            const cancelled = fresh();
            cancelled.m[s.GeosInputLayout] = s.rpud3InputMouse1Joy2;
            cancelled.m[s.SettingsSelection] = 0;
            stub(cancelled, 'SettingsDraw');
            key(cancelled, 'SettingsInputKey', s.ChrReturn);
            point(cancelled, 160, 170);
            cancelled.call(s.SettingsInputClick);
            assert.equal(cancelled.m[s.SettingsDropdown], 0, 'clicking outside an open dropdown cancels it');
            assert.equal(cancelled.m[s.GeosInputLayout], s.rpud3InputMouse1Joy2);
        });

        await t.test('Storage refresh signals the backend only for refresh keys and clicks', () => {
            const cpu = fresh();
            let waits = 0;
            let draws = 0;
            const writes = [];
            cpu.m[s.GeosAppBackendAvailable] = 1;
            stub(cpu, 'WaitForTRWaitMsg', () => { waits++; });
            stub(cpu, 'SettingsDraw', () => { draws++; });
            cpu.onWrite = (address, value) => {
                if (address >= s.IO1Port && address < s.IO1Port + 256) writes.push([address, value]);
            };
            for (const value of [s.ChrReturn, s.ChrRun, 'R'.charCodeAt(0), 0xd2])
                key(cpu, 'SettingsStorageKey', value);
            key(cpu, 'SettingsStorageKey', s.ChrCRSRDn);
            cpu.m[s.SettingsPage] = s.SettingsPageStorage;
            point(cpu, 250, 172);
            cpu.call(s.SettingsMouseClick);

            assert.equal(waits, 5);
            assert.equal(draws, 5);
            assert.deepEqual(writes, Array.from({ length: 5 }, () =>
                [io(s.wRegControl), s.rCtlStorageRefreshWAIT]));

            const offline = fresh();
            let offlineWaits = 0;
            offline.m[s.GeosAppBackendAvailable] = 0;
            offline.m[io(s.wRegControl)] = 0xa5;
            stub(offline, 'WaitForTRWaitMsg', () => { offlineWaits++; });
            offline.call(s.SettingsStorageRefresh);
            assert.equal(offline.m[io(s.wRegControl)], 0xa5);
            assert.equal(offlineWaits, 0);
        });

        await t.test('Storage state priority and 32-bit values render from one register snapshot', () => {
            const stateCases = [
                [0, 'UNAVAILABLE', 0],
                [s.rssSnapshotValid, 'NOT CONNECTED', 0],
                [s.rssSnapshotValid | s.rssSDConnected, 'UNAVAILABLE', 0],
                [s.rssSnapshotValid | s.rssSDConnected | s.rssSDInfoValid | s.rssSDError, 'ERROR', 0],
                [s.rssSnapshotValid | s.rssSDConnected | s.rssSDInfoValid, 'READY', 1],
            ];
            for (const [state, expected, carry] of stateCases) {
                const cpu = fresh();
                let rendered = '';
                cpu.m[io(s.rRegStorageState)] = state;
                stub(cpu, 'RichText', current => { rendered += petsciiAt(current, current.a | current.y << 8); });
                cpu.a = s.rssSDConnected;
                cpu.x = s.rssSDInfoValid;
                cpu.y = s.rssSDError;
                cpu.call(s.SettingsDrawMediaState);
                assert.equal(rendered, expected);
                assert.equal(cpu.p & 1, carry);
            }

            for (const value of [0, 1, 65535, 0xffffffff]) {
                const formatted = fresh();
                let rendered = '';
                formatted.m.writeUInt32LE(value >>> 0, io(s.rRegStorageSDTotalMiB0));
                stub(formatted, 'RichChar', current => {
                    rendered += String.fromCharCode(current.a & 0x7f);
                });
                formatted.a = s.rRegStorageSDTotalMiB0;
                formatted.call(s.SettingsPrintReg32);
                assert.equal(rendered, String(value));
            }

            const cpu = fresh();
            let rendered = '';
            const write32 = (register, value) => cpu.m.writeUInt32LE(value >>> 0, io(register));
            stub(cpu, 'RichBlit');
            stub(cpu, 'UiLoadRect');
            stub(cpu, 'UiButton');
            stub(cpu, 'RichText', current => { rendered += petsciiAt(current, current.a | current.y << 8); });
            stub(cpu, 'RichChar', current => { rendered += String.fromCharCode(current.a & 0x7f); });
            cpu.m[io(s.rRegStorageState)] = s.rssSnapshotValid | s.rssSDConnected | s.rssSDInfoValid
                | s.rssUSBConnected | s.rssUSBInfoValid | s.rssInternalInfoValid;
            write32(s.rRegStorageSDTotalMiB0, 65536);
            write32(s.rRegStorageSDFreeMiB0, 1234);
            write32(s.rRegStorageSDId0, 0x1234abcd);
            write32(s.rRegStorageUSBTotalMiB0, 1234567890);
            write32(s.rRegStorageUSBFreeMiB0, 0);
            cpu.m.writeUInt16LE(0x1234, io(s.rRegStorageUSBVendorLo));
            cpu.m.writeUInt16LE(0xabcd, io(s.rRegStorageUSBProductLo));
            write32(s.rRegStorageInternalTotalKiB0, 32768);
            write32(s.rRegStorageInternalFreeKiB0, 8192);
            cpu.call(s.SettingsDrawStorage);

            assert.equal(rendered, 'SD CARDREADYTOTAL 65536 MB  FREE 1234ID 1234ABCD'
                + 'USB STORAGEREADYTOTAL 1234567890 MB  FREE 0ID 1234:ABCD'
                + 'INTERNAL FLASHREADYTOTAL 32768 KB  FREE 8192ID BUILT-IN'
                + 'REFRESHRETURN OR CLICK REFRESH');
        });
    }));
