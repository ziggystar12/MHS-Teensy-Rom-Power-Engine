'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');

const menuDir = path.resolve(__dirname, '..');
const repository = path.resolve(menuDir, '../../..');
const probe = fs.readFileSync(path.join(__dirname, 'geos-color-publication.test.js'), 'utf8');
const first = probe.indexOf('class Cpu6502 {');
const last = probe.indexOf("test('assembled renderer", first);
const Cpu6502 = vm.runInNewContext(probe.slice(first, last) + '\nCpu6502;', {assert});
const preview = fs.readFileSync(path.join(menuDir, 'preview-desktop.ps1'), 'utf8');
const acme = process.env.ACME_EXE || preview.match(/\$AcmePath\s*=\s*'([^']+)'/)[1];

const symbols = filename => Object.fromEntries([...fs.readFileSync(filename, 'utf8')
  .matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)].map(match => [match[1], parseInt(match[2], 16)]));
const headerBytes = filename => Buffer.from([...fs.readFileSync(filename, 'utf8')
  .matchAll(/0x([0-9a-f]{2})/gi)].map(match => parseInt(match[1], 16)));

test('desktop utilities assemble as separate $c000 PRGs with the fixed helper ABI', async t => {
  if (!fs.existsSync(acme)) return t.skip('ACME unavailable; set ACME_EXE');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-loadable-apps-'));
  try {
    const assemble = (source, output, labels, format = 'plain') => {
      const result = spawnSync(acme, ['--format', format, '--symbollist', labels, '--outfile', output, source],
        {cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true});
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    const desktopBinary = path.join(temporary, 'desktop.bin');
    const desktopSymbols = path.join(temporary, 'DesktopSymbols');
    assemble('source/DesktopShellCode.asm', desktopBinary, desktopSymbols);
    const desktop = fs.readFileSync(desktopBinary);

    const residentSource = path.join(temporary, 'resident.asm');
    const residentBinary = path.join(temporary, 'resident.bin');
    const residentSymbols = path.join(temporary, 'ResidentSymbols');
    fs.writeFileSync(residentSource, fs.readFileSync(path.join(menuDir, 'source/GeosApps.asm'), 'utf8')
      .replace(/"build\/(?:vice-preview\/)?DesktopSymbols"/g, JSON.stringify(desktopSymbols.replaceAll('\\', '/'))));
    assemble(residentSource, residentBinary, residentSymbols);
    const resident = fs.readFileSync(residentBinary);
    const residentMap = symbols(residentSymbols);
    assert.ok(resident.length > 0 && resident.length < 1024, `resident helper block is ${resident.length} bytes`);
    for (const privateSymbol of ['SnakeInit', 'CalcInit', 'TextInit', 'AppPrintNumber']) {
      assert.equal(residentMap[privateSymbol], undefined, `${privateSymbol} is not resident`);
    }

    const utilitySource = fs.readFileSync(path.join(menuDir, 'source/GeosUtility.asm'), 'utf8');
    const definitions = [
      {name: 'Snake', wrapper: 'DesktopSnake.asm', own: 'SnakeInit', absent: ['CalcInit', 'TextInit'], id: 0},
      {name: 'Calculator', wrapper: 'DesktopCalculator.asm', own: 'CalcInit', absent: ['SnakeInit', 'TextInit'], id: 1},
      {name: 'TextViewer', wrapper: 'DesktopTextViewer.asm', own: 'TextInit', absent: ['SnakeInit', 'CalcInit'], id: 2},
    ];
    const images = [];
    for (const definition of definitions) {
      const source = path.join(temporary, `${definition.name}.asm`);
      const output = path.join(temporary, `${definition.name}.prg`);
      const labels = path.join(temporary, `${definition.name}Symbols`);
      const wrapper = fs.readFileSync(path.join(menuDir, 'source', definition.wrapper), 'utf8');
      fs.writeFileSync(source, wrapper.replace('!src "source/GeosUtility.asm"', utilitySource
        .replace('"build/DesktopSymbols"', JSON.stringify(desktopSymbols.replaceAll('\\', '/')))));
      assemble(source, output, labels, 'cbm');
      const prg = fs.readFileSync(output), body = prg.subarray(2), map = symbols(labels);
      assert.equal(prg.readUInt16LE(0), 0xc000);
      assert.ok(body.length > resident.length && body.length <= 4096,
        `${definition.name} uses ${body.length}/4096 bytes`);
      assert.ok(Number.isInteger(map[definition.own]), `${definition.own} is present`);
      for (const absent of definition.absent) assert.equal(map[absent], undefined, `${absent} is absent`);
      assert.equal(body[3], 1, 'backend ABI byte stays at $c003');
      for (const offset of [0, 4, 7, 10, 13, 16]) {
        assert.equal(body[offset], 0x4c, `JMP ABI opcode at $${(0xc000 + offset).toString(16)}`);
        const target = body.readUInt16LE(offset + 1);
        assert.ok(target >= 0xc000 && target < 0xc000 + body.length, `ABI target $${target.toString(16)} is in-bank`);
      }
      assert.equal(body[19], 0xa9, 'AppWaitPoll keeps its fixed LDA-immediate entry at $c013');
      assert.equal(body[20], 0, 'resident-controlled AppWaitPoll operand stays at $c014');

      const memory = Buffer.alloc(65536);
      desktop.copy(memory, map.MainCodeRAMStart);
      body.copy(memory, 0xc000);
      memory[1] = 0x36;
      memory[map.Joystick2Sample] = 0xff;
      memory[map.AppJoyLast] = 0xff;
      const cpu = new Cpu6502(memory);
      cpu.hooks.set(map.GeosRichClock, () => {});
      cpu.m[map.GeosRichClock] = 0x60;
      cpu.hooks.set(map.GetIn, current => { current.a = map.ChrStop; current.nz(current.a); });
      cpu.m[map.GetIn] = 0x60;
      cpu.a = 0;
      cpu.call(0xc000);
      assert.equal(cpu.a, 1, `${definition.name} closes with the normal desktop-return code`);
      assert.equal(cpu.m[map.AppID], definition.id);
      assert.equal(cpu.m[1], 0x36, `${definition.name} restores RAM banking`);

      const checkedInPath = path.resolve(menuDir, `../../Teensy/TRMenuFiles/ROMs/Desktop${definition.name}.prg.h`);
      const checkedInText = fs.readFileSync(checkedInPath, 'utf8');
      assert.match(checkedInText,
        new RegExp(`PROGMEM\\s+static\\s+const\\s+unsigned char\\s+Desktop${definition.name}_prg\\[\\]`),
        `${definition.name} image stays in firmware flash`);
      const checkedIn = headerBytes(checkedInPath);
      assert.deepEqual(checkedIn, prg, `${definition.name} generated firmware header is current`);
      images.push({name: definition.name, bytes: prg.length});
    }
    t.diagnostic(`desktop ${desktop.length} bytes; helpers ${resident.length} bytes; ` +
      images.map(image => `${image.name} ${image.bytes} bytes`).join('; '));
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});

test('firmware and C64 routes stream one named desktop utility on demand', () => {
  const read = relative => fs.readFileSync(path.join(repository, relative), 'utf8');
  const registers = read('Source/Teensy/MinimalBoot/Common/Menu_Regs.h');
  const generated = read('Source/C64/MainMenuCRT/source/Menu_Regs.i');
  const backend = read('Source/Teensy/MinimalBoot/Common/IO_Handlers/IOH_TeensyROM.c');
  const execution = read('Source/Teensy/DriveDirLoad.ino');
  const menu = read('Source/Teensy/MainMenuItems.h');
  const main = read('Source/C64/MainMenuCRT/source/MainMenu.asm');
  const shell = read('Source/C64/MainMenuCRT/source/GeosShell.s');
  const loader = read('Source/C64/MainMenuCRT/source/DesktopShell.asm');
  const builder = read('scripts/build-c64-menu.ps1');
  const prepare = read('scripts/prepare-teensyrom-custom-gui.mjs');

  for (const source of [registers, generated]) {
    assert.match(source, /rwRegDesktopAppID\s*=\s*145\b[\s\S]*?IO1Size\s*=\s*146\b/);
    assert.match(source, /rCtlDesktopAppLoad\s*=\s*66\b/);
    assert.match(source, /rdaSnake\s*=\s*0\b[\s\S]*?rdaCalculator\s*=\s*1\b[\s\S]*?rdaTextViewer\s*=\s*2\b/);
    assert.match(source, /rtFileDesktopApp\s*=\s*20\b/);
  }
  const stream = backend.match(/case rCtlDesktopAppLoad:[\s\S]*?(?=\n\s*case rCtlFileCopyWAIT:)/)?.[0];
  assert.ok(stream, 'desktop app stream command exists');
  assert.match(stream, /IO1\[rRegStrAvailable\] = 0;[\s\S]*?DesktopSnake_prg[\s\S]*?DesktopCalculator_prg[\s\S]*?DesktopTextViewer_prg[\s\S]*?StreamOffsetAddr = 0;[\s\S]*?IO1\[rRegStrAvailable\] = 0xff;/);
  assert.doesNotMatch(stream, /rwRegStatus|memcpy|LoadFile/, 'IO interrupt only publishes an existing flash stream');
  assert.match(execution, /case rtFileDesktopApp:\s*case rtFilePrg:/);
  for (const [name, image] of [['Snake', 'DesktopSnake_prg'], ['Calculator', 'DesktopCalculator_prg'], ['Text Viewer', 'DesktopTextViewer_prg']]) {
    assert.match(menu, new RegExp(`rtFileDesktopApp\\s*,\\s*IOH_TeensyROM\\s*,\\s*\\(char\\*\\)"${name}"[\\s\\S]*?${image}`));
  }
  assert.match(main, /cmp #rtFileDesktopApp\s+bne \+\s+jmp RunSelectedDesktopApp/);
  assert.match(main, /ora #rdaLaunchPending\s+sta rwRegDesktopAppID\+IO1Port\s+jmp LaunchDesktopShell/);
  assert.match(main, /RunSelectedDesktopApp:[\s\S]*?jsr StartSelItem_WaitForTRDots\s+jsr FastLoadFile[\s\S]*?jmp GeosShellRunLoadedApp/);
  assert.match(shell, /GeosShellOpenApp:[\s\S]*?rCtlDesktopAppLoad[\s\S]*?jsr FastLoadFile[\s\S]*?GeosShellRunLoadedApp:[\s\S]*?jsr GeosAppEntry/);
  assert.match(loader, /!binary "build\/GeosApps\.bin"/);
  assert.doesNotMatch(loader, /Desktop(?:Snake|Calculator|TextViewer)\.prg/, 'desktop bootstrap embeds no utility');
  for (const name of ['DesktopSnake', 'DesktopCalculator', 'DesktopTextViewer']) {
    assert.match(builder, new RegExp(`${name}\\.prg`));
    assert.match(prepare, new RegExp(`${name}\\.prg`));
  }
});
