'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { desktopMachine } = require('./desktop-machine');

test('assembled appearance backgrounds and desktop drag feedback', t => desktopMachine(t,
    async ({ s, fresh, stub }) => {
        const canvasPixel = (cpu, x, y) => Number(!!(cpu.m[s.GeosRichCanvas
            + (y >> 3) * 320 + (x >> 3) * 8 + (y & 7)] & (128 >> (x & 7))));

        await t.test('startup normalizes reserved background while retaining dark mode', () => {
            const cpu = fresh();
            cpu.m[s.IO1Port + s.rwRegPwrUpDefaults3] = s.rpud3AppearanceDark
                | s.rpud3BackgroundInvalid;
            for (let icon = 0; icon < s.GeosHomeIconCount; icon++)
                cpu.m[s.IO1Port + s.rwRegDesktopSlotStart + icon] = icon;
            cpu.call(s.GeosShellInit);
            assert.equal(cpu.m[s.GeosAppearancePrefs], s.rpud3AppearanceDark);
        });

        await t.test('light and dark publish opposite readable foreground/background pairs', () => {
            for (const [preference, color] of [[0, 0x01], [s.rpud3AppearanceDark, 0x10]]) {
                const cpu = fresh();
                cpu.m[s.GeosAppearancePrefs] = preference;
                cpu.call(s.GeosBitmapTintSurface);
                assert.equal(cpu.m[s.GeosBitmapColor], color);
                for (let offset = 0; offset < 1000; offset++)
                    assert.equal(cpu.m[s.GeosLayoutScreen + offset], color);

                const rect = 0x1800;
                Buffer.from([48, 0, 40, 40, 0, 24]).copy(cpu.m, rect);
                cpu.a = rect & 255; cpu.y = rect >> 8;
                cpu.call(s.UiLoadRect); cpu.call(s.UiFrame);
                assert.equal(cpu.m[s.GeosLayoutScreen + 5 * 40 + 6], color,
                    'window palette follows the live theme');
            }
        });

        await t.test('dots, checker dither, and blank are visibly distinct', () => {
            const render = preference => {
                const cpu = fresh();
                cpu.m[s.GeosAppearancePrefs] = preference;
                cpu.m[s.GeosDragActive] = 0;
                cpu.m[s.GeosOverlayMode] = s.GeosOverlayNone;
                cpu.call(s.GeosRichHome);
                return cpu;
            };
            const dots = render(s.rpud3BackgroundDots);
            assert.equal(canvasPixel(dots, 8, 20), 1);
            assert.equal(canvasPixel(dots, 9, 20), 0);
            assert.equal(canvasPixel(dots, 4, 28), 1);

            const dither = render(s.rpud3BackgroundDithered);
            assert.deepEqual([canvasPixel(dither, 0, 20), canvasPixel(dither, 1, 20),
                canvasPixel(dither, 0, 21), canvasPixel(dither, 1, 21)], [1, 0, 0, 1]);

            const blank = render(s.rpud3BackgroundBlank);
            for (let y = 20; y < 28; y++) for (let x = 0; x < 64; x++)
                assert.equal(canvasPixel(blank, x, y), 0);
        });

        await t.test('drag shows the snap grid and uses the selected icon as the pointer', () => {
            const cpu = fresh();
            cpu.m[s.GeosAppearancePrefs] = s.rpud3BackgroundBlank;
            cpu.m[s.GeosDragActive] = 1;
            cpu.m[s.GeosOverlayMode] = s.GeosOverlayNone;
            cpu.call(s.GeosRichHome);
            for (const [x, y] of [[0, 20], [60, 50], [120, 100], [300, 175], [50, 74], [250, 128]])
                assert.equal(canvasPixel(cpu, x, y), 1, `grid line ${x},${y}`);
            assert.equal(canvasPixel(cpu, 50, 50), 0, 'blank cell interior stays open');

            cpu.m[s.GeosDragCandidate] = 2;
            cpu.call(s.Mouse1351DragIconBegin);
            assert.deepEqual(cpu.m.subarray(s.MouseSpriteDataRAM, s.MouseSpriteDataRAM + 48),
                cpu.m.subarray(s.GeosRichIcons + 2 * 48, s.GeosRichIcons + 3 * 48));
            assert.ok(cpu.m.subarray(s.MouseSpriteDataRAM + 48, s.MouseSpriteDataRAM + 64)
                .every(value => value === 0), 'unused sprite rows are transparent');
            cpu.call(s.Mouse1351DragIconEnd);
            assert.deepEqual(cpu.m.subarray(s.MouseSpriteDataRAM, s.MouseSpriteDataRAM + 64),
                cpu.m.subarray(s.MousePointerSpriteData, s.MousePointerSpriteData + 64));
        });

        await t.test('free-moving ghost commits one snapped slot only on release', () => {
            const run = (cancel, firstMoveOutside = false) => {
                const cpu = fresh(), calls = { redraw: 0, persist: [] };
                stub(cpu, 'GeosShellRedraw', () => calls.redraw++);
                stub(cpu, 'GeosShellPersistIcon', current => calls.persist.push(current.x));
                cpu.m[s.GeosViewMode] = 1;
                cpu.m[s.GeosSurfaceMode] = s.GeosSurfaceHome;
                cpu.m[s.GeosOverlayMode] = s.GeosOverlayNone;
                cpu.m[s.BrowserDragging] = 0;
                cpu.m[s.GeosDragCandidate] = 0;
                cpu.m[s.GeosDragOrigin] = 0;
                cpu.m[s.GeosDragTarget] = 0;
                cpu.m[s.GeosDragActive] = 0;
                cpu.m[s.MouseFrameDown] = 1;
                cpu.m[s.MouseFrameX] = firstMoveOutside ? 159 : 70;
                cpu.m[s.MouseFrameY] = firstMoveOutside ? 150 : 90;
                cpu.call(s.GeosShellMouseDragFrame);
                assert.equal(cpu.m[s.GeosDragActive], 1);
                assert.equal(cpu.m[s.GeosDragTarget], firstMoveOutside ? 0xff : 7);
                assert.equal(cpu.m[s.TblGeosHomeIconSlot], 0, 'source icon stays put while held');
                assert.equal(calls.redraw, 1, 'grid appears once at the drag threshold');

                cpu.m[s.MouseFrameX] = cancel ? 159 : 125;
                cpu.m[s.MouseFrameY] = 150; //outside or empty slot 14
                cpu.call(s.GeosShellMouseDragFrame);
                assert.equal(cpu.m[s.GeosDragTarget], cancel ? 0xff : 14);
                assert.equal(calls.redraw, 1, 'pointer motion does not redraw the desktop');

                cpu.m[s.MouseFrameDown] = 0;
                cpu.call(s.GeosShellMouseDragFrame);
                assert.equal(cpu.m[s.GeosDragActive], 0);
                assert.equal(cpu.m[s.GeosDragCandidate], 0xff);
                assert.deepEqual(calls.persist, cancel ? [] : [0]);
                assert.equal(cpu.m[s.TblGeosHomeIconSlot], cancel ? 0 : 14);
                assert.equal(calls.redraw, 2, 'release removes grid and settles the snapped icon');
                assert.deepEqual(cpu.m.subarray(s.MouseSpriteDataRAM, s.MouseSpriteDataRAM + 64),
                    cpu.m.subarray(s.MousePointerSpriteData, s.MousePointerSpriteData + 64));
            };
            run(false);
            run(true);
            run(true, true);
        });
    }, { apps: false }));
