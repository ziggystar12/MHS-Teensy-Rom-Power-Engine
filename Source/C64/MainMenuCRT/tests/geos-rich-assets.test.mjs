import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDesktopBitmapAssets,
  outputPath,
} from '../../../../scripts/generate-desktop-bitmap-assets.mjs';

const assets = buildDesktopBitmapAssets();

test('generated assembly is reproducible from the maintained raster source', () => {
  assert.equal(readFileSync(outputPath, 'utf8').replaceAll('\r\n', '\n'), assets.source);
  assert.equal(buildDesktopBitmapAssets().source, assets.source);
});

test('font packs all printable ASCII characters as 5x7 ink plus blank row', () => {
  assert.equal(assets.font.length, 768);
  const glyph = code => assets.font.slice((code - 0x20) * 8, (code - 0x1f) * 8);
  assert.deepEqual(Array.from(glyph(0x20)), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(glyph(0x41)), [0x70, 0x88, 0x88, 0xf8, 0x88, 0x88, 0x88, 0]);
  assert.deepEqual(glyph(0x7f), glyph(0x3f));
  for (let code = 0x20; code <= 0x7e; code++) {
    if (code !== 0x3f) assert.notDeepEqual(glyph(code), glyph(0x3f),
      `${String.fromCharCode(code)} has a defined glyph instead of the question-mark fallback`);
  }
  for (let code = 0x61; code <= 0x7a; code++) assert.notDeepEqual(glyph(code), glyph(code - 0x20),
    'Filename case must remain visually distinguishable');
  for (let index = 0; index < assets.font.length; index++) {
    assert.equal(assets.font[index] & 7, 0);
    if ((index & 7) === 7) assert.equal(assets.font[index], 0);
  }
});

test('native app operators, brackets, and directional labels have their own 5x7 glyphs', () => {
  const expectedRows = {
    ',': [0, 0, 0, 0, 6, 4, 8],
    '*': [0, 4, 21, 14, 21, 4, 0],
    '=': [0, 0, 31, 0, 31, 0, 0],
    '(': [2, 4, 8, 8, 8, 4, 2],
    ')': [8, 4, 2, 2, 2, 4, 8],
    '<': [1, 2, 4, 8, 4, 2, 1],
    '>': [16, 8, 4, 2, 4, 8, 16],
    '[': [14, 8, 8, 8, 8, 8, 14],
    ']': [14, 2, 2, 2, 2, 2, 14],
    '^': [4, 10, 17, 0, 0, 0, 0],
  };
  const question = assets.font.slice((0x3f - 0x20) * 8, (0x40 - 0x20) * 8);
  for (const [character, rows] of Object.entries(expectedRows)) {
    const offset = (character.charCodeAt(0) - 0x20) * 8;
    const actual = assets.font.slice(offset, offset + 8);
    assert.deepEqual(Array.from(actual), [...rows.map(row => row << 3), 0], character);
    assert.notDeepEqual(actual, question, `${character} must not use the question-mark fallback`);
  }
});

test('eight desktop icons are packed in desktop order as 24x16 row-major rasters', () => {
  assert.deepEqual(assets.icons.map(icon => icon.id),
    ['teensy', 'sd', 'usb', 'drive8', 'drive9', 'games', 'utilities', 'control']);
  for (const icon of assets.icons) assert.equal(icon.bytes.length, 48);
  assert.deepEqual(assets.icons[5].bytes, assets.icons[6].bytes);
  assert.notDeepEqual(assets.icons[3].bytes, assets.icons[4].bytes);
  const folder = assets.icons[5].bytes;
  assert.deepEqual(Array.from(folder.slice(0, 3)), [0, 0, 0]);
  assert.deepEqual(Array.from(folder.slice(3, 6)), [0x3f, 0xf0, 0]);
  assert.deepEqual(Array.from(folder.slice(12, 15)), [0xff, 0xff, 0xff]);
  assert.deepEqual(Array.from(folder.slice(21, 24)), [0xc0, 0, 0x03]);
});

test('browser icons retain the existing 3x2 eight-byte tile format', () => {
  assert.deepEqual(assets.browserIcons.map(icon => icon.label), ['Folder', 'Disk', 'Document', 'Program']);
  for (const icon of assets.browserIcons) assert.equal(icon.bytes.length, 48);
  for (let y = 0; y < 16; y++) {
    for (let column = 0; column < 3; column++) {
      const tileOffset = ((y >> 3) * 3 + column) * 8 + (y & 7);
      assert.equal(assets.browserIcons[0].bytes[tileOffset], assets.icons[5].bytes[y * 3 + column]);
    }
  }
  assert.deepEqual(Array.from(assets.browserIcons[2].bytes.slice(0, 8)), [0, 7, 4, 4, 4, 4, 4, 4]);
  assert.deepEqual(Array.from(assets.browserIcons[3].bytes.slice(0, 8)), [0, 0, 0x3f, 0x2a, 0x20, 0x3f, 0x20, 0x20]);
});
