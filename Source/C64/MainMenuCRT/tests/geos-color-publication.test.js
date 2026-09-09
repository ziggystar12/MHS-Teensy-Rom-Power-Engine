'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const menuDir = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(menuDir, 'source', name), 'utf8').replace(/;[^\r\n]*/g, '');
const bitmap = source('GeosBitmap.s');
const rich = source('GeosRich.s');

test('bundled desktop Help explains app access and fits above its navigation footer', t => {
    const preview = fs.readFileSync(path.join(menuDir, 'preview-desktop.ps1'), 'utf8');
    const acme = process.env.ACME_EXE || preview.match(/\$AcmePath\s*=\s*'([^']+)'/)[1];
    if (!fs.existsSync(acme)) return t.skip('ACME unavailable; set ACME_EXE');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'teensyrom-help-test-'));
    try {
        const binary = path.join(temporary, 'help.bin');
        const symbolsFile = path.join(temporary, 'symbols');
        const helpDir = path.join(menuDir, '..', 'TRHelpScreens');
        const result = spawnSync(acme, ['--format', 'plain', '--symbollist', symbolsFile,
            '--outfile', binary, 'source/TRHelpScreens.asm'],
            { cwd: helpDir, encoding: 'utf8', timeout: 30000, windowsHide: true });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const symbols = Object.fromEntries([...fs.readFileSync(symbolsFile, 'utf8')
            .matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)]
            .map(match => [match[1], parseInt(match[2], 16)]));
        const data = fs.readFileSync(binary);
        assert.equal(data.readUInt16LE(symbols.tblSettingsPages - 0x0801 + 4), symbols.DesktopHelp,
            'the desktop guidance is reachable as the third F1 Help page');
        // CommonInit starts page text at row 2; its footer begins at row 21.
        // Decode the assembled PETSCII/escape stream, counting real newlines
        // and rejecting lines that would cause an extra 40-column wrap.
        const lines = [''];
        let cursor = symbols.MsgDesktopHelp - 0x0801;
        for (;;) {
            assert.ok(cursor < data.length, 'Help string must terminate inside its payload');
            const value = data[cursor++];
            if (!value) break;
            if (value === 1) {
                const argument = data[cursor++];
                if ((argument & 0xc0) === 0x80) lines[lines.length - 1] += ' '.repeat(argument & 63);
            } else if (value === 13) lines.push('');
            else if (value !== 18 && value !== 146) lines[lines.length - 1] += String.fromCharCode(value & 127);
        }
        assert.ok(lines.length <= 19, `${lines.length} lines would overwrite the row-21 footer`);
        for (const line of lines) assert.ok(line.length < 40, `Help text wraps: ${line}`);
        const text = lines.join('\n').toUpperCase();
        for (const phrase of ['DRAG: GHOST+GRID; RELEASE SNAPS.',
            'BROWSER: 5 ROWS; MESSAGES USE A MODAL.', 'LOADING BARS FILL FROM LEFT TO RIGHT.',
            'F1 HELP / F2 BASIC / F8 CONTROL PANEL', 'V: GUI / ORIGINAL-STYLE TEXT MENU.',
            'PANEL APPEARANCE: LIGHT OR DARK.', 'BACKGROUND: DOTS, DITHERED, OR BLANK.',
            'PANEL INPUT: MOUSE/JOY FOR EACH PORT.', 'ONE MOUSE MAX; TWO JOYSTICKS ALLOWED.',
            'PANEL STORAGE: SD/USB ID, SIZE, FREE.', 'ALSO SHOWS FIRMWARE FLASH SIZE/FREE.',
            'TEENSY: SNAKE, CALCULATOR, TEXT VIEWER.', 'APPS LOAD FROM FIRMWARE ONLY WHEN USED.',
            'CLOSE/STOP RETURNS; APP RAM IS REUSED.', 'SHIFT+RUN/STOP',
            'DELETE IS PERMANENT; NO TRASH FOLDER.']) assert.ok(text.includes(phrase), phrase);
        t.diagnostic(`Desktop Help uses ${lines.length}/19 body rows; longest line ${Math.max(...lines.map(line => line.length))}/39 columns`);
    } finally {
        assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
        assert.ok(path.basename(temporary).startsWith('teensyrom-help-test-'));
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

function block(text, first, last) {
    const start = text.indexOf(first);
    const end = text.indexOf(last, start + first.length);
    assert.ok(start >= 0 && end > start, `${first} through ${last} exists`);
    return text.slice(start, end);
}

test('native composition stages monochrome colors before drawing shared controls', () => {
    const start = block(bitmap, 'GeosBitmapConvertScreen:', 'GeosBitmapPublishColors:');
    assert.match(start, /jsr GeosBitmapTintSurface\s+jsr GeosRichCompose/);
    assert.doesNotMatch(start, /GeosBitmapConvertCell|smcGeosBitmapWriteCell/);
    const widgets = source('GeosWidgets.s');
    assert.match(block(widgets, 'UiColorRow:', 'UiPublishColors:'), /adc #>\(GeosLayoutScreen-C64ScreenRAM\)/);
    assert.doesNotMatch(block(widgets, 'UiColorRow:', 'UiPublishColors:'), /sta C64ScreenRAM/);
    assert.match(block(rich, 'RichComposeFiles:', 'RichComposeChrome:'), /jsr GeosRichBrowserChrome\s+jsr GeosRichFileNames/);
});

test('base pixels publish before colors and transient menus, then restore the bank', () => {
    assert.match(block(rich, 'GeosRichCompose:', 'RichComposeDone:'), /jsr GeosRichPublish\s+jsr GeosBitmapPublishColors\s+lda GeosOverlayMode\s+cmp #GeosOverlayMenu\s+bne \+\s+jsr GeosMenuPaint\s+\+\s+lda RichSavedBank\s+sta \$01\s+lda GeosNotice/);
    const publish = block(bitmap, 'GeosBitmapPublishColors:', 'GeosBitmapCaptureFont:');
    assert.match(publish, /!for page,0,2/);
    assert.match(publish, /lda GeosLayoutScreen\+768,x\s+cmp C64ScreenRAM\+768,x\s+beq \+\s+sta C64ScreenRAM\+768,x/);
    assert.match(publish, /cpx #232\s+bne GeosBitmapPublishColorTail\s+lda #0\s+sta GeosBitmapColorOffset\s+rts/);
    assert.doesNotMatch(publish, /\$d011|\$d016|VICMemSetup|Sprite0Pointer/);
});

// Assemble current production sources into a unique temporary directory. Never
// consume potentially stale build output or regenerate firmware/header files.
// Set ACME_EXE for other machines; the preview's default is a local fallback.
function findAssembler() {
    if (process.env.ACME_EXE) return process.env.ACME_EXE;
    const preview = fs.readFileSync(path.join(menuDir, 'preview-desktop.ps1'), 'utf8');
    const defaultPath = preview.match(/\$AcmePath\s*=\s*'([^']+)'/)[1];
    const candidates = [defaultPath, ...(process.env.PATH || '').split(path.delimiter)
        .map(directory => path.join(directory, process.platform === 'win32' ? 'acme.exe' : 'acme'))];
    return candidates.find(candidate => fs.existsSync(candidate));
}

// Instruction-level NMOS 6502 probe. It executes actual assembled renderer
// bytes, including self-modifying operands; no renderer algorithm is re-created.
// It deliberately does not model VIC raster timing, SID IRQs, or Teensy IO.
class Cpu6502 {
    constructor(memory) {
        this.m = memory;
        this.a = this.x = this.y = 0;
        this.p = 0x24;
        this.sp = 0xff;
        this.hooks = new Map();
        this.onWrite = () => {};
    }
    nz(value) {
        value &= 255;
        this.p = (this.p & ~0x82) | (value & 0x80) | (value === 0 ? 2 : 0);
        return value;
    }
    flag(mask, condition) { this.p = condition ? this.p | mask : this.p & ~mask; }
    byte() { const value = this.m[this.pc]; this.pc = (this.pc + 1) & 65535; return value; }
    word() { const low = this.byte(); return low | (this.byte() << 8); }
    write(address, value) {
        address &= 65535;
        value &= 255;
        this.onWrite(address, value, this);
        this.m[address] = value;
    }
    push(value) { this.write(0x100 + this.sp, value); this.sp = (this.sp - 1) & 255; }
    pop() { this.sp = (this.sp + 1) & 255; return this.m[0x100 + this.sp]; }
    address(mode) {
        switch (mode) {
        case 'imm': { const result = this.pc; this.pc = (this.pc + 1) & 65535; return result; }
        case 'zp': return this.byte();
        case 'zpx': return (this.byte() + this.x) & 255;
        case 'zpy': return (this.byte() + this.y) & 255;
        case 'abs': return this.word();
        case 'abx': return (this.word() + this.x) & 65535;
        case 'aby': return (this.word() + this.y) & 65535;
        case 'inx': { const p = (this.byte() + this.x) & 255; return this.m[p] | (this.m[(p + 1) & 255] << 8); }
        case 'iny': { const p = this.byte(); return ((this.m[p] | (this.m[(p + 1) & 255] << 8)) + this.y) & 65535; }
        default: throw new Error(`Unsupported addressing mode ${mode}`);
        }
    }
    call(address, limit = 3000000) {
        this.pc = address;
        this.push(0xff);
        this.push(0xfe); // RTS sentinel: $ffff.
        for (let steps = 0; this.pc !== 0xffff; steps++) {
            assert.ok(steps < limit, `6502 step limit at $${this.pc.toString(16)}`);
            this.hooks.get(this.pc)?.(this);
            this.step();
        }
        assert.equal(this.sp, 0xff, 'renderer balances the stack');
    }
    step() {
        const at = this.pc;
        const opcode = this.byte();
        const decoded = opcodes.get(opcode);
        assert.ok(decoded, `Unsupported opcode $${opcode.toString(16)} at $${at.toString(16)}`);
        const [op, mode] = decoded;
        if (op.startsWith('B') && op !== 'BIT') {
            const displacement = this.byte();
            const conditions = { BPL: !(this.p & 128), BMI: this.p & 128, BVC: !(this.p & 64), BVS: this.p & 64,
                BCC: !(this.p & 1), BCS: this.p & 1, BNE: !(this.p & 2), BEQ: this.p & 2 };
            if (conditions[op]) this.pc = (this.pc + (displacement < 128 ? displacement : displacement - 256)) & 65535;
            return;
        }
        const address = mode && mode !== 'acc' ? this.address(mode) : undefined;
        const value = mode === 'acc' ? this.a : this.m[address];
        const store = result => mode === 'acc' ? this.a = this.nz(result) : this.write(address, this.nz(result));
        switch (op) {
        case 'LDA': this.a = this.nz(value); break;
        case 'LDX': this.x = this.nz(value); break;
        case 'LDY': this.y = this.nz(value); break;
        case 'STA': this.write(address, this.a); break;
        case 'STX': this.write(address, this.x); break;
        case 'STY': this.write(address, this.y); break;
        case 'AND': this.a = this.nz(this.a & value); break;
        case 'ORA': this.a = this.nz(this.a | value); break;
        case 'EOR': this.a = this.nz(this.a ^ value); break;
        case 'ADC': case 'SBC': {
            assert.equal(this.p & 8, 0, 'these deterministic probe cases do not use decimal arithmetic');
            const operand = op === 'SBC' ? value ^ 255 : value;
            const sum = this.a + operand + (this.p & 1);
            this.flag(64, (~(this.a ^ operand) & (this.a ^ sum) & 128) !== 0);
            this.flag(1, sum > 255);
            this.a = this.nz(sum);
            break;
        }
        case 'CMP': case 'CPX': case 'CPY': {
            const register = op === 'CMP' ? this.a : op === 'CPX' ? this.x : this.y;
            this.flag(1, register >= value);
            this.nz(register - value);
            break;
        }
        case 'BIT': this.p = (this.p & ~0xc2) | (value & 0xc0) | ((this.a & value) === 0 ? 2 : 0); break;
        case 'ASL': this.flag(1, value & 128); store(value << 1); break;
        case 'LSR': this.flag(1, value & 1); store(value >> 1); break;
        case 'ROL': { const carry = this.p & 1; this.flag(1, value & 128); store((value << 1) | carry); break; }
        case 'ROR': { const carry = this.p & 1; this.flag(1, value & 1); store((value >> 1) | (carry << 7)); break; }
        case 'INC': store(value + 1); break;
        case 'DEC': store(value - 1); break;
        case 'INX': this.x = this.nz(this.x + 1); break;
        case 'DEX': this.x = this.nz(this.x - 1); break;
        case 'INY': this.y = this.nz(this.y + 1); break;
        case 'DEY': this.y = this.nz(this.y - 1); break;
        case 'TAX': this.x = this.nz(this.a); break;
        case 'TAY': this.y = this.nz(this.a); break;
        case 'TXA': this.a = this.nz(this.x); break;
        case 'TYA': this.a = this.nz(this.y); break;
        case 'PHA': this.push(this.a); break;
        case 'PLA': this.a = this.nz(this.pop()); break;
        case 'PHP': this.push(this.p | 0x30); break;
        case 'PLP': this.p = this.pop() | 0x20; break;
        case 'CLC': this.p &= ~1; break;
        case 'SEC': this.p |= 1; break;
        case 'SEI': this.p |= 4; break;
        case 'CLI': this.p &= ~4; break;
        case 'CLD': this.p &= ~8; break;
        case 'SED': this.p |= 8; break;
        case 'JMP': this.pc = address; break;
        case 'JSR': this.push((this.pc - 1) >> 8); this.push(this.pc - 1); this.pc = address; break;
        case 'RTS': { const low = this.pop(); this.pc = ((low | (this.pop() << 8)) + 1) & 65535; break; }
        case 'NOP': break;
        default: throw new Error(`Unsupported instruction ${op}`);
        }
    }
}

const opcodes = new Map();
for (const [operation, modes, codes] of [
    ['LDA', 'inx,zp,imm,abs,iny,zpx,aby,abx', 'a1,a5,a9,ad,b1,b5,b9,bd'],
    ['LDX', 'imm,zp,abs,zpy,aby', 'a2,a6,ae,b6,be'], ['LDY', 'imm,zp,abs,zpx,abx', 'a0,a4,ac,b4,bc'],
    ['STA', 'inx,zp,abs,iny,zpx,aby,abx', '81,85,8d,91,95,99,9d'],
    ['STX', 'zp,abs,zpy', '86,8e,96'], ['STY', 'zp,abs,zpx', '84,8c,94'],
    ['AND', 'inx,zp,imm,abs,iny,zpx,aby,abx', '21,25,29,2d,31,35,39,3d'],
    ['ORA', 'inx,zp,imm,abs,iny,zpx,aby,abx', '01,05,09,0d,11,15,19,1d'],
    ['EOR', 'inx,zp,imm,abs,iny,zpx,aby,abx', '41,45,49,4d,51,55,59,5d'],
    ['ADC', 'inx,zp,imm,abs,iny,zpx,aby,abx', '61,65,69,6d,71,75,79,7d'],
    ['SBC', 'inx,zp,imm,abs,iny,zpx,aby,abx', 'e1,e5,e9,ed,f1,f5,f9,fd'],
    ['CMP', 'inx,zp,imm,abs,iny,zpx,aby,abx', 'c1,c5,c9,cd,d1,d5,d9,dd'],
    ['CPX', 'imm,zp,abs', 'e0,e4,ec'], ['CPY', 'imm,zp,abs', 'c0,c4,cc'], ['BIT', 'zp,abs', '24,2c'],
    ['ASL', 'zp,acc,abs,zpx,abx', '06,0a,0e,16,1e'], ['ROL', 'zp,acc,abs,zpx,abx', '26,2a,2e,36,3e'],
    ['LSR', 'zp,acc,abs,zpx,abx', '46,4a,4e,56,5e'], ['ROR', 'zp,acc,abs,zpx,abx', '66,6a,6e,76,7e'],
    ['DEC', 'zp,abs,zpx,abx', 'c6,ce,d6,de'], ['INC', 'zp,abs,zpx,abx', 'e6,ee,f6,fe'],
    ['JMP', 'abs', '4c'], ['JSR', 'abs', '20'],
]) codes.split(',').forEach((code, index) => opcodes.set(parseInt(code, 16), [operation, modes.split(',')[index]]));
for (const entry of '10:BPL 30:BMI 50:BVC 70:BVS 90:BCC b0:BCS d0:BNE f0:BEQ e8:INX ca:DEX c8:INY 88:DEY aa:TAX a8:TAY 8a:TXA 98:TYA 48:PHA 68:PLA 08:PHP 28:PLP 18:CLC 38:SEC 78:SEI 58:CLI d8:CLD f8:SED 60:RTS ea:NOP'.split(' ')) {
    const [code, operation] = entry.split(':');
    opcodes.set(parseInt(code, 16), [operation]);
}

test('assembled renderer stages colors and preserves live selection', async t => {
    const acme = findAssembler();
    if (!acme) return t.skip('ACME assembler unavailable; set ACME_EXE to run instruction-level checks');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'teensyrom-color-test-'));
    try {
        const binaryPath = path.join(temporary, 'desktop.bin');
        const symbolsPath = path.join(temporary, 'symbols');
        const result = spawnSync(acme, ['--format', 'plain', '--symbollist', symbolsPath, '--outfile', binaryPath,
            'source/DesktopShellCode.asm'], { cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const parseSymbols = file => Object.fromEntries([...fs.readFileSync(file, 'utf8').matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)]
            .map(match => [match[1], parseInt(match[2], 16)]));
        const symbols = parseSymbols(symbolsPath);
        const image = fs.readFileSync(binaryPath);
        t.diagnostic(`Assembled desktop: ${image.length} bytes; ${0xa000 - symbols.MainCodeRAMEnd} bytes below BASIC remain`);
        const settingsSource = path.join(temporary, 'settings.asm');
        const settingsBinary = path.join(temporary, 'settings.bin');
        const settingsSymbols = path.join(temporary, 'settings-symbols');
        fs.writeFileSync(settingsSource, fs.readFileSync(path.join(menuDir, 'source/GeosSettings.asm'), 'utf8')
            .replace('"build/DesktopSymbols"', JSON.stringify(symbolsPath.replaceAll('\\', '/'))));
        const settingsResult = spawnSync(acme, ['--format', 'plain', '--symbollist', settingsSymbols,
            '--outfile', settingsBinary, settingsSource],
            { cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true });
        assert.equal(settingsResult.status, 0, settingsResult.stdout + settingsResult.stderr);
        Object.assign(symbols, parseSymbols(settingsSymbols));
        const settings = fs.readFileSync(settingsBinary);
        const appsSource = path.join(temporary, 'apps.asm');
        const appsBinary = path.join(temporary, 'apps.bin');
        fs.writeFileSync(appsSource, fs.readFileSync(path.join(menuDir, 'source/GeosApps.asm'), 'utf8')
            .replace(/"build\/(?:vice-preview\/)?DesktopSymbols"/g, JSON.stringify(symbolsPath.replaceAll('\\', '/'))));
        const appsResult = spawnSync(acme, ['--format', 'plain', '-DPreviewApps=1', '--outfile', appsBinary, appsSource],
            { cwd: menuDir, encoding: 'utf8', timeout: 30000, windowsHide: true });
        assert.equal(appsResult.status, 0, appsResult.stdout + appsResult.stderr);
        const apps = fs.readFileSync(appsBinary);
        assert.ok(apps.length <= 4096, `apps use ${apps.length}/4096 bytes`);
        t.diagnostic(`Assembled apps: ${apps.length}/4096 bytes`);
        const fresh = () => {
            const memory = Buffer.alloc(65536);
            image.copy(memory, symbols.MainCodeRAMStart);
            apps.copy(memory, 0xc000);
            settings.copy(memory, symbols.GeosSettingsBase);
            return new Cpu6502(memory);
        };
        const stub = (cpu, name, hook = () => {}) => {
            cpu.m[symbols[name]] = 0x60;
            cpu.hooks.set(symbols[name], hook);
        };
        const prepareBrowser = (cpu, count = 16, surface = 1) => {
            cpu.m[symbols.GeosViewMode] = 1;
            cpu.m[symbols.GeosSurfaceMode] = surface;
            cpu.m[symbols.GeosBitmapActive] = 1;
            cpu.m[symbols.rRegNumItemsOnPage + symbols.IO1Port] = count;
            cpu.m[symbols.GeosIECCount] = count;
            for (let item = 0; item < count; item++) {
                Buffer.from('ABCDEFGHIJKLMNOPQRSTUV\0').copy(cpu.m, symbols.GeosRichFileLabels + item * 23);
            }
        };


        await t.test('browser selection changes bounded label pixels without changing colors or masking IRQ', () => {
            for (const surface of [1, 2]) for (const [from, target] of [[0,19],[19,1],[5,6]]) {
                const cpu = fresh();
                prepareBrowser(cpu,symbols.DesktopViewportItems,surface);
                cpu.m[1]=0x37;
                cpu.p &= ~4;
                cpu.m[symbols.GeosBitmapSelectedItem]=from;
                cpu.m[symbols.rwRegCursorItemOnPg+symbols.IO1Port]=from;
                cpu.m[symbols.GeosIECSelection]=from;
                cpu.call(symbols.GeosRichFileNames);
                cpu.call(symbols.GeosRichPublish);
                const before=Buffer.from(cpu.m.subarray(0x2000,0x3f40));
                const allowed=new Set();
                assert.deepEqual([...cpu.m.subarray(symbols.BrowserColumnX, symbols.BrowserColumnX + 4)], [8,80,152,224]);
                assert.deepEqual([...cpu.m.subarray(symbols.BrowserRowY, symbols.BrowserRowY + 5)], [36,68,100,132,164]);
                for(const item of [from,target]) {
                    const x=cpu.m[symbols.BrowserColumnX+(item%4)]+1;
                    const y=cpu.m[symbols.BrowserRowY+Math.floor(item/4)]+16;
                    for(let row=y;row<y+16;row++)for(let col=x>>3;col<=(x+69)>>3;col++)
                        allowed.add(0x2000+(row>>3)*320+col*8+(row&7));
                }
                let writes=0,steps=0;
                const step=cpu.step.bind(cpu);
                cpu.step=()=>{ assert.equal(cpu.p&4,0,'selection leaves IRQ enabled');steps++;step(); };
                cpu.onWrite=address=>{
                    if(address>=0x2000&&address<0x3f40){assert.ok(allowed.has(address));writes++;}
                    assert.ok(address<0x0400||address>=0x0800,'selection keeps palette and sprite pointers');
                };
                for(const name of ['GeosShellRedraw','GeosRichPublish','GeosBitmapConvertScreen'])
                    stub(cpu,name,()=>assert.fail('selection cannot run '+name));
                cpu.m[symbols.rwRegCursorItemOnPg+symbols.IO1Port]=target;
                cpu.m[symbols.GeosIECSelection]=target;
                cpu.call(symbols.GeosBitmapRefreshBrowserSelection);
                assert.ok(writes>0 && writes<1600,'bounded label pixel writes');
                assert.ok(steps<45000,steps+' selection instructions');
                for(let address=0x2000;address<0x3f40;address++) if(!allowed.has(address))
                    assert.equal(cpu.m[address],before[address-0x2000]);
                assert.equal(cpu.m[symbols.GeosBitmapSelectedItem],target);
                assert.equal(cpu.m[1],0x37);
                assert.equal(cpu.m[symbols.RichMirrorMode],0x60);
                writes=0;cpu.call(symbols.GeosBitmapRefreshBrowserSelection);assert.equal(writes,0,'same selection has no redraw');
            }
        });

        await t.test('clicking the selected home icon arms and opens without redrawing or hiding the pointer', () => {
            const cpu = fresh();
            prepareBrowser(cpu, 16, 0);
            cpu.p &= ~4;
            cpu.m[symbols.MouseActive] = 1;
            cpu.m[symbols.MouseLeftDown] = 1;
            cpu.m[symbols.SpriteEnable] = 1;
            const slot = cpu.m[symbols.TblGeosHomeIconSlot];
            const x = cpu.m[symbols.RichSlotX + slot] + cpu.m[symbols.RichSlotXHi + slot] * 256;
            cpu.m[symbols.MouseLogicalX] = x / 2 + 4;
            cpu.m[symbols.MouseLogicalY] = cpu.m[symbols.RichSlotY + slot] + 4;
            for (const label of ['GeosShellRedraw', 'ListMenuItems', 'GeosBitmapConvertScreen']) {
                stub(cpu, label, () => assert.fail(`unchanged home selection must not call ${label}`));
            }
            cpu.onWrite = (address, value) => {
                assert.ok(address < 0x2000 || address >= 0x3f40, 'home focus keeps the bitmap');
                assert.ok(address < 0x0400 || address >= 0x07e8, 'home focus keeps the palette');
                if (address === symbols.SpriteEnable) assert.equal(value, 1);
            };
            for (let click = 0; click < 2; click++) {
                cpu.m[symbols.MouseClickEdge] = 1;
                cpu.call(symbols.Mouse1351ProcessMenu);
                assert.equal(cpu.p & 1, click, 'first click arms and second click returns the launch key');
                assert.equal(cpu.m[symbols.GeosHomeSelection], 0);
            }
            assert.equal(cpu.a, symbols.ChrReturn);
        });

        await t.test('changing home focus mirrors only authored labels and footer, then restores normal staging', () => {
            for (const [from, target, moved, slot, maskedOnEntry] of [[0, 7, 7, 14, false], [7, 6, 6, 9, true], [4, 1, 4, 10, false]]) {
                const cpu = fresh(), expected = fresh();
                for (const machine of [cpu, expected]) {
                    machine.m[1] = 0x37;
                    machine.m[symbols.GeosViewMode] = 1;
                    machine.m[symbols.TblGeosHomeIconSlot + moved] = slot;
                }
                cpu.m[symbols.GeosHomeSelection] = from;
                cpu.call(symbols.GeosRichHome);
                cpu.call(symbols.GeosRichPublish);
                cpu.call(symbols.GeosBitmapPublishColors);
                expected.m[symbols.GeosHomeSelection] = target;
                expected.call(symbols.GeosRichHome);
                const expectedPixels = Buffer.from(expected.m.subarray(0xa000, 0xbf40));
                cpu.m[symbols.GeosBitmapActive] = 1;
                cpu.m[symbols.MouseActive] = 1;
                cpu.m[symbols.MouseLeftDown] = 1;
                cpu.m[symbols.MouseClickEdge] = 1;
                cpu.m[symbols.SpriteEnable] = 1;
                const targetSlot = cpu.m[symbols.TblGeosHomeIconSlot + target];
                const iconX = index => cpu.m[symbols.RichSlotX + index] + cpu.m[symbols.RichSlotXHi + index] * 256;
                cpu.m[symbols.MouseLogicalX] = iconX(targetSlot) / 2 + 4;
                cpu.m[symbols.MouseLogicalY] = cpu.m[symbols.RichSlotY + targetSlot] + 4;
                cpu.p = maskedOnEntry ? 0x24 : 0x20;
                const allowed = new Set();
                for (const item of [from, target]) {
                    const location = cpu.m[symbols.TblGeosHomeIconSlot + item];
                    const x = (iconX(location) - 16) & ~7;
                    const top = (cpu.m[symbols.RichSlotY + location] + 19) >> 3;
                    for (let row = top; row < top + 3; row++) for (let byte = 0; byte < 64; byte++) allowed.add(0x2000 + row * 320 + x + byte);
                }
                for (let address = 0x3cc0; address < 0x3f40; address++) allowed.add(address);
                let writes = 0, steps = 0;
                const step = cpu.step.bind(cpu);
                cpu.step = () => { steps++; step(); };
                cpu.onWrite = (address, value) => {
                    if (address >= 0x2000 && address < 0x3f40) {
                        assert.ok(allowed.has(address), `home update stays in labels/footer: $${address.toString(16)}`);
                        writes++;
                    }
                    assert.ok(address < 0x0400 || address >= 0x07e8, 'home update does not recolor the surface');
                    if (address === symbols.SpriteEnable) assert.equal(value, 1, 'pointer remains visible');
                };
                for (const label of ['GeosShellRedraw', 'ListMenuItems', 'GeosInstallMonoCharset', 'GeosRichPublish', 'RichHomeIcon']) {
                    stub(cpu, label, () => assert.fail(`home selection must not call ${label}`));
                }
                cpu.call(symbols.Mouse1351ProcessMenu);
                assert.equal(cpu.m[symbols.GeosHomeSelection], target);
                assert.equal(cpu.p & 1, 0, 'first click changes focus without launching');
                assert.equal(cpu.m[symbols.MouseOpenArmed], 1);
                assert.deepEqual(cpu.m.subarray(0x2000, 0x3f40), expectedPixels, 'live pixels equal a fresh complete render');
                assert.deepEqual(cpu.m.subarray(0xa000, 0xbf40), expectedPixels, 'native canvas remains coherent');
                assert.equal(cpu.m[symbols.RichMirrorMode], 0x60, 'ordinary rendering returns before the mirror');
                assert.equal(cpu.m[1], 0x37);
                assert.equal(cpu.p & 4, maskedOnEntry ? 4 : 0, 'caller IRQ state restored');
                assert.ok(writes > 0 && writes < 1800, `bounded live pixel writes: ${writes}`);
                assert.ok(steps < 55000, `bounded home selection work: ${steps} instructions`);
                t.diagnostic(`Home ${from}->${target}: ${steps} instructions, ${writes} bounded pixel writes`);
            }
        });

        await t.test('control highlight publishes only two label rectangles within a bounded IRQ interval', () => {
            for (const [mode, from, target] of [[0, 0, 1], [0, 2, 8], [0, 8, 3], [9, 0, 4]]) {
                const cpu = fresh();
                cpu.m[1] = 0x37;
                cpu.m[symbols.GeosControlMode] = mode;
                cpu.m[symbols.GeosControlSelection] = from;
                cpu.m[symbols.GeosOverlayMode] = symbols.GeosOverlayControl;
                cpu.call(symbols.GeosControlDraw);
                cpu.call(symbols.GeosRichPublish);
                cpu.call(symbols.GeosBitmapPublishColors);
                cpu.p &= ~4;
                const before = Buffer.from(cpu.m.subarray(0x2000, 0x3f40));
                const expected = new Set();
                for (const item of [from, target]) {
                    const x = cpu.m[symbols.GeosControlX + mode + item] - 24;
                    const row = (cpu.m[symbols.GeosControlY + mode + item] + 19) >> 3;
                    const top=cpu.m[symbols.GeosControlY + mode + item]+19;
                    for(let y=top;y<top+9;y++)for(let col=x>>3;col<=(x+71)>>3;col++)expected.add(0x2000+(y>>3)*320+col*8+(y&7));
                }
                let instructions = 0, masked = 0, maxMasked = 0;
                const step = cpu.step.bind(cpu);
                cpu.step = () => {
                    instructions++;
                    masked = cpu.p & 4 ? masked + 1 : 0;
                    maxMasked = Math.max(maxMasked, masked);
                    step();
                };
                const writes = [];
                cpu.onWrite = address => {
                    if (address >= 0x2000 && address < 0x3f40) {
                        assert.ok(expected.has(address), `only old/new label rows publish: $${address.toString(16)}`);
                        writes.push(address);
                    }
                    if(address>=0x0400&&address<0x0800){assert.ok(address<0x07e8,'pointer padding untouched');assert.equal(cpu.m[address],0x01,'monochrome palette remains unchanged');}
                };
                stub(cpu, 'GeosRichPublish', () => assert.fail('selection must not scan all 8000 bitmap bytes'));
                stub(cpu, 'GeosShellRedraw', () => assert.fail('selection must not rebuild the desktop'));
                cpu.a = target;
                cpu.call(symbols.GeosControlSetSelection);
                assert.equal(writes.length, expected.size, 'only the exact changed label scanlines publish');
                assert.deepEqual(new Set(writes), expected);
                assert.ok(instructions < 25000, `bounded selection work: ${instructions} instructions`);
                assert.ok(maxMasked < 25000, `bounded masked interval: ${maxMasked} instructions`);
                for (let address = 0x2000; address < 0x3f40; address++) {
                    assert.equal(cpu.m[address], expected.has(address) ? cpu.m[address + 0x8000] : before[address - 0x2000]);
                }
                assert.equal(cpu.m[1], 0x37);
                assert.equal(cpu.p & 4, 0);
                writes.length = 0;
                cpu.a = target;
                cpu.call(symbols.GeosControlSetSelection);
                assert.equal(writes.length, 0, 'already selected control has no publication');
            }
        });



        await t.test('notice panels consume activation and IEC status can be dismissed without immediately reopening', () => {
            for (const input of ['key', 'mouse', 'fire', 'Up', 'Down', 'Left', 'Right']) {
                const cpu = fresh();
                prepareBrowser(cpu);
                stub(cpu, 'GeosShellRedraw');
                cpu.m[symbols.GeosOverlayMode] = symbols.GeosOverlayNotice;
                cpu.m[symbols.GeosNotice] = symbols.GeosNoticeFileScope;
                cpu.m[symbols.rwRegCursorItemOnPg + symbols.IO1Port] = 15;
                if (input === 'key') {
                    cpu.a = symbols.ChrReturn;
                    cpu.call(symbols.GeosShellHandleKey);
                    assert.equal(cpu.p & 1, 1);
                } else if (input === 'mouse') {
                    cpu.x = 34;
                    cpu.y = 19;
                    cpu.m[symbols.MouseFrameX] = 138;
                    cpu.m[symbols.MouseFrameY] = 154;
                    cpu.call(symbols.GeosShellMouseClick);
                    assert.equal(cpu.p & 1, 0);
                } else cpu.call(symbols[input === 'fire' ? 'GeosShellSelectItem' : `GeosShellCursor${input}`]);
                assert.equal(cpu.m[symbols.rwRegCursorItemOnPg + symbols.IO1Port], 15, `${input} never changes covered selection`);
                if (['key', 'mouse', 'fire'].includes(input)) {
                    assert.equal(cpu.m[symbols.GeosOverlayMode], 0);
                    assert.equal(cpu.m[symbols.GeosNotice], 0);
                } else assert.equal(cpu.m[symbols.GeosOverlayMode], symbols.GeosOverlayNotice);
            }
            for (const error of [0, 1]) {
                const cpu = fresh();
                prepareBrowser(cpu, 0, 2);
                stub(cpu, 'GeosBitmapConvertScreen');
                stub(cpu, 'GeosShellRedraw');
                let messages = 0;
                stub(cpu, 'GeosBitmapShowMessage', () => { messages++; });
                cpu.m[symbols.GeosIECError] = error;
                cpu.call(symbols.GeosIECDrawStatus);
                assert.equal(messages, 1);
                assert.equal(cpu.m[symbols.GeosOverlayMode], symbols.GeosOverlayNotice);
                cpu.a = symbols.ChrHome;
                cpu.call(symbols.GeosShellHandleKey);
                assert.equal(cpu.m[symbols.GeosOverlayMode], 0);
                cpu.call(symbols.GeosIECDrawStatus);
                assert.equal(messages, 1, 'dismissal redraw does not reopen empty/error notice');
                cpu.a = symbols.ChrHome;
                cpu.call(symbols.GeosShellHandleKey);
                assert.equal(cpu.m[symbols.GeosSurfaceMode], 0, 'HOME remains available after dismissing an empty drive');
            }
        });

        await t.test('About renders its version, credits, website, and standard window chrome', () => {
            const cpu = fresh();
            const lines = [];
            cpu.m.fill(0xa5, 0x0400, 0x0800);
            cpu.hooks.set(symbols.RichText, () => {
                const start = cpu.a | (cpu.y << 8);
                let text = '';
                for (let address = start; cpu.m[address]; address++) {
                    text += String.fromCharCode(cpu.m[address] & 0x7f);
                }
                const x = cpu.m[symbols.RichX] | (cpu.m[symbols.RichXHi] << 8);
                const y = cpu.m[symbols.RichY];
                assert.ok(x >= 41 && x + text.length * 6 <= 279, `${text} fits horizontally`);
                assert.ok(y >= 49 && y + 7 <= 151, `${text} fits vertically`);
                lines.push(text);
            });
            cpu.onWrite = address => {
                assert.ok(address < 0x0400 || address >= 0x0800, 'About preserves live colors and sprite pointers');
            };
            cpu.call(symbols.GeosRichAbout);
            assert.deepEqual(lines, [
                `MPE FIRMWARE V${JSON.parse(fs.readFileSync(path.resolve(menuDir, '../../../firmware-version.json'), 'utf8')).version}`,
                'JOHN SWIDERSKI', 'MEAN HAMSTER SOFTWARE',
                'BASED ON TEENSYROM+', 'www.MeanHamster.Com',
            ]);
            assert.match(rich, /GeosRichAbout:[\s\S]*?jsr UiWindow[\s\S]*?RichAboutLine:/,
                'About uses the shared title band and X control');
            assert.ok(cpu.m.subarray(0xa000, 0xbf40).some(value => value !== 0), 'native bitmap contains the panel');
            assert.deepEqual(cpu.m.subarray(0x0400, 0x0800), Buffer.alloc(1024, 0xa5));
        });

        await t.test('About consumes shortcuts and navigation until keyboard, fire, or its X closes it', () => {
            const about = () => {
                const cpu = fresh();
                cpu.m[symbols.GeosShellRedraw] = 0x60;
                cpu.m[symbols.GeosViewMode] = 1;
                cpu.m[symbols.GeosHomeSelection] = 3;
                cpu.call(symbols.GeosDeskAbout);
                assert.equal(cpu.m[symbols.GeosOverlayMode], symbols.GeosOverlayAbout);
                return cpu;
            };
            for (const key of ['ChrF1', 'ChrF2', 'ChrF3', 'ChrF4', 'ChrF5', 'ChrF6', 'ChrF7', 'ChrF8']) {
                const cpu = about();
                cpu.a = symbols[key];
                cpu.call(symbols.GeosShellHandleKey);
                assert.equal(cpu.p & 1, 1, `${key} is consumed`);
                assert.equal(cpu.m[symbols.GeosOverlayMode], symbols.GeosOverlayAbout);
            }
            for (const direction of ['Up', 'Down', 'Left', 'Right']) {
                const cpu = about();
                cpu.call(symbols[`GeosShellCursor${direction}`]);
                assert.equal(cpu.p & 1, 1);
                assert.equal(cpu.m[symbols.GeosHomeSelection], 3, `${direction} does not move a covered icon`);
            }
            for (const key of ['ChrReturn', 'ChrStop', 'ChrRun', 'ChrSpace']) {
                const cpu = about();
                cpu.a = symbols[key];
                cpu.call(symbols.GeosShellHandleKey);
                assert.equal(cpu.p & 1, 1);
                assert.equal(cpu.m[symbols.GeosOverlayMode], symbols.GeosOverlayNone, `${key} closes About`);
            }
            const fire = about();
            fire.call(symbols.GeosShellSelectItem);
            assert.equal(fire.m[symbols.GeosOverlayMode], symbols.GeosOverlayNone, 'joystick fire closes About');
            const outside = about();
            outside.m[symbols.MouseFrameX] = 10;
            outside.m[symbols.MouseFrameY] = 20;
            outside.call(symbols.GeosShellMouseClick);
            assert.equal(outside.m[symbols.GeosOverlayMode], symbols.GeosOverlayAbout, 'ordinary panel clicks do not close About');
            const close = about();
            close.m[symbols.MouseFrameX] = 135;
            close.m[symbols.MouseFrameY] = 55;
            close.call(symbols.GeosShellMouseClick);
            assert.equal(close.m[symbols.GeosOverlayMode], symbols.GeosOverlayNone, 'the standard X closes About');
            assert.equal(close.m[symbols.GeosHomeSelection], 3);
        });

        await t.test('publisher copies exactly 1000 color bytes and skips unchanged cells', () => {
            const cpu = fresh();
            cpu.m.fill(0xa5, 0x0400, 0x0800);
            cpu.m.fill(0x5a, 0x4000, 0x4400);
            const expected = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 128));
            expected.copy(cpu.m, 0x4000);
            const sourceBefore = Buffer.from(cpu.m.subarray(0x4000, 0x4400));
            let writes = 0;
            cpu.onWrite = address => {
                if (address >= 0x0400 && address < 0x0800) {
                    assert.ok(address < 0x07e8, `publisher must preserve screen guard $${address.toString(16)}`);
                    writes++;
                }
            };
            cpu.m[symbols.GeosBitmapColorOffset] = 0x3c;
            cpu.call(symbols.GeosBitmapPublishColors);
            assert.equal(writes, 1000);
            assert.deepEqual(cpu.m.subarray(0x0400, 0x07e8), expected);
            assert.deepEqual(cpu.m.subarray(0x07e8, 0x0800), Buffer.alloc(24, 0xa5));
            assert.deepEqual(cpu.m.subarray(0x4000, 0x4400), sourceBefore);
            assert.equal(cpu.m[symbols.GeosBitmapColorOffset], 0);
            writes = 0;
            cpu.call(symbols.GeosBitmapPublishColors);
            assert.equal(writes, 0, 'unchanged colors do not get republished');
        });





        await t.test('surface initialization sets exactly1000 staged colors including the footer', () => {
            const cpu=fresh();
            cpu.m.fill(0xa5,0x0400,0x0800);
            cpu.m.fill(0x5a,0x4000,0x4400);
            const writes=[];
            cpu.onWrite=address=>{
                if(address>=0x4000&&address<0x4400){assert.ok(address<0x43e8);writes.push(address);}
                assert.ok(address<0x0400||address>=0x0800,'initialization must not publish colors');
            };
            cpu.call(symbols.GeosBitmapTintSurface);
            assert.equal(new Set(writes).size,1000);
            assert.deepEqual(cpu.m.subarray(0x4000,0x43e8),Buffer.alloc(1000,1));
            assert.deepEqual(cpu.m.subarray(0x43e8,0x4400),Buffer.alloc(24,0x5a));
        });

        await t.test('browser full redraw clears old app pixels and preserves its complete bottom border', () => {
            const clean=fresh(),dirty=fresh();
            for(const cpu of [clean,dirty]) {
                prepareBrowser(cpu);
                cpu.m[1]=0x37;
                cpu.m[symbols.GeosBitmapSelectedItem]=0xff;
                cpu.m[symbols.rRegViewCountLo+symbols.IO1Port]=28;
                cpu.call(symbols.GeosBrowserReadState);
            }
            dirty.m.fill(0xa5,0xa000,0xc000);
            dirty.m.fill(0x5a,0x2000,0x3f40);
            clean.call(symbols.GeosBitmapConvertScreen);
            dirty.call(symbols.GeosBitmapConvertScreen);
            assert.deepEqual(dirty.m.subarray(0x2000,0x3f40),clean.m.subarray(0x2000,0x3f40));
            assert.deepEqual(dirty.m.subarray(0x0400,0x07e8),clean.m.subarray(0x0400,0x07e8));
            for(let x=4;x<316;x++) {
                const address=0x2000+(199>>3)*320+(x>>3)*8+(199&7);
                assert.ok(dirty.m[address]&(128>>(x&7)),`bottom border pixel${x},199`);
            }
        });

        for (const [name, surface, overlay, activeMenu] of [
            ['home', 0, 0, 0], ['home menu', 0, 1, 1], ['home control panel', 0, 2, 0],
            ['home About', 0, 4, 0], ['browser About', 1, 4, 0],
            ['browser', 1, 0, 0], ['browser menu', 1, 1, 4], ['IEC browser', 2, 0, 0], ['IEC menu', 2, 1, 2],
        ]) await t.test(`${name}: no visible palette write until all 8000 bitmap bytes are published`, () => {
            const cpu = fresh();
            cpu.m[1] = 0x37;
            cpu.m[symbols.GeosSurfaceMode] = surface;
            cpu.m[symbols.GeosOverlayMode] = overlay;
            cpu.m[symbols.GeosActiveMenu] = activeMenu;
            cpu.m[symbols.GeosBitmapLayoutPass] = 1;
            cpu.m[symbols.GeosBitmapSelectedItem] = 0; // Prior frame must not affect the new page.
            cpu.m[symbols.GeosViewMode] = 1;
            cpu.m[symbols.GeosIECCount] = 16;
            cpu.m[symbols.GeosIECSelection] = 15;
            cpu.m[symbols.rRegNumItemsOnPage + symbols.IO1Port] = 16;
            cpu.m[symbols.rwRegCursorItemOnPg + symbols.IO1Port] = 15;
            cpu.m[symbols.TODHoursBCD] = 0x10;
            cpu.m[symbols.smc24HourClockDisp + 1] = 0;
            cpu.m.fill(0xa5, 0x0400, 0x0800);
            cpu.m.fill(0x3c, 0x2000, 0x3f40);
            for (let index = 0; index < 1000; index++) cpu.m[0x4000 + index] = (index * 7) & 255;
            for (let index = 0; index < 1024; index++) cpu.m[0x4400 + index] = (index * 13) & 255;
            for (let item = 0; item < 16; item++) Buffer.from(`FILE ${item} SECOND ROW\0`).copy(cpu.m, symbols.GeosRichFileLabels + item * 23);
            const fontBefore = Buffer.from(cpu.m.subarray(0x4400, 0x4800));
            let bitmapPublished = false;
            let publishCalls = 0;
            let finalColors;
            let finalBitmap;
            let menuPaints = 0;
            cpu.hooks.set(symbols.GeosRichPublish, () => {
                assert.deepEqual(cpu.m.subarray(0x0400, 0x07e8), Buffer.alloc(1000, 0xa5));
                finalColors = Buffer.from(cpu.m.subarray(0x4000, 0x43e8));
                finalBitmap = Buffer.from(cpu.m.subarray(0xa000, 0xbf40));
            });
            cpu.hooks.set(symbols.GeosBitmapPublishColors, () => {
                assert.ok(finalBitmap, 'bitmap publication occurs first');
                assert.deepEqual(cpu.m.subarray(0x2000, 0x3f40), finalBitmap);
                bitmapPublished = true;
                publishCalls++;
            });
            cpu.hooks.set(symbols.GeosMenuPaint, () => {
                assert.equal(publishCalls, 1, 'base frame and colors precede the transient menu');
                assert.deepEqual(cpu.m.subarray(0x2000, 0x3f40), finalBitmap);
                assert.deepEqual(cpu.m.subarray(0x0400, 0x07e8), finalColors);
                menuPaints++;
            });
            cpu.onWrite = address => {
                if (address >= 0x0400 && address < 0x07e8) assert.ok(bitmapPublished, `early color write $${address.toString(16)}`);
                if (address >= 0x07e8 && address < 0x0800) assert.equal(address, symbols.Sprite0Pointer, 'only the explicit pointer setup may touch screen padding');
            };
            cpu.call(symbols.GeosBitmapConvertScreen);
            assert.equal(cpu.m[symbols.GeosBitmapSelectedItem], surface !== 0 && overlay === 0 ? 15 : 0xff,
                'full composition invalidates and rebuilds the live selection cache');
            assert.equal(publishCalls, 1);
            assert.deepEqual(cpu.m.subarray(0x0400, 0x07e8), finalColors);
            assert.equal(menuPaints, overlay === 1 ? 1 : 0);
            assert.deepEqual(cpu.m.subarray(0xa000, 0xbf40), finalBitmap, 'transient menu preserves the base canvas');
            if (overlay === 1) {
                assert.deepEqual(cpu.m.subarray(0x2000 + 3840, 0x3f40), finalBitmap.subarray(3840),
                    'menu stays in its top96 scanlines; full overlay pixels are checked by menu-latency tests');
            } else assert.deepEqual(cpu.m.subarray(0x2000, 0x3f40), finalBitmap);
            assert.deepEqual(cpu.m.subarray(0x4400, 0x4800), fontBefore);
            assert.equal(cpu.m[symbols.GeosBitmapColorOffset], 0);
            assert.equal(cpu.m[1], 0x37, 'BASIC bank restored');
            assert.equal(cpu.m[0xd011] & 0x60, 0x20, 'standard bitmap mode');
            assert.equal(cpu.m[0xd016] & 0x10, 0, 'multicolor stays off');
        });
    } finally {
        // The target is the exact directory created by mkdtemp above.
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
