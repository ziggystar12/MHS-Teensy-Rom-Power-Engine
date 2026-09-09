'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const teensyDir = path.resolve(__dirname, '../../../Teensy');
const source = name => fs.readFileSync(path.join(teensyDir, name), 'utf8');
const dxx = source('D64.ino');
const directory = dxx.slice(dxx.indexOf('FLASHMEM void LoadDxxDirectory('),
  dxx.indexOf('FLASHMEM bool LoadDxxFile('));
const menu = source('Teensy.ino');
const regs = source('MinimalBoot/Common/Menu_Regs.h');
const itemsPerPage = Number(regs.match(/#define MaxItemsPerPage\s+(\d+)/)[1]);

// Exercise the production loop bounds and occupied-slot predicate against
// binary directory fixtures. This is a source-backed host model, not a
// firmware/emulator execution test.
function readFixture(image, firstTrack, firstSector, diskType) {
  const loop = directory.match(/for\((uint16_t SecOffset = 0;[^)]+)\)/);
  assert.ok(loop, 'directory must scan every slot with a bounded for loop');
  const offsets = new Function('NumDrvDirMenuItems', 'MaxMenuItems',
    `const offsets = []; for (${loop[1].replace('uint16_t', 'let')}) offsets.push(SecOffset); return offsets;`);
  const condition = directory.match(/if \((FileType != 0 && FileName\[0\])\)/);
  assert.ok(condition, 'scratched slots must not become visible entries');
  const isOccupied = new Function('FileType', 'FileName', `return ${condition[1]};`);
  const names = ['..'];
  const visited = new Set();
  let track = firstTrack;
  let sector = firstSector;
  while (track !== 0) {
    const base = diskType === 'd81'
      ? ((track - 1) * 40 + sector) * 256
      : (357 + (track - 18) * 19 + sector) * 256;
    assert.ok(!visited.has(base), 'fixture directory must be acyclic');
    visited.add(base);
    track = image[base];
    sector = image[base + 1];
    for (const offset of offsets(names.length, 4000)) {
      const name = image.subarray(base + offset + 5, base + offset + 21);
      if (isOccupied(image[base + offset + 2], name)) {
        names.push(name.toString('latin1').replace(/\xa0+$/, ''));
      }
    }
  }
  return names;
}

function fixture(diskType, entries) {
  const track = diskType === 'd81' ? 40 : 18;
  const firstSector = diskType === 'd81' ? 3 : 1;
  const image = Buffer.alloc(diskType === 'd81' ? 819200 : 174848);
  const sectorCount = Math.ceil(entries.length / 8);
  for (let i = 0; i < sectorCount; i++) {
    const sector = firstSector + i;
    const base = diskType === 'd81'
      ? ((track - 1) * 40 + sector) * 256
      : (357 + sector) * 256;
    image[base] = i + 1 < sectorCount ? track : 0;
    image[base + 1] = i + 1 < sectorCount ? sector + 1 : 255;
    for (let slot = 0; slot < 8; slot++) {
      const entry = entries[i * 8 + slot];
      if (!entry) continue;
      const at = base + slot * 32;
      image[at + 2] = entry.deleted ? 0 : (entry.type || 0x82);
      image[at + 3] = 1;
      image.fill(0xa0, at + 5, at + 21);
      image.write(entry.name, at + 5, Math.min(entry.name.length, 16), 'latin1');
    }
  }
  return readFixture(image, track, firstSector, diskType);
}

test('disk-image directory advances across all eight slots and bounds menu storage', () => {
  assert.match(directory, /while\(Track != 0 && NumDrvDirMenuItems < MaxMenuItems\)/);
  assert.match(directory, /for\(uint16_t SecOffset = 0; SecOffset < 256 && NumDrvDirMenuItems < MaxMenuItems; SecOffset \+= 0x20\)/);
  assert.doesNotMatch(directory, /else\s*\{[^}]*SecOffset\s*=\s*0/);
});

for (const diskType of ['d64', 'd81']) {
  test(`${diskType} retains files after empty and scratched directory slots`, () => {
    const entries = [null, {name: 'FIRST'}, null,
      {name: 'OLD DELETED', deleted: true}, {name: 'GEOS'}, null,
      {name: 'LAST IN SECTOR'}, null, {name: 'NEXT SECTOR'}];
    assert.deepEqual(fixture(diskType, entries),
      ['..', 'FIRST', 'GEOS', 'LAST IN SECTOR', 'NEXT SECTOR']);
  });

  test(`${diskType} exposes files beyond the first nineteen-item page`, () => {
    const entries = Array.from({length: 24}, (_, i) => ({name: `FILE ${i + 1}`}));
    entries[22].name = 'GEOS';
    const names = fixture(diskType, entries);
    assert.equal(names.length, 25); // The parent-directory item also uses a slot.
    assert.equal(Math.ceil(names.length / itemsPerPage), 2);
    assert.ok(names.slice(itemsPerPage).includes('GEOS'));
  });
}

test('disk-image raw totals feed the nineteen-item classic or filtered desktop page map', () => {
  assert.equal(itemsPerPage, 19);
  assert.match(source('DriveDirLoad.ino'), /LoadDxxDirectory\(sourceFS, MenuSelCpy.ItemType\);[\s\S]*?SetNumItems\(NumDrvDirMenuItems\);/);
  assert.match(menu, /NumItemsFull = NumItems/);
  assert.match(menu, /NumItemsFull = NumItems;\s+MenuViewRebuild\(\);\s+IO1\[rwRegCursorItemOnPg\] = 0;\s+MenuViewSetPage\(1\)/);
  const view = source('MinimalBoot/Common/IO_Handlers/DesktopMenuView.c');
  assert.match(view, /MenuViewCount \? \(MenuViewCount - 1\) \/ MenuViewPageSize \+ 1 : 1/);
  assert.match(view, /MenuViewPageSize = MenuViewActive == 2 \? DesktopViewportItems : MenuViewActive \? MaxDesktopItemsPerPage : MaxItemsPerPage/);
  assert.match(view, /if \(IO1\[rwRegMenuView\] && MenuSource\)/);
  assert.match(source('MinimalBoot/Common/IO_Handlers/IOH_TeensyROM.c'),
    /case rwRegPageNumber:\s+MenuViewSetPage\(Data\)/);
});
