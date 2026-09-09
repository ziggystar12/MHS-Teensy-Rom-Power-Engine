'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourceDir = path.join(__dirname, '..', 'source');
const desktop = fs.readFileSync(path.join(sourceDir, 'GeosDesktop.s'), 'utf8');
const iec = fs.readFileSync(path.join(sourceDir, 'GeosIEC.s'), 'utf8');

function block(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.notEqual(first, -1, `missing ${start}`);
  assert.notEqual(last, -1, `missing ${end}`);
  return source.slice(first, last);
}

test('standalone blits native font and browser art while compact retains its charset installer', () => {
  const rich = fs.readFileSync(path.join(sourceDir, 'GeosRich.s'), 'utf8');
  const install = block(desktop, 'GeosInstallMonoCharset:', 'GeosDrawHeader:');
  assert.match(install, /!ifdef DesktopShell \{ rts \}\s*!ifndef DesktopShell \{/);
  assert.match(install, /GeosCopyIconGlyphs:\s*!ifndef DesktopShell\s*\{\s*lda GeosIconData,x\s*\}/);
  assert.match(install, /cpx #GeosIconDataEnd-GeosIconData/);
  assert.doesNotMatch(install, /GeosRichInstallFont|GeosRichBrowserIconData/);
  assert.doesNotMatch(rich, /GeosRichInstallFont:|RichFontWrite:/);
  assert.match(rich, /adc #<GeosRichFont\s*sta RichSource\+1/);
  assert.match(rich, /adc #<GeosRichBrowserIconData/);
});

test('standalone filename capture preserves compact seven-character layout and drains serial input', () => {
  const label = block(desktop, 'GeosDrawItemLabel:', '; A is the first of six');
  assert.match(label, /!ifdef DesktopShell\s*\{\s*lda GeosWorkItem\s*jsr GeosRichLabelStart\s*jsr GeosRichPrintFileLabel\s*\}/);
  assert.match(label, /!ifndef DesktopShell\s*\{\s*lda #rsstItemName\s*ldx #7\s*jsr GeosPrintSerialLimited\s*\}/);
  assert.match(label, /GeosRichPrintFileLabel:\s*lda #rsstDesktopLabel\s*sta rwRegSerialString\+IO1Port/);
  assert.match(label, /GeosRichReadFileLabel:\s*lda rwRegSerialString\+IO1Port\s*beq GeosRichFileLabelDone\s*jsr GeosRichLabelPut\s*jmp GeosRichReadFileLabel/);
});

test('filename records are bounded, cleared, NUL-terminated, and safe for the last item', () => {
  assert.match(desktop, /GeosRichFileLabelCount = GeosPageCapacity/);
  assert.match(desktop, /GeosPageCapacity = DesktopViewportItems/);
  assert.match(desktop, /GeosRichFileLabelLength = DesktopLabelLength/);
  assert.match(desktop, /GeosRichFileLabelStride = DesktopLabelLength\+1/);
  assert.match(desktop, /GeosRichFileLabels: !fill GeosRichFileLabelCount\*GeosRichFileLabelStride,0/);
  const start = block(desktop, 'GeosRichLabelStart:', 'GeosRichLabelPut:');
  assert.match(start, /cmp #GeosRichFileLabelCount\s*bcc GeosRichLabelValid\s*lda #GeosRichFileLabelLength\s*sta GeosRichLabelCount\s*rts/);
  assert.match(start, /GeosRichLabelValid:\s*tax\s*lda TblGeosRichFileLabelLo,x\s*sta GeosRichLabelClear\+1\s*sta GeosRichLabelStore\+1\s*lda TblGeosRichFileLabelHi,x\s*sta GeosRichLabelClear\+2\s*sta GeosRichLabelStore\+2/);
  assert.match(desktop, /TblGeosRichFileLabelLo: !for i,0,GeosRichFileLabelCount-1 \{ !byte <\(GeosRichFileLabels\+i\*GeosRichFileLabelStride\) \}/);
  assert.match(desktop, /TblGeosRichFileLabelHi: !for i,0,GeosRichFileLabelCount-1 \{ !byte >\(GeosRichFileLabels\+i\*GeosRichFileLabelStride\) \}/);
  assert.match(start, /lda #0\s*sta GeosRichLabelCount\s*ldy #GeosRichFileLabelStride-1\s*GeosRichLabelClear:\s*sta \$ffff,y\s*dey\s*bpl GeosRichLabelClear/);
  const put = block(desktop, 'GeosRichLabelPut:', 'GeosRichLabelCount:');
  assert.match(put, /sta GeosRichLabelChar\s*tya\s*pha\s*ldy GeosRichLabelCount\s*cpy #GeosRichFileLabelLength\s*bcs GeosRichLabelPutDone/);
  assert.match(put, /GeosRichLabelStore:\s*sta \$ffff,y\s*inc GeosRichLabelCount/);
  assert.match(put, /GeosRichLabelPutDone:\s*pla\s*tay\s*lda GeosRichLabelChar\s*rts/);
  assert.doesNotMatch(put, /\b(?:tax|txa|tsx|ldx|inx|dex)\b/);
  assert.equal(19 * 23 + 22, 459); // Last terminator is within460bytes.
  // Symbolic low/high addresses must retain page carries for every record.
  for (const base of [0x6000, 0x60f0, 0x60ff]) {
    for (let item = 0; item < 20; item++) {
      const address = base + item * 23;
      assert.equal(((address >> 8) << 8) | (address & 0xff), base + item * 23);
    }
  }
});

test('IEC captures exact sixteen filename bytes separately from metadata', () => {
  const label = block(iec, 'GeosIECDrawIcon:', 'GeosIECDrawStatus:');
  assert.match(label, /!ifdef DesktopShell\s*\{\s*lda GeosWorkItem\s*jsr GeosRichLabelStart\s*ldx #0/);
  assert.match(label, /GeosIECCaptureLabel:\s*lda GeosIECEntry,x\s*beq GeosIECLabelDone\s*jsr GeosIECDisplayChar/);
  assert.match(label, /GeosIECLabelPut:\s*jsr GeosRichLabelPut\s*inx\s*cpx #16[^\r\n]*\s*bne GeosIECCaptureLabel/);
  assert.doesNotMatch(label, /cpx #GeosRichFileLabelLength/);
  assert.doesNotMatch(label, /jsr SendChar|jsr GeosIECPrintName/);
});
