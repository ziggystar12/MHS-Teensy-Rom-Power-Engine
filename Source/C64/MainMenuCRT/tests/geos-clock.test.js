'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {spawnSync} = require('node:child_process');
const {desktopMachine} = require('./desktop-machine');
const {backendPETSCII} = require('./backend-petscii');

const parseSymbols = filename => Object.fromEntries([...fs.readFileSync(filename, 'utf8')
    .matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)].map(m => [m[1], parseInt(m[2], 16)]));

// Assemble the utility against the same freshly assembled desktop used by the
// probe. Generated release headers are intentionally not prerequisites here.
async function clockMachine(t, callback) {
    return desktopMachine(t, async desktop => {
        const {s, acme, menuDir} = desktop;
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'teensyrom-clock-'));
        try {
            const labels = path.join(temporary, 'DesktopSymbols');
            fs.writeFileSync(labels, Object.entries(s).map(([name, value]) => `${name} = $${value.toString(16)}`).join('\n'));
            const source = path.join(temporary, 'clock.asm');
            const binary = path.join(temporary, 'clock.prg');
            const symbols = path.join(temporary, 'ClockSymbols');
            fs.writeFileSync(source, fs.readFileSync(path.join(menuDir, 'source/DesktopClock.asm'), 'utf8')
                .replace('"build/DesktopSymbols"', JSON.stringify(labels.replaceAll('\\', '/'))));
            const result = spawnSync(acme, ['--format', 'cbm', '--symbollist', symbols,
                '--outfile', binary, source], {cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true});
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stdout + result.stderr);
            const prg = fs.readFileSync(binary);
            assert.equal(prg.readUInt16LE(0), 0xc000, 'Clock streams into the established utility bank');
            assert.ok(prg.length <= 4098, `Clock uses ${prg.length - 2}/4096 bytes`);
            Object.assign(s, parseSymbols(symbols));
            t.diagnostic(`Clock uses ${prg.length - 2}/4096 bytes`);
            const fresh = () => {
                const cpu = desktop.fresh();
                prg.subarray(2).copy(cpu.m, 0xc000);
                cpu.m[s.IO1Port + s.rwRegStatus] = s.rsReady;
                return cpu;
            };
            await callback({...desktop, s, fresh, prg});
        } finally {
            assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith('teensyrom-clock-'));
            fs.rmSync(temporary, {recursive: true, force: true});
        }
    });
}

function writePng(cpu, s, pixel, output) {
    const palette = [0x000000,0xffffff,0x813338,0x75cec8,0x8e3c97,0x56ac4d,0x2e2c9b,0xedf171,
        0x8e5029,0x553800,0xc46c71,0x4a4a4a,0x7b7b7b,0xa9ff9f,0x706deb,0xb2b2b2];
    const width = 320, height = 200, pixels = Buffer.alloc(height * (width * 3 + 1));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const cell = cpu.m[s.C64ScreenRAM + (y >> 3) * 40 + (x >> 3)];
        const color = palette[pixel(cpu, x, y) ? cell >> 4 : cell & 15];
        const offset = y * (width * 3 + 1) + 1 + x * 3;
        pixels[offset] = color >> 16; pixels[offset + 1] = color >> 8; pixels[offset + 2] = color;
    }
    const crc32 = data => {
        let crc = 0xffffffff;
        for (const byte of data) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        return (crc ^ 0xffffffff) >>> 0;
    };
    const chunk = (name, data) => {
        const bytes = Buffer.concat([Buffer.from(name), data]);
        const size = Buffer.alloc(4), crc = Buffer.alloc(4);
        size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(bytes));
        return Buffer.concat([size, bytes, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
        chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
}

// A delayed Teensy exchange. This preserves the actual assembled wait loop and
// serial-string drain, while supplying the peripheral behavior absent in the
// instruction-level CPU probe. It does not emulate Ethernet or physical CIA
// timing; those remain separate hardware checks.
function backend(cpu, s, options = {}) {
    const register = name => s.IO1Port + s[name];
    const trace = {commands: [], writes: [], acknowledgments: 0, drained: 0, statusReads: 0, todWrites: []};
    let pending = 0, messages = [], current = null, cursor = 0;
    let time = options.time || [0x10, 0x08, 0x36];
    const installTime = () => {
        for (const [i, name] of ['rRegLastHourBCD', 'rRegLastMinBCD', 'rRegLastSecBCD'].entries()) {
            cpu.m[register(name)] = time[i];
        }
    };
    installTime();
    const address = cpu.address.bind(cpu);
    cpu.address = mode => {
        const result = address(mode);
        const opcode = cpu.m[(cpu.pc - (mode === 'abs' ? 3 : 1)) & 65535];
        // Absolute loads and comparisons read these device registers. Stores
        // are handled below and must not advance a serial stream.
        const reading = ![0x8d, 0x8e, 0x8c].includes(opcode);
        if (result === register('rwRegStatus') && reading) {
            trace.statusReads++;
            if (pending) {
                cpu.m[result] = s.rsWriteEEPROM;
                pending--;
            } else if (current || messages.length) {
                current ||= backendPETSCII(messages.shift() + '\0');
                cpu.m[result] = s.rsC64Message;
            } else cpu.m[result] = s.rsReady;
        }
        if (result === register('rwRegSerialString') && reading) {
            assert.ok(current, 'serial data is read only while a firmware message is pending');
            assert.ok(cursor < current.length, 'serial drain stops at the message terminator');
            cpu.m[result] = current[cursor++];
            trace.drained++;
        }
        return result;
    };
    cpu.onWrite = (location, value) => {
        if ([s.TODHoursBCD, s.TODMinBCD, s.TODSecBCD, s.TODTenthSecBCD].includes(location)) {
            trace.todWrites.push([location, value]);
        }
        if (location === register('wRegControl')) {
            trace.commands.push(value);
            pending = value === s.rCtlDesktopAppLoad ? 0 : 8;
            if (value === s.rCtlSetRTCfromNetWAIT) messages = [...(options.messages || ['RTC SYNC COMPLETE'])];
            installTime();
        }
        if ([register('rwRegPwrUpDefaults'), register('rwRegTimezone')].includes(location)) {
            trace.writes.push([location, value]);
            pending = 8;
        }
        if (location === register('rwRegSerialString')) {
            assert.equal(value, s.rsstSerialStringBuf, 'Clock selects the published firmware message');
            cursor = 0;
        }
        if (location === register('rwRegStatus') && value === s.rsContinue) {
            assert.ok(current, 'a pending firmware message exists before acknowledgment');
            assert.equal(cursor, current.length, 'the entire message is drained before acknowledging');
            trace.acknowledgments++;
            current = null; cursor = 0; pending = 8;
        }
    };
    return {
        trace,
        setTime: next => { time = next; installTime(); },
        settled: () => {
            assert.equal(pending, 0, 'the command completed before input resumes');
            assert.equal(current, null, 'no unacknowledged message remains');
            assert.equal(messages.length, 0, 'all firmware messages were consumed');
        }
    };
}

test('native Clock executes its assembled controls, RTC protocol and rendering', t => clockMachine(t,
async ({s, fresh, stub, pixel, region, textAt, menuDir, prg}) => {
    const rectangles = [[116,102,40,16], [164,102,40,16], [116,122,20,16], [220,122,20,16],
        [40,151,20,16], [96,151,20,16], [126,151,20,16], [182,151,20,16],
        [212,151,20,16], [268,151,20,16], [28,172,132,16], [176,172,112,16]];
    const point = (cpu, x, y) => {
        cpu.m[s.MouseFrameX] = Math.floor(x / 2);
        cpu.m[s.MouseFrameY] = y;
        cpu.x = Math.floor(x / 8); cpu.y = Math.floor(y / 8);
    };

    await t.test('all twelve visible controls share their clickable targets and keyboard navigation', () => {
        const cpu = fresh();
        let activated = [];
        stub(cpu, 'ClockActivate', current => { activated.push(current.m[s.ClockSelection]); });
        for (const [index, [x, y, width, height]] of rectangles.entries()) {
            for (const [px, py] of [[x, y], [x + width - 2, y + height - 1], [x + width / 2, y + height / 2]]) {
                point(cpu, px, py);
                cpu.call(s.ClockClick);
                assert.equal(cpu.m[s.ClockSelection], index, `control ${index} at ${px},${py}`);
                assert.equal(activated.at(-1), index, 'click activates the control it visibly targets');
            }
        }
        for (const [x, y] of [[0,0], [160,44], [114,102], [156,102], [164,118], [304,191], [320,199]]) {
            const count = activated.length;
            point(cpu, x, y); cpu.call(s.ClockClick);
            assert.equal(activated.length, count, `background ${x},${y} activates nothing`);
        }
        for (let selection = 0; selection < rectangles.length; selection++) {
            for (const [key, expected] of [[s.ChrCRSRLeft,(selection+11)%12], [s.ChrCRSRUp,(selection+11)%12],
                [s.ChrCRSRRight,(selection+1)%12], [s.ChrCRSRDn,(selection+1)%12]]) {
                cpu.m[s.ClockSelection] = selection; cpu.a = key; cpu.call(s.ClockKey);
                assert.equal(cpu.m[s.ClockSelection], expected, 'arrow keys follow the clickable settings');
            }
            cpu.m[s.ClockSelection] = selection; cpu.a = s.ChrReturn; cpu.call(s.ClockKey);
            assert.equal(activated.at(-1), selection, 'Enter activates the highlighted control');
        }
    });

    await t.test('format and startup-sync saves preserve music and unrelated EEPROM bits', () => {
        for (const saved of [0x00, 0x01, 0x55, 0xaa, 0xfe, 0xff]) {
            for (const selection of [0, 1, 11]) {
                const cpu = fresh(), host = backend(cpu, s);
                cpu.p &= ~4;
                cpu.m[s.IO1Port+s.rwRegPwrUpDefaults] = saved;
                cpu.m[s.ClockSelection] = selection;
                cpu.call(s.ClockActivate);
                const expected = selection === 0 ? saved & ~s.rpudClock12_24hr
                    : selection === 1 ? saved | s.rpudClock12_24hr : saved ^ s.rpudNetTimeMask;
                assert.equal(cpu.m[s.IO1Port+s.rwRegPwrUpDefaults], expected);
                assert.equal(cpu.m[s.IO1Port+s.rwRegPwrUpDefaults] & 1, saved & 1,
                    'a Clock setting cannot turn paused startup music back on');
                assert.equal(cpu.p & 4, 0, 'EEPROM waiting leaves music and mouse IRQs enabled');
                host.settled();
            }
        }
    });

    await t.test('half-hour timezone controls wrap -12 through +14 and resynchronize the CIA clock', () => {
        for (const [selection, before, after] of [[2,-24,28], [3,28,-24], [2,0,-1], [3,-1,0], [2,11,10], [3,11,12]]) {
            const cpu = fresh(), host = backend(cpu, s, {time: [0x91,0x59,0x42]});
            cpu.m[s.IO1Port+s.rwRegTimezone] = before & 255;
            cpu.m[s.ClockSelection] = selection; cpu.call(s.ClockActivate);
            assert.equal(cpu.m[s.IO1Port+s.rwRegTimezone], after & 255);
            assert.ok(host.trace.commands.includes(s.rCtlC64TODfromRTCWAIT));
            assert.deepEqual([cpu.m[s.TODHoursBCD],cpu.m[s.TODMinBCD],cpu.m[s.TODSecBCD]], [0x91,0x59,0x42]);
            assert.equal(host.trace.todWrites.at(-1)[0], s.TODTenthSecBCD, 'tenths are written last to restart CIA TOD');
            host.settled();
        }
    });

    await t.test('hour, minute and second buttons send each established RTC adjustment command', () => {
        const commands = ['rCtlRTCAdj_Hrs_Dn_WAIT','rCtlRTCAdj_Hrs_Up_WAIT','rCtlRTCAdj_Min_Dn_WAIT',
            'rCtlRTCAdj_Min_Up_WAIT','rCtlRTCAdj_Sec_Dn_WAIT','rCtlRTCAdj_Sec_Up_WAIT'];
        for (const [offset, command] of commands.entries()) {
            const cpu = fresh(), host = backend(cpu, s, {time:[0x12,0x34,0x56]});
            cpu.m[s.ClockSelection] = offset + 4; cpu.call(s.ClockActivate);
            assert.deepEqual(host.trace.commands, [s[command]]);
            assert.deepEqual([cpu.m[s.TODHoursBCD],cpu.m[s.TODMinBCD],cpu.m[s.TODSecBCD]], [0x12,0x34,0x56]);
            assert.equal(host.trace.todWrites.at(-1)[0], s.TODTenthSecBCD);
            host.settled();
        }
    });

    await t.test('network sync fully drains multiple firmware messages before acknowledging and installing time', () => {
        const messages = ['\r\nEthernet connected: requesting current network time from server', '\r\nRTC sync complete'];
        const cpu = fresh(), host = backend(cpu, s, {messages, time:[0x09,0x08,0x07]});
        let polls = 0, pointers = 0;
        cpu.p &= ~4;
        cpu.hooks.set(s.ClockWaitPoll, current => {
            polls++;
            assert.equal(current.p&4,0,'each network wait iteration retains music and mouse interrupts');
        });
        stub(cpu,'Mouse1351ShowPointer',()=>{pointers++;});
        cpu.m[s.ClockSelection] = 10; cpu.call(s.ClockActivate);
        assert.deepEqual(host.trace.commands, [s.rCtlSetRTCfromNetWAIT, s.rCtlC64TODfromRTCWAIT]);
        assert.equal(host.trace.acknowledgments, messages.length);
        assert.equal(host.trace.drained, messages.reduce((sum, value) => sum + value.length + 1, 0));
        assert.equal(textAt(cpu, s.ClockStatus), messages.at(-1).replace(/[\x01-\x1f]/g,' '));
        assert.ok(polls>1,'delayed firmware commands exercise the actual wait loop');
        assert.ok(pointers>0,'the pointer remains serviced while waiting for Ethernet');
        assert.equal(cpu.p & 4, 0, 'a network wait retains interrupts');
        host.settled();
    });

    await t.test('Clock loads through the real firmware stream and closes back to Control Panel', () => {
        const cpu = fresh(), host = backend(cpu, s);
        cpu.m.fill(0, 0xc000, 0xd000);
        cpu.m[s.GeosAppBackendAvailable] = 1;
        cpu.m[s.GeosControlMode] = 0;
        cpu.m[s.GeosControlSelection] = 4;
        cpu.m[s.GeosOverlayMode] = s.GeosOverlayControl;
        let offset = 0, entered = 0, returned = 0;
        const address = cpu.address.bind(cpu);
        cpu.address = mode => {
            const location = address(mode);
            if (location === s.IO1Port+s.rRegStrAvailable) cpu.m[location] = Number(offset < prg.length);
            if (location === s.IO1Port+s.rRegStreamData) {
                assert.ok(offset < prg.length, 'stream never reads past the PRG');
                cpu.m[location] = prg[offset++];
            }
            return location;
        };
        cpu.hooks.set(0xc000, () => { entered++; });
        stub(cpu, 'GetIn', current => { current.a = current.nz(s.ChrStop); });
        stub(cpu, 'GeosShellRedraw', () => { returned++; });
        cpu.call(s.GeosShellLaunchControlPage);
        assert.equal(cpu.m[s.IO1Port+s.rwRegDesktopAppID], s.rdaClock, 'Clock category selects its dedicated stream');
        assert.equal(host.trace.commands[0], s.rCtlDesktopAppLoad);
        assert.equal(offset, prg.length, 'actual FastLoadFile consumes the full Clock PRG');
        assert.equal(entered, 1, 'the freshly loaded app entry executes');
        assert.equal(returned, 1, 'STOP returns to the settings panel');
        assert.equal(cpu.m[s.GeosOverlayMode], s.GeosOverlayControl);
        assert.equal(cpu.m[1], 0x37, 'application returns with its original memory bank');
        assert.equal(cpu.m[s.MouseOpenArmed], 0, 'closing clears stale double-click input');
        host.settled();
    });

    await t.test('analog hands follow the live TOD clock and a second tick publishes fresh readouts', () => {
        const cpu = fresh();
        backend(cpu, s);
        const glyphs = [];
        cpu.hooks.set(s.RichChar, current => {
            assert.ok(current.a >= 32 && current.a < 128, 'rendered glyphs are normalized from PETSCII to font codes');
            glyphs.push({value: String.fromCharCode(current.a),
                x: current.m[s.RichX] + current.m[s.RichXHi] * 256, y: current.m[s.RichY]});
        });
        const setTime = (hour, minute, second) => {
            cpu.m[s.TODHoursBCD] = hour;
            cpu.m[s.TODMinBCD] = minute;
            cpu.m[s.TODSecBCD] = second;
        };
        const digits = x => glyphs.filter(glyph => glyph.y === 156 && glyph.x >= x && glyph.x < x + 12)
            .map(glyph => glyph.value).join('');
        setTime(0x12, 0x00, 0x00);
        cpu.call(s.ClockInit); cpu.call(s.ClockDraw);
        assert.equal(digits(72), '12'); assert.equal(digits(158), '00'); assert.equal(digits(244), '00');
        assert.equal(pixel(cpu,160,44), 1, 'hands join at the dial center');
        assert.ok(region(cpu,158,24,5,15).some(Boolean), 'midnight hands point toward twelve');
        const midnight = region(cpu,128,12,64,64);
        glyphs.length = 0;
        setTime(0x03,0x15,0x30); cpu.call(s.ClockRefresh);
        assert.equal(digits(72), '03'); assert.equal(digits(158), '15'); assert.equal(digits(244), '30');
        assert.notDeepEqual(region(cpu,128,12,64,64), midnight, 'the second tick updates actual analog pixels');
        assert.ok(region(cpu,170,42,12,5).some(Boolean), 'quarter-past minute hand points right');
        assert.ok(region(cpu,158,51,5,13).some(Boolean), 'thirty-second hand points downward');
        const unchanged = Buffer.from(cpu.m.subarray(s.GeosBitmapRAM, s.GeosBitmapRAM+8000));
        glyphs.length = 0;
        cpu.call(s.ClockRefresh);
        assert.equal(glyphs.length, 0, 'unchanged time does not redraw settings');
        assert.deepEqual(cpu.m.subarray(s.GeosBitmapRAM,s.GeosBitmapRAM+8000), unchanged);
        assert.equal(cpu.m[1],0x37,'refresh restores the active memory bank');
        if (process.env.GUI_CLOCK_PROOF === '1') {
            setTime(0x10,0x08,0x36);
            cpu.m[s.IO1Port+s.rwRegTimezone] = -14 & 255;
            cpu.m[s.IO1Port+s.rwRegPwrUpDefaults] = s.rpudNetTimeMask | 1;
            Buffer.from('RTC SYNC COMPLETE\0','ascii').copy(cpu.m,s.ClockStatus);
            cpu.call(s.ClockDraw);
            const output = path.resolve(menuDir,'../../../build/gui-clock-proof/clock.png');
            writePng(cpu,s,pixel,output);
            t.diagnostic(`actual rendered bitmap: ${output}`);
        }
    });

    await t.test('local digital display handles midnight, noon, PM and signed half-hour offsets', () => {
        const cpu = fresh();
        backend(cpu, s);
        const glyphs = [];
        cpu.hooks.set(s.RichChar, current => {
            assert.ok(current.a >= 32 && current.a < 128, 'all direct AM/PM and status glyphs use font codes');
            glyphs.push({value: String.fromCharCode(current.a),
                x: current.m[s.RichX]+current.m[s.RichXHi]*256, y:current.m[s.RichY]});
        });
        const line = (y, x, width) => glyphs.filter(glyph => glyph.y===y && glyph.x>=x && glyph.x<x+width)
            .map(glyph => glyph.value).join('');
        for (const [hour, format, expected, caption] of [[0x12,0,'12','AM'], [0x92,0,'12','PM'],
            [0x91,0,'11','PM'], [0x12,8,'00','24 HOUR'], [0x92,8,'12','24 HOUR'],
            [0x81,8,'13','24 HOUR'], [0x88,8,'20','24 HOUR'], [0x91,8,'23','24 HOUR']]) {
            cpu.m[s.TODHoursBCD]=hour; cpu.m[s.TODMinBCD]=0x34; cpu.m[s.TODSecBCD]=0x56;
            cpu.m[s.smc24HourClockDisp+1]=format;
            cpu.m[s.IO1Port+s.rwRegPwrUpDefaults]=format;
            glyphs.length=0;
            cpu.call(s.ClockDraw);
            assert.equal(line(39,36,48),`${expected}:34:56`,`${hour.toString(16)} in ${format?24:12}-hour display`);
            assert.equal(line(53,42,60),caption,'AM/PM text is legible and follows the hour mode');
            assert.equal(line(156,72,12),expected,'the adjustment readout uses the same hour format');
        }
        for (const [offset, expected] of [[-24,'-12:00'],[-14,'-07:00'],[-1,'-00:30'],[0,'+00:00'],[11,'+05:30'],[28,'+14:00']]) {
            cpu.m[s.IO1Port+s.rwRegTimezone]=offset&255;
            glyphs.length=0; cpu.call(s.ClockDraw);
            assert.equal(line(127,146,48),expected,'signed half-hour timezone is rendered accurately');
        }
    });
}));
