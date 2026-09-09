'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {backendPETSCII} = require('./backend-petscii');

const menuDir = path.resolve(__dirname, '..');
const probe = fs.readFileSync(path.join(__dirname, 'geos-color-publication.test.js'), 'utf8');
const first = probe.indexOf('class Cpu6502 {');
const last = probe.indexOf("test('assembled renderer", first);
const Cpu6502 = vm.runInNewContext(probe.slice(first, last) + '\nCpu6502;', {assert});
const preview = fs.readFileSync(path.join(menuDir, 'preview-desktop.ps1'), 'utf8');
const acme = process.env.ACME_EXE || preview.match(/\$AcmePath\s*=\s*'([^']+)'/)[1];

test('assembled settings icons and Music panel share pixel targets and modal input', async t => {
  if (!fs.existsSync(acme)) return t.skip('ACME unavailable; set ACME_EXE');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-control-'));
  try {
    const binary = path.join(temporary, 'desktop.bin');
    const symbols = path.join(temporary, 'symbols');
    const build = spawnSync(acme, ['--format', 'plain', '--symbollist', symbols, '--outfile', binary,
      'source/DesktopShellCode.asm'], {cwd: menuDir, encoding: 'utf8', windowsHide: true});
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const parseSymbols = file => Object.fromEntries([...fs.readFileSync(file, 'utf8')
      .matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)].map(m => [m[1], parseInt(m[2], 16)]));
    const s = parseSymbols(symbols);
    const program = fs.readFileSync(binary);
    const settingsSource = path.join(temporary, 'settings.asm');
    const settingsBinary = path.join(temporary, 'settings.bin');
    const settingsSymbols = path.join(temporary, 'settings-symbols');
    fs.writeFileSync(settingsSource, fs.readFileSync(path.join(menuDir, 'source/GeosSettings.asm'), 'utf8')
      .replace('"build/DesktopSymbols"', JSON.stringify(symbols.replaceAll('\\', '/'))));
    const settingsBuild = spawnSync(acme, ['--format', 'plain', '--symbollist', settingsSymbols,
      '--outfile', settingsBinary, settingsSource], {cwd: menuDir, encoding: 'utf8', windowsHide: true});
    assert.equal(settingsBuild.status, 0, settingsBuild.stdout + settingsBuild.stderr);
    Object.assign(s, parseSymbols(settingsSymbols));
    const settings = fs.readFileSync(settingsBinary);
    const appSource = fs.readFileSync(path.join(menuDir, 'source/GeosApps.asm'), 'utf8')
      .replace(/!ifdef PreviewApps \{[\s\S]*?\}\s*else\s*\{[\s\S]*?\}/,
        `!src "${symbols.replaceAll('\\', '/')}"`);
    const appHarness = path.join(temporary, 'apps.asm');
    const appBinary = path.join(temporary, 'apps.bin');
    fs.writeFileSync(appHarness, appSource);
    const appBuild = spawnSync(acme, ['--format', 'plain', '-DPreviewApps=1', '--outfile', appBinary, appHarness],
      {cwd: menuDir, encoding: 'utf8', windowsHide: true});
    assert.equal(appBuild.status, 0, appBuild.stdout + appBuild.stderr);
    const apps = fs.readFileSync(appBinary);
    const fresh = (mode = 0) => {
      const memory = Buffer.alloc(65536);
      program.copy(memory, s.MainCodeRAMStart);
      apps.copy(memory, 0xc000);
      settings.copy(memory, s.GeosSettingsBase);
      memory[1] = 0x37;
      memory[s.GeosControlMode] = mode;
      memory[s.GeosViewMode] = 1;
      memory[s.GeosOverlayMode] = s.GeosOverlayControl;
      memory[s.GeosBitmapActive] = 1;
      return new Cpu6502(memory);
    };
    const stub = (cpu, name, hook = () => {}) => {
      cpu.m[s[name]] = 0x60;
      cpu.hooks.set(s[name], hook);
    };
    const point = (cpu, x, y) => {
      cpu.m[s.MouseFrameX] = Math.floor(x / 2);
      cpu.m[s.MouseFrameY] = y;
      cpu.x = Math.floor(x / 8);
      cpu.y = Math.floor(y / 8);
    };
    const textAt = (cpu, address) => {
      let text = '';
      for (; cpu.m[address]; address++) text += String.fromCharCode(cpu.m[address] & 127);
      return text;
    };
    const pixel = (cpu, x, y) => Number(!!(cpu.m[s.GeosBitmapRAM + (y >> 3) * 320 + (x >> 3) * 8 + (y & 7)] & (128 >> (x & 7))));
    const region = (cpu, x, y, width, height) => Buffer.from(Array.from({length: width * height},
      (_, i) => pixel(cpu, x + i % width, y + Math.floor(i / width))));
    const drawControl = cpu => {
      cpu.call(s.GeosRichBegin);
      cpu.call(s.GeosControlDraw);
      cpu.call(s.GeosRichPublish);
      cpu.call(s.GeosBitmapPublishColors);
      cpu.call(s.GeosDialogRestoreBank);
    };

    await t.test('drawn icon coordinates, label plates and X match both panel hit tests', () => {
      for (const mode of [0, 9]) {
        const cpu = fresh(mode);
        const icons = [];
        const labels = [];
        cpu.hooks.set(s.RichBlit, () => {
          if (cpu.m[s.RichBytes] === 3 && cpu.m[s.RichH] === 16) {
            icons.push([cpu.m[s.RichX], cpu.m[s.RichY]]);
          }
        });
        cpu.hooks.set(s.RichText, () => {
          const text = textAt(cpu, cpu.a | cpu.y << 8);
          const x = cpu.m[s.RichX] | cpu.m[s.RichXHi] << 8;
          const y = cpu.m[s.RichY];
          assert.ok(x >= 40 && x + text.length * 6 <= 280, `${text} fits panel width`);
          assert.ok(y >= 16 && y + 7 <= 184, `${text} fits panel height`);
          labels.push(text);
        });
        cpu.call(s.GeosControlDraw);
        const expected = mode ? [[64, 40], [144, 40], [224, 40], [104, 84], [184, 84]]
          : [[64, 40], [144, 40], [224, 40], [64, 84], [144, 84], [224, 84], [64, 128], [144, 128], [224, 128]];
        assert.deepEqual(icons, expected);
        assert.ok(labels.includes(mode ? 'USE DEFAULT' : 'APPEARANCE'));
        for (let item = 0; item < icons.length; item++) {
          const [x, y] = icons[item];
          for (const [px, py] of [[x, y], [x + 22, y + 15], [x - 24, y + 19], [x + 46, y + 27]]) {
            point(cpu, px, py);
            cpu.call(s.GeosControlHitTest);
            assert.equal(cpu.p & 1, 1, `mode${mode}, item${item}, ${px},${py}`);
            assert.equal(cpu.a, item);
          }
        }
        for (const [x, y] of [[266, 18], [276, 28]]) {
          point(cpu, x, y);
          cpu.call(s.GeosControlHitTest);
          assert.equal(cpu.p & 1, 1);
          assert.equal(cpu.a, 255, 'visible X is the close target');
        }
        for (const [x, y] of [[264, 18], [278, 18], [266, 29], [38, 60], [114, 60], [160, 180]]) {
          point(cpu, x, y);
          cpu.call(s.GeosControlHitTest);
          assert.equal(cpu.p & 1, 0, `empty pixel${x},${y} does not select or close`);
        }
      }
    });

    await t.test('arrows follow the visible settings grid and music rows through the real key router', () => {
      const moves = {
        0: {Up: [6,7,8,0,1,2,3,4,5], Down: [3,4,5,6,7,8,0,1,2], Left: [2,0,1,5,3,4,8,6,7], Right: [1,2,0,4,5,3,7,8,6]},
        9: {Up: [3,4,2,0,1], Down: [3,4,2,0,1], Left: [2,0,1,4,3], Right: [1,2,0,4,3]},
      };
      for (const mode of [0, 9]) for (const [direction, targets] of Object.entries(moves[mode])) {
        for (let from = 0; from < targets.length; from++) {
          const cpu = fresh(mode);
          cpu.m[s.GeosControlSelection] = from;
          cpu.m[s.MouseOpenArmed] = 1;
          let redraws = 0;
          stub(cpu, 'GeosShellRedraw', () => { redraws++; });
          cpu.a = s[{Up: 'ChrCRSRUp', Down: 'ChrCRSRDn', Left: 'ChrCRSRLeft', Right: 'ChrCRSRRight'}[direction]];
          cpu.call(s.GeosShellHandleKey);
          assert.equal(cpu.p & 1, 1);
          assert.equal(cpu.m[s.GeosControlSelection], targets[from], `${mode} ${direction} from${from}`);
          assert.equal(cpu.m[s.MouseOpenArmed], 0, 'keyboard movement clears stale double-click arming');
          assert.equal(redraws, 0, 'selection does not reload or redraw the full desktop');
          assert.equal(cpu.m[1], 0x37);
        }
      }
    });

    await t.test('single click selects, unchanged focus draws nothing, and double click opens the right settings page', () => {
      const cpu = fresh();
      let publishes = 0;
      let redraws = 0;
      cpu.hooks.set(s.GeosControlPublish, () => { publishes++; });
      stub(cpu, 'GeosShellRedraw', () => { redraws++; });
      point(cpu, 68, 42);
      cpu.call(s.GeosShellMouseClick);
      assert.equal(cpu.p & 1, 0);
      assert.equal(publishes, 0, 'already selected category only arms the click');
      point(cpu, 228, 86);
      cpu.call(s.GeosShellMouseClick);
      assert.equal(cpu.p & 1, 0);
      assert.equal(cpu.m[s.GeosControlSelection], 5);
      assert.equal(publishes, 2, 'changed selection publishes only the old and new label regions');
      point(cpu, 228, 86);
      cpu.call(s.GeosShellMouseClick);
      assert.equal(cpu.p & 1, 1);
      assert.equal(cpu.a, s.ChrReturn);
      assert.equal(publishes, 2);
      let launches = 0;
      stub(cpu, 'DirectRunFromTeensyMenu', () => {
        launches++;
        assert.equal(cpu.a, 1);
        assert.equal(cpu.x, 9);
        assert.equal(cpu.m[s.rwRegScratch + s.IO1Port], 0x84);
      });
      cpu.call(s.GeosShellHandleKey);
      assert.equal(launches, 1);
      assert.equal(redraws, 0);
      for (const [item, page] of [3,1,2,1,5,4,6,0].entries()) {
        const current = fresh();
        let nativePage = null;
        let externalPage = null;
        let app = null;
        let nativeRedraws = 0;
        stub(current, 'GeosPanelSettingsOpen', machine => { nativePage = machine.a; });
        stub(current, 'GeosShellRedraw', () => { nativeRedraws++; });
        stub(current, 'GeosShellOpenApp', machine => { app = machine.a; });
        stub(current, 'DirectRunFromTeensyMenu', machine => {
          externalPage = machine.m[s.rwRegScratch + s.IO1Port];
        });
        current.m[s.GeosControlSelection] = item;
        current.a = s.ChrReturn;
        current.call(s.GeosShellHandleKey);
        if ([0, 1, 3].includes(item)) {
          assert.equal(nativePage, item, `category${item} opens native settings page${item}`);
          assert.equal(externalPage, null);
          assert.equal(nativeRedraws, 1, 'returning from native settings rebuilds the category window');
        } else if (item === 4) {
          assert.equal(app, s.rdaClock, 'Clock opens its native GUI utility');
          assert.equal(nativePage, null);
          assert.equal(externalPage, null);
        } else {
          assert.equal(nativePage, null);
          assert.equal(externalPage, 0x80 | page, `category${item} retains settings page${page}`);
          assert.equal(nativeRedraws, 0);
        }
      }
    });

    await t.test('STOP HOME Escape X and Help cannot activate a covered icon', () => {
      for (const mode of [0, 9]) for (const key of ['ChrStop', 'ChrHome', 'escape', 'click', 'ChrF1']) {
        const cpu = fresh(mode);
        let redraws = 0;
        let help = 0;
        stub(cpu, 'GeosShellRedraw', () => { redraws++; });
        stub(cpu, 'TagTRHelp', () => { help++; });
        cpu.m[s.MouseOpenArmed] = 1;
        if (key === 'click') {
          point(cpu, 266, 22);
          cpu.call(s.GeosShellMouseClick);
          assert.equal(cpu.p & 1, 0);
        } else {
          cpu.a = key === 'escape' ? 27 : s[key];
          cpu.call(s.GeosShellHandleKey);
          assert.equal(cpu.p & 1, 1);
        }
        assert.equal(cpu.m[s.GeosOverlayMode], 0);
        assert.equal(help, +(key === 'ChrF1'));
        assert.equal(redraws, +(key !== 'ChrF1'));
        if (key !== 'ChrF1') assert.equal(cpu.m[s.MouseOpenArmed], 0);
      }
    });

    await t.test('Music writes only the requested existing persistent setting and retains advanced controls', () => {
      for (const action of [1, 2, 3, 4]) {
        const cpu = fresh(9);
        cpu.m[s.GeosControlSelection] = action;
        cpu.m[s.MouseOpenArmed] = 1;
        cpu.m[s.rwRegPwrUpDefaults + s.IO1Port] = 0xa7;
        let pause = 0, waits = 0, repaints = 0, advanced = 0, music = 0;
        stub(cpu, 'ToggleSIDMusic', () => { pause++; });
        stub(cpu, 'WaitForTRWaitMsg', () => { waits++; });
        stub(cpu, 'GeosControlRepaint', () => { repaints++; });
        stub(cpu, 'GeosMusicRefreshStartup', () => { repaints++; });
        stub(cpu, 'ShowSIDAdvancedPage', () => { advanced++; });
        stub(cpu, 'GeosMusicOpen', () => { music++; });
        const writes = [];
        cpu.onWrite = (address, value) => { if (address >= s.IO1Port && address < s.IO1Port + 256) writes.push([address, value]); };
        cpu.a = s.ChrReturn;
        cpu.call(s.GeosShellHandleKey);
        assert.equal(cpu.p & 1, 1);
        assert.equal(cpu.m[s.MouseOpenArmed], 0, 'keyboard activation clears an earlier click');
        assert.equal(pause, +(action === 1));
        assert.equal(waits, +(action === 2 || action === 3));
        assert.equal(repaints, +(action !== 4), 'play/pause refreshes its saved startup caption; waits restore the panel');
        assert.equal(advanced, +(action === 4));
        assert.equal(music, +(action === 4));
        const expected = action === 2 ? [[s.wRegControl + s.IO1Port, s.rCtlSetBackgroundSIDWAIT]]
          : action === 3 ? [[s.rwRegPwrUpDefaults + s.IO1Port, 0xa7 ^ s.rpudSIDPauseMask]] : [];
        assert.deepEqual(writes, expected);
      }
      const browse = fresh(9);
      stub(browse, 'GeosShellRedraw');
      browse.m[s.GeosSurfaceMode] = s.GeosSurfaceIEC;
      browse.a = s.ChrReturn;
      browse.call(s.GeosShellHandleKey);
      assert.equal(browse.m[s.GeosSurfaceMode], s.GeosSurfaceBrowser);
      assert.equal(browse.m[s.GeosOverlayMode], 0);
    });

    await t.test('play/pause refreshes only the startup caption and matches a clean panel in both directions', () => {
      for (const state of [0, 1]) {
        const cpu = fresh(9), reference = fresh(9);
        cpu.m[s.GeosControlSelection] = reference.m[s.GeosControlSelection] = 1;
        cpu.m[s.smcSIDPauseStop + 1] = state;
        cpu.m[s.IO1Port + s.rwRegPwrUpDefaults] = 0xa6 | state;
        cpu.m[s.IO1Port + s.rwRegStatus] = s.rsReady;
        reference.m[s.IO1Port + s.rwRegPwrUpDefaults] = 0xa6 | (state ^ 1);
        drawControl(cpu);
        drawControl(reference);
        const before = Buffer.from(cpu.m.subarray(s.GeosBitmapRAM, s.GeosBitmapRAM + 8000));
        cpu.call(s.GeosMusicActivate);
        assert.deepEqual(region(cpu, 40, 16, 240, 168), region(reference, 40, 16, 240, 168), 'caption matches a complete render');
        for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
          if (x >= 58 && x < 166 && y >= 144 && y < 151) continue;
          const offset = (y >> 3) * 320 + (x >> 3) * 8 + (y & 7);
          assert.equal(pixel(cpu, x, y), Number(!!(before[offset] & (128 >> (x & 7)))), 'other pixels stay unchanged');
        }
      }
    });

    await t.test('post-wait repaint restores the complete Music panel to a clean draw', () => {
      const expected = fresh(9), actual = fresh(9);
      for (const cpu of [expected, actual]) {
        cpu.m.fill(0x55, s.GeosBitmapRAM, s.GeosBitmapRAMEnd);
        cpu.m.fill(0xaa, s.GeosRichCanvas, s.GeosRichCanvas + 8000);
        cpu.m.fill(0x61, s.C64ScreenRAM, s.C64ScreenRAM + 1000);
        Buffer.from('Death Is No Evil\0').copy(cpu.m, s.GeosMusicName);
      }
      drawControl(expected);
      drawControl(actual);
      actual.call(s.GeosBitmapWaitBegin);
      actual.call(s.GeosControlRepaint);
      assert.deepEqual(region(actual, 40, 16, 240, 168), region(expected, 40, 16, 240, 168));
      for (let row = 2; row < 23; row++) for (let col = 5; col < 35; col++) {
        assert.equal(actual.m[s.C64ScreenRAM + row * 40 + col], expected.m[s.C64ScreenRAM + row * 40 + col],
          `panel color ${col},${row}`);
      }
    });

    await t.test('SID filename capture is bounded, drains metadata and converts the PETSCII underscore', () => {
      for (const name of ['GAME_FILE.SID', 'A'.repeat(70), '']) {
        const cpu = fresh();
        const bytes = [...backendPETSCII(`\r ${name}\r \r Name: tune\r Auth: artist\r`), 0];
        const step = cpu.step.bind(cpu);
        let offset = 0;
        cpu.step = function() {
          if (this.m[this.pc] === 0xad && (this.m[this.pc + 1] | this.m[this.pc + 2] << 8) === s.rwRegSerialString + s.IO1Port) {
            assert.ok(offset < bytes.length, 'serial input never overreads');
            this.m[s.rwRegSerialString + s.IO1Port] = bytes[offset++];
          }
          step();
        };
        cpu.m[s.GeosMusicName + 39] = 0xa5;
        cpu.call(s.GeosMusicReadName);
        assert.equal(textAt(cpu, s.GeosMusicName), name.slice(0, 38));
        assert.equal(offset, bytes.length, 'remaining author/metadata fully drained');
        assert.equal(cpu.m[s.GeosMusicName + 39], 0xa5);
      }
    });
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});
