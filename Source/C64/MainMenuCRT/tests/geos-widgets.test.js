'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const menuDir = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(menuDir, 'source', name), 'utf8');
const probe = fs.readFileSync(path.join(__dirname, 'geos-color-publication.test.js'), 'utf8');
const Cpu6502 = vm.runInNewContext(probe.slice(probe.indexOf('class Cpu6502 {'),
    probe.indexOf("test('assembled renderer")) + '\nCpu6502;', { assert });
const block = (text, first, last) => {
    const start = text.indexOf(first), end = text.indexOf(last, start);
    assert.ok(start >= 0 && end > start, `${first} block exists`);
    return text.slice(start, end);
};

test('shared bitmap widgets execute their assembled drawing, hit and publication code', async t => {
    const preview = fs.readFileSync(path.join(menuDir, 'preview-desktop.ps1'), 'utf8');
    const acme = process.env.ACME_EXE || preview.match(/\$AcmePath\s*=\s*'([^']+)'/)[1];
    if (!fs.existsSync(acme)) return t.skip('ACME unavailable; set ACME_EXE');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'teensyrom-widgets-'));
    try {
        // Isolate the maintained routines without faking their drawing algorithm.
        // The regular integration suite separately enforces full payload bounds.
        const rich = read('GeosRich.s'), bitmap = read('GeosBitmap.s'), apps = read('GeosAppHelpers.s');
        const fixture = '*=$8000\nC64ScreenRAM=$0400\nGeosLayoutScreen=$4000\nGeosBitmapColor=$6a84\nGeosBitmapColorNormal=1\n' +
            block(rich, 'RichAddress:', 'GeosRichHome:') +
            block(rich, 'RichHitRect:', 'RichHitFound:') +
            block(rich, 'RichRightMasks:', 'RichSlotX:') + rich.slice(rich.indexOf('RichSavedBank:')) +
            block(bitmap, 'TblGeosBitmapRowLo:', 'GeosBitmapActive:') +
            '\nRichHitX: !byte 0\nRichHitXHi: !byte 0\nMouseFrameX: !byte 0\nMouseFrameY: !byte 0\n' +
            'BrowserThumbY: !byte 70\nBrowserThumbH: !byte 25\n' +
            '!src "source/GeosRichAssets.s"\n!src "source/GeosWidgets.s"\n' +
            '*=$c010\njmp AppPublishRect\n' + block(apps, 'AppPublishRect:', '; A=new home icon');
        const sourceFile = path.join(temporary, 'widgets.asm'), binary = path.join(temporary, 'widgets.bin');
        const symbolFile = path.join(temporary, 'symbols');
        fs.writeFileSync(sourceFile, fixture);
        const result = spawnSync(acme, ['--format', 'plain', '--symbollist', symbolFile,
            '--outfile', binary, sourceFile], { cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const symbols = Object.fromEntries([...fs.readFileSync(symbolFile, 'utf8')
            .matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)].map(m => [m[1], parseInt(m[2], 16)]));
        const image = fs.readFileSync(binary);
        const fresh = () => {
            const memory = Buffer.alloc(65536);
            image.copy(memory, 0x8000);
            memory.fill(255, 0xa000, 0xbf40);
            memory.fill(0x62, 0x4000, 0x43e8);
            memory.fill(0x16, 0x0400, 0x07e8);
            memory.fill(255, 0x2000, 0x3f40);
            memory[0x6a84] = 1;
            memory[1] = 0x36;
            return new Cpu6502(memory);
        };
        const rect = (cpu, [x, y, w, h]) => {
            [x & 255, x >> 8, y, w & 255, w >> 8, h].forEach((v, i) => cpu.m[symbols.RichX + i] = v);
        };
        const pixel = (memory, base, x, y) => (memory[base + (y >> 3) * 320 + (x >> 3) * 8 + (y & 7)] >> (7 - (x & 7))) & 1;
        const inside = ([rx, ry, rw, rh], x, y) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;
        const untouchedRuntime = cpu => {
            assert.equal(cpu.m[1], 0x36, 'widget does not change memory banking');
            assert.equal(cpu.p & 4, 4, 'widget preserves caller IRQ mask');
            assert.deepEqual(cpu.m.subarray(0xfb, 0xff), Buffer.alloc(4), 'SID-owned zero page is untouched');
        };
        const cases = [[0, 0, 320, 200], [24, 42, 272, 116], [302, 36, 12, 147], [255, 7, 11, 11], [317, 197, 3, 3]];
        for (const bounds of cases) await t.test(`frame ${bounds.join(',')} clears only its interior and stages every edge cell`, () => {
            const cpu = fresh(); rect(cpu, bounds); cpu.call(symbols.UiFrame);
            const [rx, ry, rw, rh] = bounds;
            for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
                const body = x > rx && x < rx + rw - 1 && y > ry && y < ry + rh - 1;
                assert.equal(pixel(cpu.m, 0xa000, x, y), +!body, `pixel ${x},${y}`);
            }
            for (let y = 0; y < 25; y++) for (let x = 0; x < 40; x++) {
                const touched = x >= (rx >> 3) && x <= ((rx + rw - 1) >> 3) &&
                    y >= (ry >> 3) && y <= ((ry + rh - 1) >> 3);
                assert.equal(cpu.m[0x4000 + y * 40 + x], touched ? 1 : 0x62);
            }
            assert.deepEqual(cpu.m.subarray(0x2000, 0x3f40), Buffer.alloc(8000, 255), 'composition does not publish');
            rect(cpu, bounds); // geometry remains usable independently of scratch registers
            untouchedRuntime(cpu);
        });

        await t.test('close button clears old ink and uses the exact authored seven-pixel X', () => {
            const cpu = fresh(), bounds = [254, 14, 11, 11]; rect(cpu, bounds); cpu.call(symbols.UiClose);
            const cross = [0x82, 0x44, 0x28, 0x10, 0x28, 0x44, 0x82];
            for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
                const expected = x === 0 || y === 0 || x === 10 || y === 10 ||
                    (x >= 2 && x < 9 && y >= 2 && y < 9 && (cross[y - 2] & (0x80 >> (x - 2))));
                assert.equal(pixel(cpu.m, 0xa000, bounds[0] + x, bounds[1] + y), +!!expected);
            }
            untouchedRuntime(cpu);
        });
        await t.test('browser, app and dialog close hits match their drawn eleven-pixel rectangles', () => {
            for (const bounds of [[4, 12, 312, 176], [8, 12, 304, 176], [24, 42, 272, 116], [40, 16, 240, 168]]) {
                const cpu = fresh(), [x, y, w] = bounds, close = [x + w - 14, y + 2, 11, 11];
                rect(cpu, bounds); cpu.call(symbols.UiWindow);
                for (let px = close[0] - 2; px < close[0] + 14; px += 2) for (let py = close[1] - 1; py <= close[1] + 11; py++) {
                    rect(cpu, bounds);
                    cpu.m[symbols.MouseFrameX] = px >> 1;
                    cpu.m[symbols.MouseFrameY] = py;
                    cpu.call(symbols.UiWindowCloseHit);
                    assert.equal(!!(cpu.p & 1), inside(close, px & ~1, py), `hit ${px},${py}`);
                }
                for (let px = x; px < x + w; px++) assert.equal(pixel(cpu.m, 0xa000, px, y + 16), 1);
            }
        });
        await t.test('normal and selected buttons share their frame and return contrasting text ink', () => {
            for (const selected of [0, 1]) {
                const cpu = fresh(); rect(cpu, [40, 142, 70, 11]); cpu.a = selected; cpu.call(symbols.UiButton);
                assert.equal(cpu.m[symbols.RichInk], selected ? 0 : 255);
                assert.equal(pixel(cpu.m, 0xa000, 42, 144), selected);
                assert.equal(pixel(cpu.m, 0xa000, 40, 142), 1);
                untouchedRuntime(cpu);
            }
        });
        await t.test('checkbox states clear their previous mark and stay inside the shared frame', () => {
            for (const state of [0, 1, 128]) {
                const cpu = fresh(); rect(cpu, [255, 70, 9, 9]); cpu.a = state; cpu.call(symbols.UiCheckbox);
                const art = state === 1 ? [8, 16, 160, 64, 0] : state === 128 ? [168, 80, 168, 80, 168] : [0, 0, 0, 0, 0];
                for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
                    const expected = x === 0 || x === 8 || y === 0 || y === 8 ||
                        (x >= 2 && x < 7 && y >= 2 && y < 7 && (art[y - 2] & (128 >> (x - 2))));
                    assert.equal(pixel(cpu.m, 0xa000, 255 + x, 70 + y), +!!expected);
                }
            }
        });
        await t.test('scrollbar redraw clears old thumb pixels while keeping arrows and frame bounded', () => {
            const cpu = fresh();
            for (const [top, height] of [[48, 123], [48, 11], [100, 35], [160, 11]]) {
                cpu.m[symbols.BrowserThumbY] = top; cpu.m[symbols.BrowserThumbH] = height;
                rect(cpu, [302, 36, 12, 147]); cpu.call(symbols.UiScrollbar);
                for (let y = 48; y < 171; y++) for (let x = 303; x < 313; x++)
                    assert.equal(pixel(cpu.m, 0xa000, x, y), +(y >= top && y < top + height));
                for (let y = 36; y < 183; y++) {
                    assert.equal(pixel(cpu.m, 0xa000, 302, y), 1);
                    assert.equal(pixel(cpu.m, 0xa000, 313, y), 1);
                }
            }
            untouchedRuntime(cpu);
        });
        for (const bounds of cases) await t.test(`publisher ${bounds.join(',')} preserves outside pixels and publishes colors last`, () => {
            const cpu = fresh(); cpu.m.fill(0, 0xa000, 0xbf40); rect(cpu, bounds);
            let colorsStarted = false, pixelWrites = 0;
            cpu.onWrite = address => {
                if (address >= 0x2000 && address < 0x3f40) {
                    assert.equal(colorsStarted, false, 'bitmap is complete before first color write');
                    pixelWrites++;
                }
                if (address >= 0x0400 && address < 0x07e8) { assert.ok(pixelWrites); colorsStarted = true; }
            };
            cpu.call(symbols.UiPublishRect);
            for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++)
                assert.equal(pixel(cpu.m, 0x2000, x, y), +!inside(bounds, x, y), `published ${x},${y}`);
            const [rx, ry, rw, rh] = bounds;
            for (let y = 0; y < 25; y++) for (let x = 0; x < 40; x++) {
                const touched = x >= (rx >> 3) && x <= ((rx + rw - 1) >> 3) &&
                    y >= (ry >> 3) && y <= ((ry + rh - 1) >> 3);
                assert.equal(cpu.m[0x0400 + y * 40 + x], touched ? 0x62 : 0x16);
            }
            assert.equal(colorsStarted, true);
            untouchedRuntime(cpu);
        });
    } finally {
        assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
        assert.ok(path.basename(temporary).startsWith('teensyrom-widgets-'));
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
