'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');

const menuDir = path.resolve(__dirname, '..');
const probe = fs.readFileSync(path.join(__dirname, 'geos-color-publication.test.js'), 'utf8');
const first = probe.indexOf('class Cpu6502 {');
const last = probe.indexOf("test('assembled renderer", first);
const Cpu6502 = vm.runInNewContext(probe.slice(first, last) + '\nCpu6502;', {assert});
const preview = fs.readFileSync(path.join(menuDir, 'preview-desktop.ps1'), 'utf8');
const acme = process.env.ACME_EXE || preview.match(/\$AcmePath\s*=\s*'([^']+)'/)[1];

test('assembled desktop synchronizes view mode and filters IEC parents before pagination', async t => {
  if (!fs.existsSync(acme)) return t.skip('ACME unavailable; set ACME_EXE');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-parent-directory-'));
  try {
    const binary = path.join(temporary, 'desktop.bin');
    const symbols = path.join(temporary, 'symbols');
    const build = spawnSync(acme, ['--format', 'plain', '--symbollist', symbols, '--outfile', binary,
      'source/DesktopShellCode.asm'], {cwd: menuDir, encoding: 'utf8', windowsHide: true});
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const s = Object.fromEntries([...fs.readFileSync(symbols, 'utf8')
      .matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)].map(m => [m[1], parseInt(m[2], 16)]));
    const program = fs.readFileSync(binary);
    const fresh = () => {
      const memory = Buffer.alloc(65536);
      program.copy(memory, s.MainCodeRAMStart);
      return new Cpu6502(memory);
    };
    const stub = (cpu, name, hook = () => {}) => {
      cpu.m[s[name]] = 0x60;
      cpu.hooks.set(s[name], hook);
    };

    await t.test('bitmap/classic transitions write the volatile register once and wait before redraw', () => {
      const cpu = fresh();
      const writes = [];
      let waits = 0;
      stub(cpu, 'WaitForTRWaitMsg', () => { waits++; });
      cpu.onWrite = (address, value) => { if (address >= s.IO1Port) writes.push([address, value]); };
      cpu.m[s.GeosViewMode] = 1;
      cpu.call(s.GeosSyncMenuView);
      cpu.call(s.GeosSyncMenuView);
      cpu.m[s.GeosViewMode] = 0;
      cpu.call(s.GeosSyncMenuView);
      cpu.call(s.GeosSyncMenuView);
      assert.deepEqual(writes, [[s.IO1Port + 106, 2], [s.IO1Port + 106, 0]]);
      assert.equal(waits, 2);
      const main = fs.readFileSync(path.join(menuDir, 'source', 'MainMenu.asm'), 'utf8');
      assert.match(main, /ListMenuItems:\s*!ifdef DesktopShell \{\s+jsr GeosSyncMenuView\s*\}\s+lda GeosViewMode/);
      assert.match(main, /!ifndef DesktopShell \{\s*;[^\n]*\s+lda rwRegMenuView\+IO1Port[\s\S]*?sta rwRegMenuView\+IO1Port\s+jsr WaitForTRWaitMsg/);
    });

    await t.test('only exact parent DIR names are hidden, with PETSCII and padded names supported', () => {
      for (const name of ['..', '/..', '/.. <UP DIR>', '/.. <Up Dir>', '.. <UP DIR>']) {
        for (const padding of [0, 32, 160]) for (const directory of [0, 1]) {
          const cpu = fresh();
          cpu.m.fill(padding, s.GeosIECRecord, s.GeosIECRecord + 16);
          Buffer.from(name).copy(cpu.m, s.GeosIECRecord);
          cpu.m[s.GeosIECRecord + 19] = directory;
          cpu.call(s.GeosIECRecordIsParent);
          assert.equal(cpu.p & 1, directory, `${name}, padding ${padding}, DIR ${directory}`);
        }
      }
      for (const name of ['..GAMES', '/..GAMES', '/.. <UP DIR>X', '/Games', '...']) {
        const cpu = fresh();
        Buffer.from(name).copy(cpu.m, s.GeosIECRecord);
        cpu.m[s.GeosIECRecord + 19] = 1;
        cpu.call(s.GeosIECRecordIsParent);
        assert.equal(cpu.p & 1, 0, `${name} remains a real directory`);
      }
    });

    await t.test('IEC parsing fills each twenty-file viewport without counting synthetic parents', () => {
      const line = (name, type) => [1, 8, 1, 0, ...Buffer.from(`"${name}" ${type}`), 0];
      for (const count of [0, 1, 15, 16, 17, 20, 33, 51]) for (const parentAt of [0, count]) {
        const entries = Array.from({length: count}, (_, index) => [`FILE${index}.PRG`, 'PRG']);
        entries.splice(parentAt, 0, ['/.. <Up Dir>', 'DIR']);
        const bytes = [1, 8, ...line('TEST DISK', '00 2A'), ...entries.flatMap(([name, type]) => line(name, type)), 0, 0];
        const pages = Math.max(1, Math.ceil(count / 20));
        for (let page = 0; page < pages; page++) {
          const cpu = fresh();
          let offset = 0;
          stub(cpu, 'GeosIECBegin', current => { current.p &= ~1; });
          stub(cpu, 'GeosIECOpenInput', current => { current.p &= ~1; });
          stub(cpu, 'GeosIECKernalSETNAM');
          stub(cpu, 'GeosIECKernalSETLFS');
          stub(cpu, 'GeosIECCleanup');
          stub(cpu, 'GeosIECGetByte', current => {
            assert.ok(offset < bytes.length, 'directory reader stays within complete stream');
            current.a = current.nz(bytes[offset++]);
            current.p &= ~1;
          });
          cpu.m[s.GeosIECTopLo] = page * 20;
          cpu.call(s.GeosIECReadPage);
          const expected = Math.min(20, count - page * 20);
          assert.equal(cpu.m[s.GeosIECCount], expected, `${count} files, parent ${parentAt}, page ${page}`);
          assert.equal(cpu.m[s.GeosIECMore], +(page + 1 < pages));
          assert.equal(cpu.m[s.GeosIECError], 0);
          assert.equal(cpu.m[s.GeosIECTotalLo] | cpu.m[s.GeosIECTotalHi] << 8,count);
          assert.equal(offset,bytes.length, "initial read counts the entire bounded directory");
          for (let index = 0; index < expected; index++) {
            cpu.a = index;
            cpu.call(s.GeosIECGetEntry);
            const name = cpu.m.subarray(s.GeosIECEntry, s.GeosIECEntry + 16).toString('ascii').replace(/\0.*$/, '');
            assert.equal(name, `FILE${page * 20 + index}.PRG`, 'selection/launch record keeps its visible file identity');
          }
        }
      }
    });
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});
