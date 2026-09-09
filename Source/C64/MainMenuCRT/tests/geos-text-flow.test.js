'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { desktopMachine } = require('./desktop-machine');
const { backendPETSCII } = require('./backend-petscii');

const root = path.resolve(__dirname, '../../../..');
// Optional immutable-artifact replay: assemble its symbols, then load and
// execute only the PRG extracted from the checksummed, address-aware HEX.
const release = process.env.GUI_TEXT_RELEASE_VERSION;
if (release) {
    assert.match(release, /^\d+\.\d+\.\d+$/);
    assert.match(process.env.GUI_TEXT_RELEASE_ID, /^native\d+$/);
}
const options = release ? {
    menuDir: path.join(root, `gui/selected-v${release}/Source/C64/MainMenuCRT`),
    releasedHex: path.join(root, `releases/${process.env.GUI_TEXT_RELEASE_ID}/MPE_Firmware-V${release}.hex`),
} : {};
if (release) options.releasedSha256 = JSON.parse(fs.readFileSync(path.join(root,
    `releases/${process.env.GUI_TEXT_RELEASE_ID}/manifest.json`), 'utf8')).files.find(file =>
    file.file === `MPE_Firmware-V${release}.hex`).sha256;

test('complete browser capture and firmware-update WAIT flow retains text encoding', t => desktopMachine(t,
    async ({ s, fresh, stub, textAt, region }) => {
        const io = s.IO1Port;
        function fixture() {
            const cpu = fresh(), titleGlyphs = [], wireReads = [], commands = [], messages = [];
            let selector = 0, offset = 0, pending = [], activeMessage, glyphs;
            cpu.p &= ~4;
            cpu.m[io + s.rWRegCurrMenuWAIT] = s.rmtSD;
            cpu.m[io + s.rRegNumItemsOnPage] = 16;
            cpu.m[io + s.rRegViewCountLo] = 32;
            cpu.m[io + s.rRegFirmwareTargetState] = 1;
            const filename = 'MPE_Firmware-V1.0.7.hex';
            const updateMessages = [
                'Create buffer ', 'Flash Buffer = 4096K of 8192K total\r\n(60000000 - 60400000)',
                'Open: SD/MPE_Firmware-V1.0.7.hex ', 'Reading hex file',
                'Verify file for TeensyROM+: ', 'Copying Buffer over main Flash area\r\n', 'Erasing Flash buffer ',
            ];
            for (const text of [updateMessages[0], ...updateMessages.slice(3)])
                assert.ok(fs.readFileSync(path.join(root, 'Source/Teensy/FlashUpdate.ino'), 'utf8').includes(JSON.stringify(text)) ||
                    fs.readFileSync(path.join(root, 'Source/Teensy/Flash/FXUtil.cpp'), 'utf8').includes(JSON.stringify(text)), 'message is from the actual firmware updater');
            const bytes = () => {
                if (selector === s.rsstShortDirPath) return backendPETSCII('/Games/Text_Files/');
                if (selector === s.rsstDesktopLabel) return Buffer.from(`Text_${cpu.m[io + s.rwRegSelItemOnPage]}.txt`);
                if (selector === s.rsstFirmwareName) return Buffer.from(filename);
                if (selector === s.rsstSerialStringBuf) return pending.length ? backendPETSCII('\r\n' + pending[0]) : Buffer.alloc(0);
                assert.fail(`unexpected serial selector ${selector}`);
            };
            const step = cpu.step.bind(cpu);
            cpu.step = () => {
                const opcode = cpu.m[cpu.pc], address = cpu.m[cpu.pc + 1] | cpu.m[cpu.pc + 2] << 8;
                if ([0xad, 0xcd].includes(opcode) && address === io + s.rwRegStatus)
                    cpu.m[address] = pending.length ? s.rsC64Message : s.rsReady;
                if (opcode === 0xad && address === io + s.rwRegSerialString) {
                    cpu.m[address] = bytes()[offset++] || 0; wireReads.push([selector, cpu.m[address]]);
                }
                if (opcode === 0xad && address === io + s.rRegItemTypePlusIOH) cpu.m[address] = s.rtFilePrg;
                step();
            };
            cpu.onWrite = (address, value) => {
                if (address === io + s.rwRegSerialString) { selector = value; offset = 0; }
                if (address === io + s.wRegControl) {
                    commands.push(value);
                    if (value === s.rCtlStartSelItemWAIT) pending = [...updateMessages];
                }
                if (address === io + s.rwRegStatus && value === s.rsContinue) {
                    assert.equal(offset, bytes().length + 1, 'entire message including NUL precedes acknowledgment');
                    messages.push({ text: pending.shift(), decoded: Buffer.from(glyphs.map(g => g.code)).toString('latin1'),
                        glyphs, pixels: region(cpu, 31, 60, 258, 59) });
                    activeMessage = false;
                }
            };
            cpu.hooks.set(s.GeosBitmapWaitMessage, () => { activeMessage = true; glyphs = []; });
            cpu.hooks.set(s.RichChar, c => {
                const glyph = { code: c.a, x: c.m[s.RichX] + c.m[s.RichXHi] * 256, y: c.m[s.RichY] };
                if (glyph.y === 16) titleGlyphs.push(c.a);
                if (activeMessage && glyph.y >= 60 && glyph.y < 120) glyphs.push(glyph);
            });
            // Only external KERNAL output is replaced; the capture, renderer,
            // mode flags, WAIT handshake and update command path all execute.
            cpu.m[s.SendChar] = 0x60;
            stub(cpu, 'GetIn', c => { c.a = c.nz(0xd9); });
            stub(cpu, 'AnyKeyErrMsgWait');
            stub(cpu, 'ListAndDone');
            cpu.call(s.GeosShellInit);
            cpu.call(s.GeosShellEnterBrowser);
            return { cpu, titleGlyphs, wireReads, commands, messages, updateMessages };
        }
        await t.test('sixteen filename captures, full publication, and cached menu restore retain SD Card', () => {
            const { cpu, titleGlyphs } = fixture();
            Buffer.from('?? ?ard\0').copy(cpu.m, s.GeosBrowserTitle);
            for (let round = 0; round < 3; round++) {
                titleGlyphs.length = 0;
                cpu.call(s.GeosDrawDesktop);
                assert.equal(textAt(cpu, s.GeosBrowserTitle), 'SD Card');
                assert.equal(textAt(cpu, s.GeosBrowserPath), '/Games/Text_Files/');
                assert.equal(Buffer.from(titleGlyphs).toString('ascii'), 'SD Card');
                for (let item = 0; item < 16; item++)
                    assert.equal(textAt(cpu, s.GeosRichFileLabels + item * 23), `Text_${item}.txt`);
                const titlePixels = region(cpu, 139, 16, 42, 7);
                cpu.m[s.GeosOverlayMode] = s.GeosOverlayMenu;
                cpu.m[s.GeosActiveMenu] = s.GeosMenuFile;
                cpu.call(s.GeosMenuRedraw);
                cpu.m[s.GeosOverlayMode] = 0;
                cpu.call(s.GeosMenuRedraw);
                assert.deepEqual(region(cpu, 139, 16, 42, 7), titlePixels);
                assert.equal(cpu.p & 4, 0, 'capture/draw/menu restore keeps IRQ enabled');
            }
        });
        await t.test('affirmative firmware flow draws every real progress message through GeosBitmapWaitMessage', () => {
            const { cpu, commands, messages, updateMessages } = fixture();
            cpu.call(s.GeosDrawDesktop);
            cpu.call(s.GeosFirmwareConfirm);
            assert.deepEqual(commands, [s.rCtlFirmwarePrepareWAIT, s.rCtlFirmwareCheckWAIT, s.rCtlStartSelItemWAIT, s.rCtlFirmwareCancel]);
            assert.deepEqual(messages.map(message => message.text), updateMessages);
            assert.deepEqual(messages.map(message => message.decoded), updateMessages.map(message => message.replace(/[\r\n]/g, '')));
            t.diagnostic(`decoded updater messages: ${JSON.stringify(messages.map(message => message.decoded))}`);
            for (const message of messages) for (const g of message.glyphs) for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
                const pixel = message.pixels[(g.y - 60 + y) * 258 + g.x - 31 + x];
                const expected = +(!!(cpu.m[s.GeosRichFont + (g.code - 32) * 8 + y] & (128 >> x)));
                assert.equal(pixel, expected, `${message.text}: actual published glyph at ${g.x},${g.y}`);
            }
            cpu.call(s.GeosDrawDesktop);
            assert.equal(textAt(cpu, s.GeosBrowserTitle), 'SD Card', 'browser recapture after update return retains its title');
            assert.equal(cpu.p & 4, 0);
        });
    }, options));
