'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const defaultMenuDir = path.resolve(__dirname, '..');
const probe = fs.readFileSync(path.join(__dirname, 'geos-color-publication.test.js'), 'utf8');
const first = probe.indexOf('class Cpu6502 {');
const last = probe.indexOf("test('assembled renderer", first);
const Cpu6502 = vm.runInNewContext(probe.slice(first, last) + '\nCpu6502;', { assert });
const preview = fs.readFileSync(path.join(defaultMenuDir, 'preview-desktop.ps1'), 'utf8');
const acme = process.env.ACME_EXE || preview.match(/\$AcmePath\s*=\s*'([^']+)'/)[1];

async function desktopMachine(t, callback, options = {}) {
    const menuDir = options.menuDir || defaultMenuDir;
    assert.ok(fs.existsSync(acme), 'ACME required; set ACME_EXE');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'teensyrom-dialog-'));
    try {
        const binary = path.join(temporary, 'desktop.bin'), labels = path.join(temporary, 'symbols');
        const built = spawnSync(acme, ['--format', 'plain', '--symbollist', labels,
            '--outfile', binary, 'source/DesktopShellCode.asm'],
        { cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true });
        assert.ifError(built.error);
        assert.equal(built.status, 0, built.stdout + built.stderr);
        const parseSymbols = file => Object.fromEntries([...fs.readFileSync(file, 'utf8').matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)]
            .map(match => [match[1], parseInt(match[2], 16)]));
        const s = parseSymbols(labels);
        const desktop = fs.readFileSync(binary);
        assert.ok(desktop.length <= 22528, `desktop uses ${desktop.length}/22528 bytes`);
        t.diagnostic(`desktop uses ${desktop.length}/22528 bytes`);
        const settingsSource = path.join(temporary, 'settings.asm');
        const settingsBinary = path.join(temporary, 'settings.bin');
        const settingsLabels = path.join(temporary, 'settings-symbols');
        fs.writeFileSync(settingsSource, fs.readFileSync(path.join(menuDir, 'source/GeosSettings.asm'), 'utf8')
            .replace('"build/DesktopSymbols"', JSON.stringify(labels.replaceAll('\\', '/'))));
        const settingsBuilt = spawnSync(acme, ['--format', 'plain', '--symbollist', settingsLabels,
            '--outfile', settingsBinary, settingsSource],
        { cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true });
        assert.ifError(settingsBuilt.error);
        assert.equal(settingsBuilt.status, 0, settingsBuilt.stdout + settingsBuilt.stderr);
        const settings = fs.readFileSync(settingsBinary);
        Object.assign(s, parseSymbols(settingsLabels));
        assert.ok(settings.length <= 4096, `settings use ${settings.length}/4096 bytes`);
        let apps = Buffer.alloc(0);
        if (options.apps !== false) {
            const appsSource = path.join(temporary, 'apps.asm'), appsBinary = path.join(temporary, 'apps.bin');
            fs.writeFileSync(appsSource, fs.readFileSync(path.join(menuDir, 'source/GeosApps.asm'), 'utf8')
                .replace(/"build\/(?:vice-preview\/)?DesktopSymbols"/g, JSON.stringify(labels.replaceAll('\\', '/'))));
            // A released desktop contains the streamed-app ABI/helpers only;
            // the VICE preview embeds all utilities and cannot match its bytes.
            const appBuilt = spawnSync(acme, ['--format', 'plain',
                ...(!options.releasedHex ? ['-DPreviewApps=1'] : []), '--outfile', appsBinary, appsSource],
                { cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true });
            assert.ifError(appBuilt.error);
            assert.equal(appBuilt.status, 0, appBuilt.stdout + appBuilt.stderr);
            apps = fs.readFileSync(appsBinary);
            assert.ok(apps.length <= 4096, `apps use ${apps.length}/4096 bytes`);
        }
        let releasedProgram;
        if (options.releasedHex) {
            assert.ok(apps.length, 'released replay must include the resident app publisher');
            const { pathToFileURL } = require('node:url');
            const { decodeHeader, decodeHex, sha256 } = await import(pathToFileURL(path.resolve(defaultMenuDir,
                '../../../scripts/prepare-teensyrom-custom-gui.mjs')));
            const header = decodeHeader(fs.readFileSync(path.resolve(menuDir,
                '../../Teensy/TRMenuFiles/ROMs/DesktopShell.prg.h'), 'utf8'));
            const hexBytes = fs.readFileSync(options.releasedHex);
            if (options.releasedSha256) assert.equal(sha256(hexBytes), options.releasedSha256, 'released HEX matches its manifest');
            const segments = decodeHex(hexBytes.toString('utf8'));
            const matches = segments.flatMap(segment => {
                const offset = segment.bytes.indexOf(header);
                return offset < 0 ? [] : [{ address: segment.address + offset, bytes: segment.bytes.subarray(offset, offset + header.length) }];
            });
            assert.equal(matches.length, 1, 'exact complete desktop PRG occurs once in released HEX');
            releasedProgram = matches[0].bytes;
            assert.notEqual(releasedProgram.indexOf(desktop), -1, 'released program contains exactly assembled desktop');
            assert.notEqual(releasedProgram.indexOf(apps), -1, 'released program contains exactly assembled apps');
            assert.notEqual(releasedProgram.indexOf(settings), -1, 'released program contains exactly assembled settings');
            t.diagnostic(`released desktop ${sha256(releasedProgram)} at 0x${matches[0].address.toString(16)}`);
            t.diagnostic(`released HEX ${sha256(hexBytes)}`);
        }
        const fresh = () => {
            const memory = Buffer.alloc(65536);
            const cpu = new Cpu6502(memory);
            if (releasedProgram) {
                releasedProgram.subarray(2).copy(memory, releasedProgram.readUInt16LE(0));
                cpu.pc = 0x080d;
                for (let steps = 0; cpu.pc !== s.MainCodeRAMStart; steps++) {
                    assert.ok(steps < 1000000, 'released overlapping relocation completes');
                    cpu.step();
                }
                assert.deepEqual(memory.subarray(s.MainCodeRAMStart, s.MainCodeRAMStart + desktop.length), desktop);
                assert.deepEqual(memory.subarray(0xc000, 0xc000 + apps.length), apps);
                assert.deepEqual(memory.subarray(s.GeosSettingsBase, s.GeosSettingsBase + settings.length), settings);
            } else {
                desktop.copy(memory, s.MainCodeRAMStart);
                apps.copy(memory, 0xc000);
                settings.copy(memory, s.GeosSettingsBase);
            }
            memory[1] = 0x37;
            memory[0xcb] = 64;
            memory[s.GeosBitmapActive] = memory[s.GeosViewMode] = 1;
            memory[s.Joystick2Sample] = 255;
            memory[s.TODTenthSecBCD] = 3;
            stub(cpu, 'Mouse1351HideForRedraw');
            if (!options.livePointer) stub(cpu, 'Mouse1351ShowPointer');
            stub(cpu, 'GetIn', current => { current.a = current.nz(0); });
            return cpu;
        };
        function stub(cpu, label, callback = () => {}) {
            assert.ok(Number.isInteger(s[label]), `symbol ${label}`);
            cpu.m[s[label]] = 0x60;
            cpu.hooks.set(s[label], callback);
        }
        const textAt = (cpu, address) => {
            let value = '';
            while (cpu.m[address]) value += String.fromCharCode(cpu.m[address++]);
            return value;
        };
        const pixel = (cpu, x, y) => Number(!!(cpu.m[s.GeosBitmapRAM + (y >> 3) * 320 + (x >> 3) * 8 + (y & 7)] & (128 >> (x & 7))));
        const region = (cpu, x, y, width, height) => Buffer.from(Array.from({ length: width * height },
            (_, i) => pixel(cpu, x + i % width, y + Math.floor(i / width))));
        const local = (cpu, text, label = 'GeosBitmapWaitLocalMessage') => {
            const address = 0x18f0;
            Buffer.from(text + '\0', 'latin1').copy(cpu.m, address);
            cpu.a = address & 255; cpu.y = address >> 8;
            cpu.call(s[label]);
        };
        const capture = (cpu, name) => {
            if (process.env.UI_PROOF !== '1') return;
            assert.match(name, /^[a-z0-9-]+$/);
            const output = path.resolve(menuDir, '../../../build/ui-proof');
            fs.mkdirSync(output, { recursive: true });
            const palette = [0x000000,0xffffff,0x813338,0x75cec8,0x8e3c97,0x56ac4d,0x2e2c9b,0xedf171,
                0x8e5029,0x553800,0xc46c71,0x4a4a4a,0x7b7b7b,0xa9ff9f,0x706deb,0xb2b2b2];
            const width = 272, height = 116, rgb = Buffer.alloc(width * height * 3);
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                const sx = x + 24, sy = y + 42;
                const cell = cpu.m[s.C64ScreenRAM + (sy >> 3) * 40 + (sx >> 3)];
                const color = palette[pixel(cpu, sx, sy) ? cell >> 4 : cell & 15], at = (y * width + x) * 3;
                rgb[at] = color >> 16; rgb[at + 1] = color >> 8; rgb[at + 2] = color;
            }
            fs.writeFileSync(path.join(output, name + '.ppm'), Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), rgb]));
        };
        await callback({ s, fresh, stub, textAt, pixel, region, local, capture, acme, menuDir });
    } finally {
        assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}
module.exports = { desktopMachine };
