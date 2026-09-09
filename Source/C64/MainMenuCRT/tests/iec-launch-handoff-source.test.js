'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');

const sourceRoot = path.resolve(__dirname, '../../..');
const source = name => fs.readFileSync(path.join(sourceRoot, name), 'utf8');
const regs = source('Teensy/MinimalBoot/Common/Menu_Regs.h');
const regsI = source('C64/MainMenuCRT/source/Menu_Regs.i');
const handler = source('Teensy/MinimalBoot/Common/IO_Handlers/IOH_TeensyROM.c');
const status = source('Teensy/MinimalBoot/Common/IO_Handlers/StatusFunctions.c');
const handlers = source('Teensy/IOHandlers.ino');

test('IEC launch has the same unused command opcode in both register maps', () => {
  for (const map of [regs, regsI]) {
    assert.match(map, /rCtlRunningIEC\s*=\s*56\b/);
    const commands = [...map.matchAll(/\b(rCtl\w+)\s*=\s*(0x[\da-f]+|\d+)\b/gi)];
    assert.deepEqual(commands.filter(entry => Number(entry[2]) === 56).map(entry => entry[1]), ['rCtlRunningIEC']);
    assert.match(map, /rsIOHWNextInit\s*=\s*0x14\b/);
  }
});

test('IEC launch arms the existing synchronous swap handshake without a selected menu item', () => {
  const command = handler.match(/case rCtlRunningIEC:([\s\S]*?)\bbreak;/)?.[1];
  assert.ok(command, 'IEC launch command must be handled');
  assert.match(command, /IO1\[rwRegStatus\]\s*=\s*rsIOHWNextInit;/);
  assert.match(command, /HandshakeReady\s*=\s*false;\s*PendingfBusSnoop\s*=\s*NULL;\s*fBusSnoop\s*=\s*&HandshakeSnoop;/);
  assert.doesNotMatch(command, /MenuSource|SelItemFullIdx|rsIOHWSelInit|IOH_None|rwRegNextIOHndlr\]\s*=/);
  assert.match(handler, /if \(!HandshakeReady\)[\s\S]*?DataPortWriteWait\(rihsBusy\);[\s\S]*?DataPortWriteWait\(rihsReady\);\s*fBusSnoop = PendingfBusSnoop;/);
});

test('IEC status uses the configured default handler and retains its staged bus snoop', () => {
  const table = status.match(/void \(\*StatusFunction\[rsNumStatusTypes\]\)\(\)\s*=[\s\S]*?\{([\s\S]*?)\};/)?.[1];
  assert.ok(table, 'status dispatch table must exist');
  assert.equal([...table.matchAll(/&(\w+)/g)][0x14]?.[1], 'IOHandlerNextInit');
  const nextInit = handlers.match(/void IOHandlerNextInit\(\)\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(nextInit, 'default handler initializer must exist');
  assert.match(nextInit, /IOHandlerInit\(IO1\[rwRegNextIOHndlr\]\);/);
  assert.doesNotMatch(nextInit, /MenuSource|SelItemFullIdx|IOH_None/);
  assert.match(handlers, /if \(IOHandler\[NewIOHandler\]->InitHndlr != NULL\) IOHandler\[NewIOHandler\]->InitHndlr\(\);/);
  assert.match(handlers, /CurrentIOHandler = NewIOHandler;[\s\S]*?if \(fBusSnoop == &HandshakeSnoop\) HandshakeReady = true;\s*else fBusSnoop = PendingfBusSnoop;/);
});

test('assembled disk boot reuses the guarded IEC preflight and relocated loader', async t => {
  const menuDir = path.resolve(__dirname, '..');
  const preview = fs.readFileSync(path.join(menuDir, 'preview-desktop.ps1'), 'utf8');
  const acme = process.env.ACME_EXE || preview.match(/\$AcmePath\s*=\s*'([^']+)'/)[1];
  if (!fs.existsSync(acme)) return t.skip('ACME unavailable; set ACME_EXE');
  const probe = fs.readFileSync(path.join(__dirname, 'geos-color-publication.test.js'), 'utf8');
  const first = probe.indexOf('class Cpu6502 {');
  const last = probe.indexOf("test('assembled renderer", first);
  const Cpu6502 = vm.runInNewContext(probe.slice(first, last) + '\nCpu6502;', {assert});
  class LaunchCpu extends Cpu6502 {
    step() {
      if (this.m[this.pc] === 0x9a) { this.pc++; this.sp = this.x; return; } // TXS
      if (this.m[this.pc] === 0x6c) { // NMOS 6502 JMP (indirect)
        this.pc++;
        const pointer = this.word();
        this.pc = this.m[pointer] | (this.m[(pointer & 0xff00) | ((pointer + 1) & 255)] << 8);
        return;
      }
      super.step();
    }
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-iec-boot-'));
  try {
    const binary = path.join(temporary, 'desktop.bin');
    const symbols = path.join(temporary, 'symbols');
    const build = spawnSync(acme, ['--format', 'plain', '--symbollist', symbols, '--outfile', binary,
      'source/DesktopShellCode.asm'], {cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true});
    assert.ifError(build.error);
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const s = Object.fromEntries([...fs.readFileSync(symbols, 'utf8')
      .matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)].map(m => [m[1], parseInt(m[2], 16)]));
    const program = fs.readFileSync(binary);
    const loaderSize = s.GeosIECLaunchImageEnd - s.GeosIECLaunchImage;
    t.diagnostic(`Tape loader ${loaderSize}/192 bytes; desktop has ${0xa000 - s.MainCodeRAMEnd} bytes below BASIC`);
    assert.ok(loaderSize <= 192);
    const fresh = () => {
      const memory = Buffer.alloc(65536);
      program.copy(memory, s.MainCodeRAMStart);
      return new LaunchCpu(memory);
    };
    const stub = (cpu, name, hook = () => {}) => {
      const address = typeof name === 'number' ? name : s[name];
      assert.ok(Number.isInteger(address), `known stub ${name}`);
      cpu.m[address] = 0x60;
      cpu.hooks.set(address, hook);
    };
    const readName = cpu => cpu.m.subarray(cpu.x | (cpu.y << 8), (cpu.x | (cpu.y << 8)) + cpu.a).toString('ascii');

    await t.test('wildcard preflight preserves device and current surface, and rejects failed or unsafe reads', () => {
      for (const device of [8, 9, 2]) for (const fault of ['none', 'open', 'short', 'header-only', 'low-address']) {
        const cpu = fresh();
        const names = [], lfs = [];
        let prepared = 0, notices = 0, opens = 0, offset = 0;
        const bytes = fault === 'short' ? [1] : fault === 'header-only' ? [1, 8] :
          fault === 'low-address' ? [0x3c, 3, 0] : [1, 8, 0];
        cpu.m[s.GeosSurfaceMode] = 0; // Home, with an unrelated old IEC listing.
        cpu.m[s.GeosIECCount] = 16;
        cpu.m.fill(0x6d, s.GeosIECEntries, s.GeosIECEntries + 320);
        cpu.m[s.MouseOpenArmed] = 1;
        cpu.m[s.smcSIDPauseStop + 1] = 7;
        cpu.m[0x9d] = 0x80;
        stub(cpu, 'GeosIECKernalSETNAM', c => names.push(readName(c)));
        stub(cpu, 'GeosIECKernalSETLFS', c => lfs.push([c.a, c.x, c.y]));
        stub(cpu, 'GeosIECKernalOPEN', c => { opens++; c.flag(1, fault === 'open'); });
        stub(cpu, 'GeosIECKernalREADST', c => { c.a = c.nz(0); });
        stub(cpu, 'GeosIECKernalCHKIN', c => c.flag(1, false));
        stub(cpu, 'GeosIECKernalCLRCHN');
        stub(cpu, 'GeosIECKernalCLOSE');
        stub(cpu, 'GeosIECGetByte', c => {
          c.flag(1, offset >= bytes.length);
          if (offset < bytes.length) c.a = c.nz(bytes[offset++]);
          c.m[s.GeosIECEOF] = +(offset >= bytes.length);
        });
        stub(cpu, 'GeosIECLaunchPrepare', () => { prepared++; });
        stub(cpu, 'GeosBitmapShowMessage', () => { notices++; });
        cpu.a = device;
        cpu.call(s.GeosIECBootDisk);
        const succeeds = device !== 2 && fault === 'none';
        assert.equal(prepared, +succeeds, `${device}/${fault}`);
        assert.equal(notices, +!succeeds, `${device}/${fault}`);
        assert.equal(cpu.m[s.GeosIECDevice], device);
        assert.equal(cpu.m[s.GeosSurfaceMode], 0, 'failure never exposes stale IEC records');
        assert.equal(cpu.m[s.GeosIECCount], 16);
        assert.ok(cpu.m.subarray(s.GeosIECEntries, s.GeosIECEntries + 320).every(value => value === 0x6d));
        assert.equal(cpu.m[s.smcSIDPauseStop + 1], 7);
        assert.equal(cpu.m[0x9d], 0x80);
        if (device === 2) assert.equal(opens, 0, 'unsupported device is rejected before OPEN');
        else { assert.deepEqual(names, ['*']); assert.deepEqual(lfs, [[2, device, 2]]); }
        if (!succeeds) {
          assert.equal(cpu.m[s.GeosOverlayMode], s.GeosOverlayNotice);
          assert.equal(cpu.m[s.MouseOpenArmed], 0);
        }
      }
    });

    await t.test('boot selection enters a folder or image once and never launches the highlighted PRG', () => {
      for (const [name, directory] of [['GAMES', 1], ['GEOS.D64', 0], ['GEOS.D71', 0], ['GEOS.D81', 0], ['OTHER.PRG', 0]]) {
        for (const failedCD of [false, true]) {
          const cpu = fresh();
          let enters = 0, boots = 0;
          cpu.m[s.GeosIECCount] = 16;
          cpu.m[s.GeosIECSelection] = 15;
          cpu.m[s.GeosIECDevice] = 9;
          Buffer.from(name).copy(cpu.m, s.GeosIECEntries + 15 * 20);
          cpu.m[s.GeosIECEntries + 15 * 20 + 19] = directory;
          stub(cpu, 'GeosIECEnterDirectory', c => { enters++; c.m[s.GeosIECError] = +failedCD; });
          stub(cpu, 'GeosIECBootDisk', c => { boots++; assert.equal(c.a, 9); });
          stub(cpu, 'GeosIECLaunchPRG', () => assert.fail('Boot Disk must not activate the selected PRG'));
          cpu.call(s.GeosIECBootSelection);
          const enterable = directory || name.endsWith('D64') || name.endsWith('D71') || name.endsWith('D81');
          assert.equal(enters, +!!enterable, name);
          assert.equal(boots, +(enterable ? !failedCD : true), name);
        }
      }
      for (const [count, selection] of [[0, 0], [16, 16], [16, 255]]) {
        const cpu = fresh();
        let boots = 0;
        cpu.m[s.GeosIECCount] = count;
        cpu.m[s.GeosIECSelection] = selection;
        cpu.m[s.GeosIECDevice] = 8;
        stub(cpu, 'GeosIECGetEntry', () => assert.fail('invalid selection must not read a record'));
        stub(cpu, 'GeosIECBootDisk', c => { boots++; assert.equal(c.a, 8); });
        cpu.call(s.GeosIECBootSelection);
        assert.equal(boots, 1, 'empty/current disk still permits a wildcard boot attempt');
      }
    });

    await t.test('File Boot Disk and Shift RUNSTOP route home drives and IEC selections without stale source fallback', () => {
      const contexts = [
        {surface: s.GeosSurfaceHome, selected: 3, device: 8},
        {surface: s.GeosSurfaceHome, selected: 4, device: 9},
        ...[0, 1, 2, 5, 6, 7].map(selected => ({surface: s.GeosSurfaceHome, selected})),
        ...[s.rmtTeensy, s.rmtSD, s.rmtUSBDrive].map(source => ({surface: s.GeosSurfaceBrowser, source})),
        ...[8, 9].map(device => ({surface: s.GeosSurfaceIEC, device, selection: true})),
      ];
      for (const route of ['direct', 'file-menu', 'shift-runstop']) for (const context of contexts) {
        const cpu = fresh();
        const boots = [], notices = [];
        cpu.m[s.GeosViewMode] = 1;
        cpu.m[s.GeosSurfaceMode] = context.surface;
        cpu.m[s.GeosHomeSelection] = context.selected || 0;
        cpu.m[s.GeosIECDevice] = context.device || 9; // Unsupported surfaces must not reuse this device.
        cpu.m[s.GeosIECSelection] = 15;
        cpu.m[s.GeosIECCount] = 16;
        cpu.m[s.IO1Port + s.rWRegCurrMenuWAIT] = context.source || 0;
        cpu.m[s.MouseOpenArmed] = 1;
        stub(cpu, 'GeosIECBootDisk', c => boots.push(['drive', c.a]));
        stub(cpu, 'GeosIECBootSelection', c => boots.push(['selection', c.m[s.GeosIECDevice], c.m[s.GeosIECSelection]]));
        stub(cpu, 'GeosBitmapShowMessage', c => notices.push(c.a | (c.y << 8)));
        if (route === 'file-menu') {
          cpu.m[s.GeosOverlayMode] = s.GeosOverlayMenu;
          cpu.m[s.GeosActiveMenu] = s.GeosMenuFile;
          cpu.m[s.GeosMenuSelection] = 5;
          cpu.call(s.GeosShellMenuActivate);
        } else if (route === 'shift-runstop') {
          cpu.a = s.ChrRun;
          cpu.call(s.GeosShellHandleKey);
          assert.equal(cpu.p & 1, 1, 'the shortcut is consumed before legacy actions');
        } else cpu.call(s.GeosFileBootDisk);
        const expected = context.selection ? [['selection', context.device, 15]] : context.device ? [['drive', context.device]] : [];
        assert.deepEqual(boots, expected, `${route}/${JSON.stringify(context)}`);
        assert.equal(cpu.m[s.MouseOpenArmed], 0);
        assert.deepEqual(notices, context.device ? [] : [s.MsgBootNeedsDrive]);
        assert.equal(cpu.m[s.GeosOverlayMode], context.device ? s.GeosOverlayNone : s.GeosOverlayNotice);
        assert.equal(cpu.m[s.GeosSurfaceMode], context.surface);
      }
    });

    await t.test('plain STOP remains back or close and shifted STOP cannot boot through a modal', () => {
      for (const surface of [s.GeosSurfaceHome, s.GeosSurfaceBrowser, s.GeosSurfaceIEC]) {
        const cpu = fresh();
        let redraws = 0, menuRedraws = 0;
        cpu.m[s.GeosViewMode] = 1;
        cpu.m[s.GeosSurfaceMode] = surface;
        stub(cpu, 'GeosIECBootDisk', () => assert.fail('STOP is not disk boot'));
        stub(cpu, 'GeosIECBootSelection', () => assert.fail('STOP is not selection boot'));
        stub(cpu, 'GeosShellRedraw', () => { redraws++; });
        stub(cpu, 'GeosMenuRedraw', () => { menuRedraws++; });
        cpu.a = s.ChrStop;
        cpu.call(s.GeosShellHandleKey);
        assert.equal(cpu.p & 1, 1);
        assert.equal(cpu.m[s.GeosSurfaceMode], s.GeosSurfaceHome);
        assert.equal(cpu.m[s.GeosOverlayMode], surface === s.GeosSurfaceHome ? s.GeosOverlayMenu : s.GeosOverlayNone);
        assert.equal(redraws, surface === s.GeosSurfaceHome ? 0 : 1);
        assert.equal(menuRedraws, surface === s.GeosSurfaceHome ? 1 : 0);
      }
      for (const overlay of [s.GeosOverlayMenu, s.GeosOverlayAbout, s.GeosOverlayNotice]) {
        for (const key of [s.ChrStop, s.ChrRun]) {
          const cpu = fresh();
          cpu.m[s.GeosViewMode] = 1;
          cpu.m[s.GeosSurfaceMode] = s.GeosSurfaceIEC;
          cpu.m[s.GeosOverlayMode] = overlay;
          stub(cpu, 'GeosIECBootDisk', () => assert.fail('dismissal must not boot'));
          stub(cpu, 'GeosIECBootSelection', () => assert.fail('dismissal must not activate a hidden disk'));
          stub(cpu, 'GeosShellRedraw');
          stub(cpu, 'GeosMenuRedraw');
          cpu.a = key;
          cpu.call(s.GeosShellHandleKey);
          assert.equal(cpu.p & 1, 1);
          assert.equal(cpu.m[s.GeosOverlayMode], s.GeosOverlayNone);
          assert.equal(cpu.m[s.GeosSurfaceMode], s.GeosSurfaceIEC);
        }
      }
      const classic = fresh();
      classic.m[s.GeosViewMode] = 0;
      stub(classic, 'GeosFileBootDisk', () => assert.fail('classic view keeps its own key handling'));
      classic.a = s.ChrRun;
      classic.call(s.GeosShellHandleKey);
      assert.equal(classic.p & 1, 0);
    });

    await t.test('main keyboard routing reaches Help on F1 and Teensy on F7 from both browser types', () => {
      for (const surface of [s.GeosSurfaceBrowser, s.GeosSurfaceIEC]) for (const key of [s.ChrF1, s.ChrF7]) {
        const cpu = fresh();
        const sources = [];
        cpu.m[s.GeosViewMode] = 1;
        cpu.m[s.GeosSurfaceMode] = surface;
        stub(cpu, 'ListMenuItemsChangeInit', c => sources.push(c.a));
        cpu.a = key;
        cpu.pc = s.ReadKeyboardReady;
        const targets = new Set([s.DirectRunFromTeensyMenu, s.HighlightCurrent, s.WaitForJSorKey]);
        for (let steps = 0; !targets.has(cpu.pc); steps++) {
          assert.ok(steps < 2000, `F-key routes without waiting at $${cpu.pc.toString(16)}`);
          cpu.hooks.get(cpu.pc)?.(cpu);
          cpu.step();
        }
        if (key === s.ChrF1) {
          assert.equal(cpu.pc, s.DirectRunFromTeensyMenu);
          assert.equal(cpu.x, 9);
          assert.equal(cpu.a, 2, 'the existing Help Pages item is launched');
          assert.deepEqual(sources, []);
        } else {
          assert.equal(cpu.pc, s.HighlightCurrent);
          assert.deepEqual(sources, [s.rmtTeensy]);
        }
      }
    });

    await t.test('resident classic text and advanced SID entry points preserve their calls and return paths', () => {
      const appSource = path.join(temporary, 'apps.asm');
      const appBinary = path.join(temporary, 'apps.bin');
      const appSymbols = path.join(temporary, 'app-symbols');
      fs.writeFileSync(appSource, fs.readFileSync(path.join(menuDir, 'source/GeosApps.asm'), 'utf8')
        .replace(/"build\/(?:vice-preview\/)?DesktopSymbols"/g, JSON.stringify(symbols.replaceAll('\\', '/'))));
      const appBuild = spawnSync(acme, ['--format', 'plain', '-DPreviewApps=1', '--symbollist', appSymbols, '--outfile', appBinary,
        appSource], {cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true});
      assert.ifError(appBuild.error);
      assert.equal(appBuild.status, 0, appBuild.stdout + appBuild.stderr);
      const app = fs.readFileSync(appBinary);
      const a = Object.fromEntries([...fs.readFileSync(appSymbols, 'utf8')
        .matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)].map(m => [m[1], parseInt(m[2], 16)]));
      assert.ok(app.length <= 0x1000);
      assert.equal(app[3], 1, 'the existing backend flag ABI remains at $c003');
      assert.equal(app[4], 0x4c);
      assert.equal(app.readUInt16LE(5), a.ViewTextFileImpl);
      assert.equal(app[7], 0x4c);
      assert.equal(app.readUInt16LE(8), a.ShowSIDAdvancedImpl);
      const viewer = fresh();
      app.copy(viewer.m, 0xc000);
      let starts = 0, waits = 0, returns = 0;
      const commands = [];
      viewer.m[s.IO1Port + s.rRegStreamData] = 0x41;
      stub(viewer, 'PrintBanner');
      stub(viewer, 'StartSelItem_WaitForTRDots', c => {
        starts++;
        c.m[s.IO1Port + s.rRegStrAvailable] = +(starts === 1);
      });
      stub(viewer, 'SendChar', c => { if (c.a === 0x41) c.m[s.IO1Port + s.rRegStrAvailable] = 0; });
      stub(viewer, 'CheckForIRQGetIn', c => { c.a = c.nz(s.ChrSpace); });
      stub(viewer, 'AnyKeyMsgWait', () => { waits++; });
      stub(viewer, 'TextScreenMemColor', () => { returns++; });
      viewer.onWrite = (address, value) => { if (address === s.IO1Port + s.wRegControl) commands.push(value); };
      viewer.call(0xc004);
      assert.equal(starts, 2, 'SPACE at EOF retains the existing next-text-file action');
      assert.deepEqual(commands, [s.rCtlNextTextFile]);
      assert.equal(waits, 1, 'the missing following text file uses the existing acknowledgement');
      assert.equal(returns, 1, 'the viewer tail return reaches the original caller');
      const sid = fresh();
      app.copy(sid.m, 0xc000);
      const serial = [];
      for (const name of ['PrintBanner', 'PrintString', 'PrintSongNum', 'PrintVoiceMutes', 'PrintSIDSpeed', 'DisplayTime']) stub(sid, name);
      stub(sid, 'PrintSerialString', c => serial.push(c.a));
      stub(sid, 'CheckForIRQGetIn', c => { c.a = c.nz(s.ChrSpace); });
      sid.call(0xc007);
      assert.deepEqual(serial, [s.rsstSIDInfo, s.rsstMachineInfo]);
      assert.equal(sid.m[s.PageIdentifyLoc], s.PILSIDScreen);
      assert.equal(sid.sp, 0xff, 'SPACE returns from Advanced to its desktop caller');
    });

    await t.test('relocated LOAD survives desktop overwrite, RUNs BASIC on the exact device and reports late errors', () => {
      for (const device of [8, 9]) for (const mode of ['basic', 'machine-code', 'load-error']) {
        const cpu = fresh();
        const names = [], lfs = [], actions = [], messages = [];
        const loadAddress = mode === 'machine-code' ? 0x2000 : 0x0801;
        cpu.m[s.GeosIECEntry] = 0x2a;
        cpu.m[s.GeosIECLaunchNameLength] = 1;
        cpu.m[s.GeosIECDevice] = device;
        cpu.m[s.GeosIECLaunchAddress] = loadAddress & 255;
        cpu.m[s.GeosIECLaunchAddress + 1] = loadAddress >> 8;
        cpu.m[s.BasicWarmStartVect] = 0x7b;
        cpu.m[s.BasicWarmStartVect + 1] = 0xe3;
        for (const name of ['Mouse1351Hide', 'IRQDisable', 'TextScreenMemColor', 'GeosIECReleaseCartridge']) stub(cpu, name);
        for (const address of [0xff84, 0xfd8c, 0xff8a, 0xff81, 0xe453, 0xe3bf, 0xe422]) stub(cpu, address);
        stub(cpu, 0xffbd, c => names.push(readName(c)));
        stub(cpu, 0xffba, c => lfs.push([c.a, c.x, c.y]));
        stub(cpu, 0xffd5, c => {
          assert.equal(c.a, 0, 'LOAD, not VERIFY');
          const returnAddress = c.m[0x100 + c.sp + 1] | (c.m[0x100 + c.sp + 2] << 8);
          assert.ok(returnAddress >= s.PRGLoadStartReloc && returnAddress < 0x400);
          if (mode !== 'load-error') c.m.fill(0xcc, 0x0800, 0xa000); // New program replaces all desktop code.
          c.x = 0x34; c.y = 0x56;
          c.flag(1, mode === 'load-error');
        });
        stub(cpu, 0xa659, c => { actions.push('CLR'); c.m[0xba] = 8; });
        stub(cpu, 0xa533, () => actions.push('RELINK'));
        stub(cpu, 0xab1e, c => {
          let pointer = c.a | (c.y << 8), text = '';
          while (c.m[pointer]) text += String.fromCharCode(c.m[pointer++]);
          messages.push(text);
        });
        cpu.pc = s.GeosIECLaunchPrepare;
        for (let steps = 0; cpu.pc !== 0xa7ae && cpu.pc !== 0xe37b; steps++) {
          assert.ok(steps < 20000, `boot terminates at BASIC, pc $${cpu.pc.toString(16)}`);
          cpu.hooks.get(cpu.pc)?.(cpu);
          cpu.step();
        }
        assert.deepEqual(names, ['*']);
        assert.deepEqual(lfs, [[1, device, 1]]);
        assert.equal(cpu.sp, 0xfb, 'all desktop callers were discarded before LOAD');
        if (mode === 'basic') {
          assert.equal(cpu.pc, 0xa7ae);
          assert.deepEqual(actions, ['CLR', 'RELINK']);
          assert.equal(cpu.m[0xba], device);
          assert.equal(cpu.m[0x2d] | (cpu.m[0x2e] << 8), 0x5634);
          assert.deepEqual(messages, []);
        } else {
          assert.equal(cpu.pc, 0xe37b);
          assert.deepEqual(actions, []);
          assert.match(messages.join(''), mode === 'load-error' ? /load failed/i : /use sys to start/i);
        }
      }
    });
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});
