'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const menuDir = path.resolve(__dirname, '..');
const probe = fs.readFileSync(path.join(__dirname, 'geos-color-publication.test.js'), 'utf8');
const start = probe.indexOf('class Cpu6502 {');
const end = probe.indexOf("test('assembled renderer", start);
assert.ok(start >= 0 && end > start, 'shared machine-code probe exists');
const Cpu6502 = vm.runInNewContext(probe.slice(start, end) + '\nCpu6502;', { assert });
const preview = fs.readFileSync(path.join(menuDir, 'preview-desktop.ps1'), 'utf8');
const acme = process.env.ACME_EXE || preview.match(/\$AcmePath\s*=\s*'([^']+)'/)[1];
const readSymbols = filename => Object.fromEntries([...fs.readFileSync(filename, 'utf8')
    .matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)]
    .map(match => [match[1], parseInt(match[2], 16)]));

test('resident app integration executes current desktop and extension machine code', async t => {
    if (!fs.existsSync(acme)) return t.skip('ACME unavailable; set ACME_EXE');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'teensyrom-app-integration-'));
    try {
        const desktopBinary = path.join(temporary, 'desktop.bin');
        const desktopSymbols = path.join(temporary, 'DesktopSymbols');
        const appBinary = path.join(temporary, 'apps.bin');
        const appSymbols = path.join(temporary, 'AppSymbols');
        const appSource = path.join(temporary, 'apps.asm');
        function assemble(source, binary, symbols, definitions = []) {
            const result = spawnSync(acme, ['--format', 'plain', ...definitions, '--symbollist', symbols,
                '--outfile', binary, source], { cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true });
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stdout + result.stderr);
        }
        assemble('source/DesktopShellCode.asm', desktopBinary, desktopSymbols);
        // Point only the import at this run's fresh symbol map, never rewrite build/.
        const source = fs.readFileSync(path.join(menuDir, 'source', 'GeosApps.asm'), 'utf8');
        assert.match(source, /!src "build\/DesktopSymbols"/);
        fs.writeFileSync(appSource, source.replace(/!src "build\/(?:vice-preview\/)?DesktopSymbols"/g,
            `!src "${desktopSymbols.replaceAll('\\', '/')}"`));
        assemble(appSource, appBinary, appSymbols, ['-DPreviewApps=1']);
        const s = { ...readSymbols(desktopSymbols), ...readSymbols(appSymbols) };
        const desktop = fs.readFileSync(desktopBinary);
        const apps = fs.readFileSync(appBinary);
        assert.ok(apps.length <= 4096, `resident app bank uses ${apps.length} bytes`);
        assert.equal(s.AppBackendAvailable, 0xc003, 'preview backend flag remains fixed');
        t.diagnostic(`Fresh desktop ${desktop.length} bytes; resident apps ${apps.length}/4096 bytes`);
        const fresh = (id = 2) => {
            const memory = Buffer.alloc(65536);
            desktop.copy(memory, s.MainCodeRAMStart);
            apps.copy(memory, 0xc000);
            memory[1] = 0x36;
            memory[s.AppID] = id;
            memory[s.Joystick2Sample] = 255;
            memory[s.AppJoyLast] = 255;
            return new Cpu6502(memory);
        };
        const key = (cpu, character) => {
            cpu.a = typeof character === 'number' ? character : character.charCodeAt(0);
            cpu.call(s.AppKey);
        };
        const capture = cpu => {
            const glyphs = [];
            cpu.hooks.set(s.RichChar, current => {
                assert.ok(current.a >= 32 && current.a < 128, 'native glyph input is ASCII, never shifted PETSCII');
                glyphs.push({ character: current.a, x: current.m[s.RichX] + 256 * current.m[s.RichXHi], y: current.m[s.RichY] });
            });
            return glyphs;
        };
        const lines = glyphs => {
            const rows = new Map();
            for (const glyph of glyphs.filter(glyph => glyph.y < 175)) {
                rows.set(glyph.y, (rows.get(glyph.y) || '') + String.fromCharCode(glyph.character));
            }
            return [...rows].sort((a, b) => a[0] - b[0]);
        };
        const stub = (cpu, symbol, callback = () => {}) => {
            cpu.m[s[symbol]] = 0x60;
            cpu.hooks.set(s[symbol], callback);
        };

        // Emulate only documented Teensy text-stream registers. All C64 drawing,
        // pagination, serial-message draining and number conversion run unmodified.
        const stream = (cpu, content, withMessage = false) => {
            const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'ascii');
            const io = s.IO1Port;
            const available = io + s.rRegStrAvailable;
            const data = io + s.rRegStreamData;
            const control = io + s.wRegControl;
            const status = io + s.rwRegStatus;
            const serial = io + s.rwRegSerialString;
            const message = Buffer.from('OPENING\0', 'ascii');
            const state = { index: 0, loads: 0, writes: [], serialIndex: 0, status: s.rsReady };
            const originalStep = cpu.step.bind(cpu);
            cpu.step = () => {
                const opcode = cpu.m[cpu.pc];
                const address = cpu.m[(cpu.pc + 1) & 65535] | cpu.m[(cpu.pc + 2) & 65535] << 8;
                if (opcode === 0xad) {
                    if (address === available) cpu.m[available] = +(state.index < bytes.length);
                    if (address === data) {
                        assert.ok(state.index < bytes.length, 'stream never reads beyond EOF');
                        cpu.m[data] = bytes[state.index++];
                    }
                    if (address === status) cpu.m[status] = state.status;
                    if (address === serial) cpu.m[serial] = message[state.serialIndex++] || 0;
                }
                originalStep();
            };
            cpu.onWrite = (address, value) => {
                if (address < io || address >= io + 256) return;
                state.writes.push([address, value]);
                if (address === control) {
                    assert.equal(value, s.rCtlStartSelItemWAIT, 'only reload selected stream is allowed');
                    state.loads++;
                    state.index = 0;
                    state.status = withMessage ? s.rsC64Message : s.rsReady;
                } else if (address === serial) {
                    assert.equal(value, s.rsstSerialStringBuf, 'only select transient status-message buffer');
                    state.serialIndex = 0;
                } else if (address === status) {
                    assert.equal(value, s.rsContinue, 'only acknowledge transient status message');
                    state.status = s.rsReady;
                } else assert.fail(`unexpected Teensy write $${address.toString(16)}=$${value.toString(16)}`);
            };
            for (const address of [0xffd2, 0xffd8, 0xfce2, s.Start]) {
                cpu.hooks.set(address, () => assert.fail(`viewer must not print controls, save files, or reset ($${address.toString(16)})`));
            }
            return state;
        };

        await t.test('AppKey routes all app IDs while STOP, ESC, and HOME close before app callbacks', () => {
            const snake = fresh(0);
            snake.call(s.SnakeInit);
            key(snake, s.ChrCRSRDn);
            assert.equal(snake.m[s.SnakePending], 1);
            const calculator = fresh(1);
            calculator.call(s.CalcInit);
            for (const character of '2+3=') key(calculator, character);
            assert.equal(calculator.m.readInt16LE(s.CalcValue), 5);
            for (const id of [2, 3]) {
                const text = fresh(id);
                text.call(s.TextInit);
                text.m.writeUInt16LE(40, s.BrowserRowsLo);
                text.m.writeUInt16LE(23, s.BrowserMaxRowLo);
                key(text, s.ChrReturn);
                assert.equal(text.m.readUInt16LE(s.BrowserTopRowLo), 17);
                assert.equal(text.m[s.AppDirty], 1);
            }
            for (const id of [0, 1, 2, 3]) for (const character of [s.ChrStop, 27, s.ChrHome]) {
                const cpu = fresh(id);
                for (const target of ['SnakeKey', 'CalcKey', 'TextKey']) {
                    cpu.hooks.set(s[target], () => assert.fail(`${target} must not receive close keys`));
                }
                key(cpu, character);
                assert.equal(cpu.m[s.AppExit], 1);
            }
        });

        await t.test('normalized letter shortcuts accept both PETSCII keyboard cases', () => {
            for (const character of [0x50, 0xd0, 0x70]) {
                const cpu = fresh(0);
                cpu.call(s.SnakeInit);
                key(cpu, character);
                assert.equal(cpu.m[s.SnakeState], 1, `Snake pause key $${character.toString(16)}`);
            }
            for (const character of [0x4f, 0xcf, 0x6f]) {
                const cpu = fresh(2);
                key(cpu, character);
                assert.equal(cpu.m[s.AppExit], 2, `Text open key $${character.toString(16)}`);
            }
        });

        await t.test('AppPrintNumber renders unsigned values including zero and 65535, consuming its input', () => {
            for (const number of [0, 1, 9, 10, 99, 100, 1000, 10000, 32768, 65535]) {
                const cpu = fresh();
                const glyphs = capture(cpu);
                cpu.x = 120;
                cpu.y = 42;
                cpu.call(s.AppPosition);
                cpu.m.writeUInt16LE(number, s.AppNumber);
                cpu.call(s.AppPrintNumber);
                assert.equal(glyphs.map(glyph => String.fromCharCode(glyph.character)).join(''), String(number));
                assert.equal(cpu.m.readUInt16LE(s.AppNumber), 0);
                assert.deepEqual(glyphs.map(glyph => glyph.x), [...String(number)].map((_, index) => 120 + index * 6));
            }
        });

        await t.test('demo text renders multiple separate lines entirely inside its framed window', () => {
            const cpu = fresh();
            cpu.m[s.AppBackendAvailable] = 0;
            cpu.call(s.TextInit);
            const glyphs = capture(cpu);
            const device = stream(cpu, 'THIS MUST NOT BE READ');
            cpu.call(s.TextDraw);
            assert.equal(device.loads, 0, 'welcome screen never starts a file stream');
            assert.equal(device.index, 0);
            const rendered = lines(glyphs);
            assert.equal(rendered[0][1], 'READ-ONLY TEXT');
            assert.ok(rendered.length >= 4, 'welcome instructions stay multiline');
            for (const glyph of glyphs) {
                assert.ok(glyph.x >= 16 && glyph.x + 4 <= 303, `glyph x=${glyph.x}`);
                assert.ok(glyph.y >= 36 && glyph.y + 6 <= 185, `glyph y=${glyph.y}`);
            }
            assert.equal(cpu.m[s.TextKnown], 1);
            assert.equal(cpu.m.readUInt16LE(s.BrowserTopRowLo), 0);
        });

        await t.test('text counts lines once and reopens only for committed line or viewport scrolling', () => {
            const cpu = fresh(3);
            cpu.call(s.TextInit);
            const glyphs = capture(cpu);
            const textLines = Array.from({ length: 40 }, (_, index) => `LINE ${String(index).padStart(2, '0')}`);
            const device = stream(cpu, textLines.join('\r\n'), true);
            const draw = first => {
                glyphs.length = 0;
                cpu.call(s.TextDraw);
                assert.deepEqual(lines(glyphs).map(row => row[1]), textLines.slice(first, first + 17));
                for (const glyph of glyphs.filter(glyph => glyph.y < 175)) {
                    assert.ok(glyph.x >= 16 && glyph.x + 4 < 286);
                    assert.ok(glyph.y >= 36 && glyph.y + 6 <= 170);
                }
            };
            draw(0);
            assert.equal(cpu.m.readUInt16LE(s.BrowserRowsLo), 40, 'actual wrapped-line count is known');
            assert.equal(device.index, Buffer.byteLength(textLines.join('\r\n')), 'first draw scans to EOF once');
            key(cpu, s.ChrCRSRDn);
            draw(1);
            assert.ok(device.index < Buffer.byteLength(textLines.join('\r\n')), 'later draws stop after visible rows');
            key(cpu, s.ChrCRSRRight);
            draw(18);
            key(cpu, s.ChrReturn);
            draw(23);
            assert.equal(cpu.m.readUInt16LE(s.BrowserTopRowLo), 23, 'last viewport clamps to final seventeen lines');
            key(cpu, s.ChrReturn);
            assert.equal(cpu.m.readUInt16LE(s.BrowserTopRowLo), 23);
            key(cpu, s.ChrCRSRLeft);
            draw(6);
            assert.equal(device.loads, 5, 'only committed redraws reopen the stream');
            assert.ok(device.serialIndex > 0, 'startup status message was drained');
        });

        await t.test('text thumb drag previews without stream IO and commits line offset on release', () => {
            const cpu = fresh(3); cpu.call(s.TextInit);
            const glyphs = capture(cpu);
            const rows = Array.from({ length: 300 }, (_, i) => `ROW ${i}`);
            const device = stream(cpu, rows.join('\n'));
            cpu.call(s.TextDraw);
            assert.equal(cpu.m.readUInt16LE(s.BrowserRowsLo), 300);
            const thumb = cpu.m[s.BrowserThumbY];
            cpu.m[s.MouseFrameX] = 154; cpu.m[s.MouseFrameY] = thumb + 2;
            cpu.call(s.TextClick);
            assert.equal(cpu.m[s.BrowserDragging], 1);
            const consumed = device.index, loads = device.loads;
            cpu.m[s.MouseFrameDown] = 1; cpu.m[s.MouseFrameY] = 170;
            cpu.call(s.TextDragFrame);
            assert.equal(cpu.m.readUInt16LE(s.BrowserTopRowLo), 0, 'preview does not commit');
            assert.equal(device.index, consumed); assert.equal(device.loads, loads);
            cpu.m[s.MouseFrameDown] = 0;
            cpu.call(s.TextDragFrame);
            assert.equal(cpu.m[s.BrowserDragging], 0);
            assert.equal(cpu.m.readUInt16LE(s.BrowserTopRowLo), 283, 'release reaches high-byte final line offset');
            assert.equal(device.loads, loads, 'release schedules redraw without reading in mouse handler');
            glyphs.length = 0; cpu.call(s.TextDraw);
            assert.deepEqual(lines(glyphs).map(row => row[1]), rows.slice(283));
            assert.equal(device.loads, loads + 1);
        });

        await t.test('empty text and bounded long-line counts produce honest scrollbar state', () => {
            const empty = fresh(3); empty.call(s.TextInit);
            const emptyGlyphs = capture(empty);
            stream(empty, ''); empty.call(s.TextDraw);
            assert.equal(empty.m.readUInt16LE(s.BrowserRowsLo), 0);
            assert.equal(empty.m.readUInt16LE(s.BrowserMaxRowLo), 0);
            assert.equal(empty.m[s.BrowserThumbH], 123);
            assert.equal(emptyGlyphs.filter(g => g.y === 177 && g.x >= 100)
                .map(g => String.fromCharCode(g.character & 127)).join(''), 'L0/0');
            const large = fresh(3); large.call(s.TextInit);
            const device = stream(large, '\n'.repeat(32770));
            large.call(s.TextDraw, 8000000);
            assert.equal(large.m.readUInt16LE(s.BrowserRowsLo), 32767);
            assert.equal(large.m[s.TextKnown], 2, 'capped count is explicitly marked with plus');
            assert.ok(device.index < 32770, 'the initial scan has a finite logical-line bound');
            assert.equal(large.m.readUInt16LE(s.BrowserMaxRowLo), 32750);
        });

        await t.test('text controls do not execute PETSCII screen controls and preserve CRLF plus blank LF lines', () => {
            const cpu = fresh(3);
            const glyphs = capture(cpu);
            stream(cpu, Buffer.from([65, 13, 10, 10, 66, 13, 10, 147, 67, 0x1b, 68]));
            cpu.call(s.TextDraw);
            assert.deepEqual(lines(glyphs), [[36, 'A'], [52, 'B'], [60, 'CD']]);
        });

        await t.test('an exact-width physical line does not insert an extra blank row before CRLF', () => {
            const cpu = fresh(3);
            const glyphs = capture(cpu);
            stream(cpu, 'X'.repeat(45) + '\r\nNEXT');
            cpu.call(s.TextDraw);
            assert.deepEqual(lines(glyphs), [[36, 'X'.repeat(45)], [44, 'NEXT']]);
        });

        await t.test('sixteen-bit line offsets clamp without wrapping or moving before the first line', () => {
            const cpu = fresh(3); cpu.call(s.TextInit);
            cpu.m.writeUInt16LE(32767, s.BrowserRowsLo);
            cpu.m.writeUInt16LE(32750, s.BrowserMaxRowLo);
            cpu.m.writeUInt16LE(32750, s.BrowserTopRowLo);
            key(cpu, s.ChrReturn);
            assert.equal(cpu.m.readUInt16LE(s.BrowserTopRowLo), 32750);
            key(cpu, s.ChrCRSRUp);
            assert.equal(cpu.m.readUInt16LE(s.BrowserTopRowLo), 32749);
            cpu.m.writeUInt16LE(0, s.BrowserTopRowLo);
            key(cpu, s.ChrCRSRLeft);
            assert.equal(cpu.m.readUInt16LE(s.BrowserTopRowLo), 0);
        });

        await t.test('text Open callbacks request browser return code 2, and app return unwinds without reset', () => {
            for (const backend of [0, 1]) {
                const cpu = fresh();
                cpu.m[s.AppBackendAvailable] = backend;
                cpu.m[s.MouseFrameX] = 10;
                cpu.m[s.MouseFrameY] = 177;
                cpu.call(s.TextClick);
                assert.equal(cpu.m[s.AppExit], backend ? 2 : 0);
            }
            for (const result of [1, 2]) {
                const cpu = fresh();
                cpu.m[s.AppExit] = result;
                for (const symbol of ['MouseClickEdge', 'MouseOpenArmed', 'GeosMouseWasDown', 'GeosDragActive']) {
                    cpu.m[s[symbol]] = 1;
                }
                cpu.call(s.AppReturn);
                assert.equal(cpu.a, result);
                for (const symbol of ['MouseClickEdge', 'MouseOpenArmed', 'GeosMouseWasDown', 'GeosDragActive']) {
                    assert.equal(cpu.m[s[symbol]], 0, symbol);
                }
                assert.equal(cpu.m[s.GeosDragCandidate], 255);
            }
            for (const result of [1, 2]) {
                const cpu = fresh();
                cpu.m[s.AppBackendAvailable] = 0; // PreviewApps keeps its resident dispatcher.
                let browser = 0;
                let redraw = 0;
                stub(cpu, 'GeosAppEntry', current => { current.a = result; });
                stub(cpu, 'GeosShellOpenSource', current => { browser++; assert.equal(current.a, s.rmtSD); });
                stub(cpu, 'GeosShellRedraw', () => { redraw++; });
                cpu.hooks.set(s.Start, () => assert.fail('return must not reset desktop'));
                cpu.call(s.GeosShellOpenApp);
                assert.equal(browser, result === 2 ? 1 : 0);
                assert.equal(redraw, result === 1 ? 1 : 0);
            }
        });

        await t.test('every full app entry draws, handles STOP, and returns to its caller without a reset', () => {
            for (const id of [0, 1, 2, 3]) {
                const cpu = fresh(id);
                const device = stream(cpu, 'READ ONLY FILE\r\nSECOND LINE');
                stub(cpu, 'GetIn', current => { current.a = s.ChrStop; current.nz(current.a); });
                stub(cpu, 'GeosRichClock');
                cpu.a = id;
                cpu.call(s.GeosAppEntry);
                assert.equal(cpu.a, 1, `app ${id} returns normal-close code`);
                assert.equal(cpu.m[1], 0x36, `app ${id} restores memory banking`);
                assert.equal(device.loads, id === 3 ? 1 : 0);
            }
        });

        const isInteriorByte = offset => {
            const row = Math.floor(offset / 320);
            const cellOffset = offset % 320;
            return row >= 4 && row <= 22 && cellOffset >= 16 && cellOffset < 304;
        };

        await t.test('fast interior clear touches exactly 5472 bytes and preserves every other staging byte', () => {
            const cpu = fresh();
            const before = Buffer.from(Array.from({ length: 8192 }, (_, index) => index % 255 + 1));
            before.copy(cpu.m, 0xa000);
            const writes = new Map();
            cpu.onWrite = (address, value) => {
                if (address < 0xa000 || address >= 0xc000) return;
                assert.equal(value, 0);
                writes.set(address, (writes.get(address) || 0) + 1);
            };
            cpu.call(s.AppClearInterior);
            assert.equal(writes.size, 19 * 36 * 8);
            for (let offset = 0; offset < 8192; offset++) {
                const cleared = isInteriorByte(offset);
                assert.equal(cpu.m[0xa000 + offset], cleared ? 0 : before[offset],
                    `staging $${(0xa000 + offset).toString(16)}`);
                assert.equal(writes.get(0xa000 + offset) || 0, cleared ? 1 : 0,
                    `write count at $${(0xa000 + offset).toString(16)}`);
            }
        });

        await t.test('AppBegin creates the desktop only once and leaves window chrome intact on redraw', () => {
            const cpu = fresh(1);
            let homeCalls = 0;
            cpu.hooks.set(s.GeosRichHome, () => { homeCalls++; });
            cpu.call(s.AppBegin);
            assert.equal(homeCalls, 1);
            assert.equal(cpu.m[s.AppFrameReady], 1);
            const frame = Buffer.from(cpu.m.subarray(0xa000, 0xc000));
            for (let offset = 0; offset < 8192; offset++) {
                if (isInteriorByte(offset)) cpu.m[0xa000 + offset] = 0xa5;
            }
            cpu.call(s.AppBegin);
            cpu.call(s.AppBegin);
            assert.equal(homeCalls, 1, 'subsequent redraws never reconstruct desktop or window');
            assert.equal(cpu.m[s.AppFrameReady], 1);
            for (let offset = 0; offset < 8192; offset++) {
                assert.equal(cpu.m[0xa000 + offset], isInteriorByte(offset) ? 0 : frame[offset],
                    `chrome/guard preservation at $${(0xa000 + offset).toString(16)}`);
            }
        });

        await t.test('optimized redraw is byte-identical to a complete frame redraw for every app', () => {
            for (const id of [0, 1, 2, 3]) {
                const cpu = fresh(id);
                const draw = id === 0 ? 'SnakeDraw' : id === 1 ? 'CalcDraw' : 'TextDraw';
                const init = id === 0 ? 'SnakeInit' : id === 1 ? 'CalcInit' : 'TextInit';
                const device = stream(cpu, Array.from({ length: 35 }, (_, index) => `LINE ${index}`).join('\r\n'));
                cpu.call(s[init]);
                cpu.call(s.AppBegin);
                cpu.call(s[draw]);
                if (id === 0) key(cpu, 'p');
                if (id === 1) for (const character of '0-123=') key(cpu, character);
                if (id === 3) key(cpu, s.ChrCRSRRight);
                cpu.call(s.AppBegin);
                cpu.call(s[draw]);
                const optimized = Buffer.from(cpu.m.subarray(0xa000, 0xc000));
                cpu.m[s.AppFrameReady] = 0;
                cpu.call(s.AppBegin);
                cpu.call(s[draw]);
                assert.deepEqual(cpu.m.subarray(0xa000, 0xc000), optimized,
                    `app ${id}: all 8192 staging bytes match full redraw`);
                assert.equal(device.loads, id === 3 ? 3 : 0);
            }
        });

        await t.test('ordinary Snake movement redraws only old tail and new head, including tail-cell reentry', () => {
            for (const [name, body, direction, pending] of [
                ['straight movement', [0x67, 0x66, 0x65], 0, 0],
                ['departing-tail reentry', [0x22, 0x23, 0x33, 0x32], 2, 1],
            ]) {
                const cpu = fresh(0);
                cpu.call(s.SnakeInit);
                body.forEach((cell, index) => { cpu.m[s.SnakeBody + index] = cell; });
                cpu.m[s.SnakeLength] = body.length;
                cpu.m[s.SnakeDirection] = direction;
                cpu.m[s.SnakePending] = pending;
                cpu.m[s.SnakeFoodCell] = 0xa0;
                cpu.m[s.AppRenderMode] = 1;
                cpu.call(s.AppBegin);
                cpu.call(s.SnakeDraw);
                const initial = Buffer.from(cpu.m.subarray(0xa000, 0xc000));
                cpu.m[s.AppTick] = cpu.m[s.SnakeLastTick] + 9;
                cpu.m[0xa2] = cpu.m[s.AppTick];
                cpu.call(s.SnakeTick);
                assert.equal(cpu.m[s.AppDirty], 2, `${name}: incremental invalidation`);
                assert.equal(cpu.m[s.SnakeOldTail], body.at(-1));
                assert.equal(cpu.m[s.SnakeState], 0, 'departing tail remains a legal destination');
                const rectangles = [];
                cpu.hooks.set(s.RichRect, current => rectangles.push([
                    current.m[s.RichX] + 256 * current.m[s.RichXHi], current.m[s.RichY],
                    current.m[s.RichW], current.m[s.RichH], current.m[s.RichInk],
                ]));
                cpu.hooks.set(s.AppClearInterior, () => assert.fail('incremental Snake update must not clear the board'));
                stub(cpu, 'GeosRichClock');
                stub(cpu, 'GetIn', current => { current.a = s.ChrStop; current.nz(current.a); });
                cpu.call(s.AppRedraw);
                assert.equal(cpu.m[s.AppRenderMode], 2, 'host snapshots dirty mode before consuming it');
                assert.equal(cpu.m[s.AppDirty], 0);
                const rectangle = (cell, ink) => [33 + (cell & 15) * 8, 49 + (cell >> 4) * 8, 6, 6, ink];
                assert.deepEqual(rectangles, [rectangle(body.at(-1), 0), rectangle(cpu.m[s.SnakeBody], 255)],
                    `${name}: erase before drawing the head`);
                const incremental = Buffer.from(cpu.m.subarray(0xa000, 0xc000));
                if (name === 'departing-tail reentry') assert.deepEqual(incremental, initial,
                    'head/tail roles change but the four occupied cells stay visible');
                cpu.hooks.delete(s.AppClearInterior);
                cpu.m[s.AppFrameReady] = 0;
                cpu.m[s.AppRenderMode] = 1;
                cpu.call(s.AppBegin);
                cpu.call(s.SnakeDraw);
                assert.deepEqual(cpu.m.subarray(0xa000, 0xc000), incremental,
                    `${name}: incremental pixels equal a complete redraw`);
            }
        });

        await t.test('Snake food and pause invalidate the full interior after incremental movement', () => {
            for (const action of ['food', 'pause']) {
                const cpu = fresh(0);
                cpu.call(s.SnakeInit);
                cpu.m[s.AppRenderMode] = 1;
                cpu.call(s.AppBegin);
                cpu.call(s.SnakeDraw);
                if (action === 'food') cpu.m[s.SnakeFoodCell] = cpu.m[s.SnakeBody] + 1;
                else cpu.m[s.SnakeFoodCell] = 0xa0;
                cpu.m[s.AppTick] = cpu.m[s.SnakeLastTick] + 9;
                cpu.m[0xa2] = cpu.m[s.AppTick];
                cpu.call(s.SnakeTick);
                if (action === 'pause') {
                    assert.equal(cpu.m[s.AppDirty], 2);
                    key(cpu, 'p');
                    assert.equal(cpu.m[s.SnakeState], 1);
                } else assert.equal(cpu.m[s.SnakeLength], 4, 'food grows the snake');
                assert.equal(cpu.m[s.AppDirty], 1, `${action}: full invalidation wins`);
                let clears = 0;
                cpu.hooks.set(s.AppClearInterior, () => { clears++; });
                stub(cpu, 'GeosRichClock');
                stub(cpu, 'GetIn', current => { current.a = s.ChrStop; current.nz(current.a); });
                cpu.call(s.AppRedraw);
                assert.equal(cpu.m[s.AppRenderMode], 1);
                assert.equal(clears, 1);
                const redrawn = Buffer.from(cpu.m.subarray(0xa000, 0xc000));
                cpu.m[s.AppFrameReady] = 0;
                cpu.call(s.AppBegin);
                cpu.call(s.SnakeDraw);
                assert.deepEqual(cpu.m.subarray(0xa000, 0xc000), redrawn,
                    `${action}: status, score, body, and food match a full new frame`);
            }
        });

        await t.test('selected TXT/SEQ files route to app 3 while binary and HEX retain their legacy launch path', () => {
            for (const type of [s.rtFileTxt, s.rtFilePETSCII]) for (const flag of [0, 128]) {
                const cpu = fresh();
                cpu.m[s.GeosViewMode] = 1;
                cpu.m[s.IO1Port + s.rRegItemTypePlusIOH] = type | flag;
                let viewer = 0;
                stub(cpu, 'Mouse1351Hide');
                stub(cpu, 'GeosShellOpenApp', current => { viewer++; assert.equal(current.a, 3); });
                cpu.hooks.set(s.IRQDisable, () => assert.fail('native text viewer must not stop the desktop IRQ'));
                cpu.hooks.set(s.PrintBanner, () => assert.fail('native text viewer must not switch to the text banner'));
                cpu.hooks.set(s.ViewTextFile, () => assert.fail('native text viewer must not use the legacy viewer'));
                cpu.call(s.RunSelected);
                assert.equal(viewer, 1);
            }
            for (const type of [s.rtFileHex, s.rtFilePrg]) {
                assert.ok(Number.isInteger(type), 'legacy type symbol exists');
                const cpu = fresh();
                cpu.m[s.GeosViewMode] = 1;
                cpu.m[s.IO1Port + s.rRegItemTypePlusIOH] = type;
                cpu.m[s.IO1Port + s.rRegStrAvailable] = 0;
                const visited = [];
                for (const symbol of ['Mouse1351Hide', 'IRQDisable', 'PrintBanner', 'SendChar', 'PrintSerialString',
                    'PrintString', 'IRQEnable', 'StartSelItem_WaitForTRDots', 'AnyKeyErrMsgWait', 'ListMenuItems']) {
                    stub(cpu, symbol, () => { visited.push(symbol); });
                }
                stub(cpu, 'GetIn', current => { current.a = 0x4e; current.nz(current.a); }); // PETSCII N: decline HEX update.
                cpu.hooks.set(s.GeosShellOpenApp, () => assert.fail('binary/HEX must not enter native text viewer'));
                cpu.call(s.RunSelected);
                assert.ok(visited.includes('IRQDisable'));
                assert.ok(visited.includes('PrintBanner'));
                assert.ok(visited.indexOf('IRQDisable') < visited.indexOf('PrintBanner'));
                assert.ok(visited.includes('ListMenuItems'));
            }
        });

        await t.test('production loader copies app bank before overlapping main relocation, with exact bounds', () => {
            const loaderSource = path.join(temporary, 'loader.asm');
            const loaderBinary = path.join(temporary, 'loader.bin');
            const loaderSymbols = path.join(temporary, 'LoaderSymbols');
            const settingsSource = path.join(temporary, 'loader-settings.asm');
            const settingsBinary = path.join(temporary, 'loader-settings.bin');
            const settingsSymbols = path.join(temporary, 'LoaderSettingsSymbols');
            fs.writeFileSync(settingsSource, fs.readFileSync(path.join(menuDir, 'source', 'GeosSettings.asm'), 'utf8')
                .replace(/!src "build\/(?:vice-preview\/)?DesktopSymbols"/g,
                    `!src "${desktopSymbols.replaceAll('\\', '/')}"`));
            assemble(settingsSource, settingsBinary, settingsSymbols);
            const settings = fs.readFileSync(settingsBinary);
            const loader = fs.readFileSync(path.join(menuDir, 'source', 'DesktopShell.asm'), 'utf8');
            assert.match(loader, /!binary "build\/DesktopShellCode\.bin"/);
            assert.match(loader, /!binary "build\/GeosApps\.bin"/);
            assert.match(loader, /!binary "build\/GeosSettings\.bin"/);
            fs.writeFileSync(loaderSource, loader
                .replace('!binary "build/DesktopShellCode.bin"', `!binary "${desktopBinary.replaceAll('\\', '/')}"`)
                .replace('!binary "build/GeosApps.bin"', `!binary "${appBinary.replaceAll('\\', '/')}"`)
                .replace('!binary "build/GeosSettings.bin"', `!binary "${settingsBinary.replaceAll('\\', '/')}"`));
            assemble(loaderSource, loaderBinary, loaderSymbols);
            const ls = readSymbols(loaderSymbols);
            const memory = Buffer.alloc(65536, 0xa5);
            fs.readFileSync(loaderBinary).copy(memory, 0x0801);
            const before = Buffer.from(memory);
            const cpu = new Cpu6502(memory);
            cpu.p |= 8; // Production entry must clear decimal mode itself.
            cpu.pc = ls.DesktopShellLoader;
            const mainEnd = ls.MainCodeRAMStart + desktop.length;
            const appsEnd = ls.GeosAppEntry + apps.length;
            const settingsEnd = ls.GeosSettingsBase + settings.length;
            const settingsTemporaryEnd = ls.DesktopSettingsTemporary + settings.length;
            assert.ok(mainEnd <= 0xa000);
            assert.ok(appsEnd <= 0xd000);
            assert.equal(mainEnd, ls.DesktopShellDestinationEnd);
            assert.ok(ls.DesktopShellPayload < ls.MainCodeRAMStart && ls.DesktopShellPayloadEnd > ls.MainCodeRAMStart,
                'fixture exercises actual overlapping main source/destination');
            assert.ok(ls.DesktopAppsPayload >= ls.MainCodeRAMStart && ls.DesktopAppsPayload < mainEnd,
                'main relocation would overwrite the app source if copied in the wrong order');
            let appWrites = 0;
            let mainWrites = 0;
            let settingsWrites = 0;
            let settingsTemporaryWrites = 0;
            let firstMainWrite = true;
            const targetWrites = new Map();
            cpu.onWrite = (address, value) => {
                if (address >= ls.GeosAppEntry && address < appsEnd) {
                    appWrites++;
                    assert.equal(value, apps[address - ls.GeosAppEntry]);
                } else if (address >= ls.GeosSettingsBase && address < settingsEnd) {
                    settingsWrites++;
                    assert.equal(value, settings[address - ls.GeosSettingsBase]);
                } else if (address >= ls.DesktopSettingsTemporary && address < settingsTemporaryEnd) {
                    settingsTemporaryWrites++;
                    assert.equal(value, settings[address - ls.DesktopSettingsTemporary]);
                } else if (address >= ls.MainCodeRAMStart && address < mainEnd) {
                    if (firstMainWrite) {
                        assert.equal(appWrites, apps.length, 'app extension is completely copied first');
                        assert.deepEqual(cpu.m.subarray(ls.GeosAppEntry, appsEnd), apps);
                        firstMainWrite = false;
                    }
                    mainWrites++;
                    assert.equal(value, desktop[address - ls.MainCodeRAMStart]);
                } else {
                    assert.ok(address === 1 || address === ls.DesktopCopyEndLo || address === ls.DesktopCopyEndHi ||
                        (address >= 0x100 && address < 0x200) || (address >= ls.PtrAddrLo && address <= ls.Ptr2AddrHi),
                        `loader writes only destinations, copy pointers, and its stack: $${address.toString(16)}`);
                    return;
                }
                targetWrites.set(address, (targetWrites.get(address) || 0) + 1);
            };
            let steps = 0;
            while (cpu.pc !== ls.MainCodeRAMStart) {
                assert.ok(steps++ < 1000000, 'loader reaches desktop entry');
                cpu.step();
            }
            assert.equal(cpu.sp, 255, 'loader app-copy helper balances the stack');
            assert.equal(cpu.p & 8, 0, 'loader cleared decimal mode');
            assert.equal(appWrites, apps.length);
            assert.equal(mainWrites, desktop.length);
            assert.equal(settingsTemporaryWrites, settings.length);
            assert.equal(settingsWrites, settings.length);
            assert.deepEqual(cpu.m.subarray(ls.MainCodeRAMStart, mainEnd), desktop);
            assert.deepEqual(cpu.m.subarray(ls.GeosAppEntry, appsEnd), apps);
            assert.deepEqual(cpu.m.subarray(ls.GeosSettingsBase, settingsEnd), settings);
            assert.deepEqual(cpu.m.subarray(ls.DesktopSettingsTemporary, settingsTemporaryEnd), settings);
            for (let address = 0; address < 65536; address++) {
                const destination = (address >= ls.MainCodeRAMStart && address < mainEnd)
                    || (address >= ls.GeosAppEntry && address < appsEnd)
                    || (address >= ls.GeosSettingsBase && address < settingsEnd)
                    || (address >= ls.DesktopSettingsTemporary && address < settingsTemporaryEnd);
                if (destination) assert.equal(targetWrites.get(address), 1, `one copy at $${address.toString(16)}`);
                else if (!(address >= 0x100 && address < 0x200)
                    && address !== 1 && address !== ls.DesktopCopyEndLo && address !== ls.DesktopCopyEndHi
                    && !(address >= ls.PtrAddrLo && address <= ls.Ptr2AddrHi)) {
                    assert.equal(cpu.m[address], before[address], `outside-loader guard at $${address.toString(16)}`);
                }
            }
        });
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
