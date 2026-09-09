'use strict';

// Execute the app's actual assembly instructions, not a second Snake model.
// The host still owns real assembly, VIC-II rendering and hardware acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../source/GeosAppSnake.s'), 'utf8');

function machine() {
    const memory = new Uint8Array(65536);
    const symbols = {};
    const instructions = new Map();
    const anonymous = [];
    const data = [];
    const draws = [];
    let address = 0xc000;
    for (const line of source.split(/\r?\n/)) {
        let code = line.replace(/;.*/, '').trim();
        if (!code) continue;
        const label = code.match(/^(Snake\w+):\s*(.*)$/);
        if (label) { symbols[label[1]] = address; code = label[2]; }
        if (/^[+-]/.test(code)) {
            anonymous.push({ name: code[0], address });
            code = code.slice(1).trim();
        }
        if (!code) continue;
        if (code.startsWith('!')) {
            const [kind, args] = code.split(/\s+(.+)/);
            const values = kind === '!text'
                ? [...args.match(/^"([^"]*)"/)[1]].map(c => c.charCodeAt(0)).concat(0)
                : kind === '!fill' ? Array(Number(args.split(',')[0])).fill(0)
                    : args.split(',');
            data.push({ address, values });
            address += values.length;
            continue;
        }
        const [op, arg = ''] = code.split(/\s+(.+)/);
        const size = !arg ? 1 : /^(b(eq|ne|cc|cs|pl)|.*#)/.test(op + arg) ? 2 : 3;
        instructions.set(address, { op, arg, size });
        address += size;
    }
    let externalAddress = 0x200;
    function value(expr) {
        expr = expr.trim();
        if (expr.startsWith('<')) return value(expr.slice(1)) & 255;
        if (expr.startsWith('>')) return value(expr.slice(1)) >> 8;
        if (/^'.'$/.test(expr)) {
            const code = expr.charCodeAt(1);
            // The parent GeosApps.asm uses ACME !convtab pet: lowercase ASCII
            // literals become unshifted uppercase PETSCII, uppercase shift high.
            return code >= 97 && code <= 122 ? code - 32
                : code >= 65 && code <= 90 ? code + 128 : code;
        }
        const term = expr.match(/^(.+?)([+-])(\d+)$/);
        if (term) return value(term[1]) + Number(term[3]) * (term[2] === '+' ? 1 : -1);
        if (/^\$/.test(expr)) return parseInt(expr.slice(1), 16);
        if (/^\d+$/.test(expr)) return Number(expr);
        if (!(expr in symbols)) { symbols[expr] = externalAddress; externalAddress += 2; }
        return symbols[expr];
    }
    for (const record of data) record.values.forEach((v, i) => {
        memory[record.address + i] = typeof v === 'number' ? v : value(v);
    });
    symbols.AppPosition = 0xff00;
    symbols.RichRect = 0xff03;
    function get(name) { return memory[value(name)]; }
    function set(name, v) { memory[value(name)] = v; }
    function run(label, inputs = {}) {
        let a = inputs.a ?? 0, x = inputs.x ?? 0, y = inputs.y ?? 0;
        let c = 0, z = 0, n = 0, pc = symbols[label], steps = 0;
        const returns = [], stack = [];
        const flags = v => { z = (v & 255) === 0; n = (v & 128) !== 0; return v & 255; };
        while (++steps < 20000) {
            if (pc === symbols.AppPosition || pc === symbols.RichRect) {
                if (pc === symbols.AppPosition) {
                    set('RichX', x); set('RichXHi', 0); set('RichY', y); set('RichInk', 255);
                    a = flags(255);
                } else {
                    draws.push(Object.fromEntries(['RichX', 'RichXHi', 'RichY', 'RichW', 'RichH', 'RichInk']
                        .map(name => [name, get(name)])));
                    set('RichH', 0); x = 0; // the actual desktop rectangle routine consumes H and X
                }
                if (!returns.length) return;
                pc = returns.pop();
                continue;
            }
            // SnakeWin uses BIT absolute to skip the crash state's LDA #2.
            if (memory[pc] === 0x2c && !instructions.has(pc)) { pc += 3; continue; }
            const ins = instructions.get(pc);
            assert.ok(ins, `instruction at ${pc.toString(16)}`);
            const { op, arg } = ins;
            const loc = () => value(arg.replace(/,[xy]$/, '')) + (arg.endsWith(',x') ? x : arg.endsWith(',y') ? y : 0);
            const read = () => arg.startsWith('#') ? value(arg.slice(1)) : memory[loc()];
            const target = () => /^[+-]$/.test(arg)
                ? (arg === '+' ? anonymous.find(v => v.name === arg && v.address > pc)
                    : anonymous.filter(v => v.name === arg && v.address <= pc).at(-1)).address
                : value(arg);
            let next = pc + ins.size;
            switch (op) {
                case 'lda': a = flags(read()); break;
                case 'ldx': x = flags(read()); break;
                case 'ldy': y = flags(read()); break;
                case 'sta': memory[loc()] = a; break;
                case 'stx': memory[loc()] = x; break;
                case 'sty': memory[loc()] = y; break;
                case 'clc': c = 0; break;
                case 'sec': c = 1; break;
                case 'and': a = flags(a & read()); break;
                case 'ora': a = flags(a | read()); break;
                case 'eor': a = flags(a ^ read()); break;
                case 'adc': { const v = a + read() + c; c = v > 255 ? 1 : 0; a = flags(v); break; }
                case 'sbc': { const v = a - read() - 1 + c; c = v >= 0 ? 1 : 0; a = flags(v); break; }
                case 'cmp': { const v = read(); c = a >= v ? 1 : 0; flags(a - v); break; }
                case 'cpx': { const v = read(); c = x >= v ? 1 : 0; flags(x - v); break; }
                case 'cpy': { const v = read(); c = y >= v ? 1 : 0; flags(y - v); break; }
                case 'inc': memory[loc()] = flags(memory[loc()] + 1); break;
                case 'dec': memory[loc()] = flags(memory[loc()] - 1); break;
                case 'asl': c = a >> 7; a = flags(a << 1); break;
                case 'lsr': c = a & 1; a = flags(a >> 1); break;
                case 'tax': x = flags(a); break;
                case 'tay': y = flags(a); break;
                case 'txa': a = flags(x); break;
                case 'tya': a = flags(y); break;
                case 'inx': x = flags(x + 1); break;
                case 'dex': x = flags(x - 1); break;
                case 'pha': stack.push(a); break;
                case 'pla': a = flags(stack.pop()); break;
                case 'jsr': returns.push(next); next = target(); break;
                case 'jmp': next = target(); break;
                case 'rts': if (!returns.length) return; next = returns.pop(); break;
                case 'beq': if (z) next = target(); break;
                case 'bne': if (!z) next = target(); break;
                case 'bcc': if (!c) next = target(); break;
                case 'bcs': if (c) next = target(); break;
                case 'bpl': if (!n) next = target(); break;
                default: assert.fail(`unsupported ${op}`);
            }
            pc = next;
        }
        assert.fail('instruction budget exceeded');
    }
    function body(cells) {
        set('SnakeLength', cells.length);
        memory.set(cells, symbols.SnakeBody);
    }
    function tick(now = 9) { set('AppTick', now); run('SnakeTick'); }
    function key(a) { run('SnakeKey', { a: typeof a === 'string' ? a.charCodeAt(0) : a }); }
    const branches = [...instructions].filter(([, i]) => /^b(eq|ne|cc|cs|pl)$/.test(i.op))
        .map(([pc, { arg }]) => ({ pc, arg, delta: (/^[+-]$/.test(arg)
            ? (arg === '+' ? anonymous.find(v => v.name === arg && v.address > pc)
                : anonymous.filter(v => v.name === arg && v.address <= pc).at(-1)).address
            : value(arg)) - pc - 2 }));
    return { run, get, set, body, tick, key, memory, symbols, draws, branches, size: address - 0xc000 };
}

test('Snake include stays within its 1300-byte hard ceiling and branch ranges', t => {
    const m = machine();
    t.diagnostic(`Estimated assembled size: ${m.size} bytes`);
    assert.ok(m.size <= 1300, `estimated size ${m.size}`);
    for (const branch of m.branches) {
        assert.ok(branch.delta >= -128 && branch.delta <= 127,
            `branch at ${branch.pc.toString(16)} to ${branch.arg}: ${branch.delta}`);
    }
});

test('initial body, valid food, throttle and jiffy wraparound', () => {
    const m = machine(); m.run('SnakeInit');
    assert.deepEqual([...m.memory.slice(m.symbols.SnakeBody, m.symbols.SnakeBody + 3)], [0x67, 0x66, 0x65]);
    assert.ok(m.get('SnakeFoodCell') < 192);
    m.set('SnakeFoodCell', 0); m.tick(8); assert.equal(m.get('SnakeBody'), 0x67);
    m.tick(9); assert.equal(m.get('SnakeBody'), 0x68);
    assert.equal(m.get('AppDirty'), 2);
    m.set('SnakeLastTick', 250); m.tick(3); assert.equal(m.get('SnakeBody'), 0x69);
});

test('arrows/WASD work and rapid queued input cannot reverse', () => {
    const m = machine(); m.run('SnakeInit');
    m.key('a'); assert.equal(m.get('SnakePending'), 0);
    m.key('w'); m.key('a'); assert.equal(m.get('SnakePending'), 3);
    m.tick(); assert.equal(m.get('SnakeBody'), 0x57);
    m.key(157); assert.equal(m.get('SnakePending'), 2);
    m.key(17); assert.equal(m.get('SnakePending'), 2);
    m.key('D'); assert.equal(m.get('SnakePending'), 0);
});

test('eating grows, preserves the old tail and moves food off the body', () => {
    const m = machine(); m.run('SnakeInit'); m.set('SnakeFoodCell', 0x68); m.tick();
    assert.equal(m.get('SnakeLength'), 4);
    assert.equal(m.get('AppDirty'), 1);
    const cells = [...m.memory.slice(m.symbols.SnakeBody, m.symbols.SnakeBody + 4)];
    assert.deepEqual(cells, [0x68, 0x67, 0x66, 0x65]);
    assert.ok(!cells.includes(m.get('SnakeFoodCell')));
});

test('each wall and an occupied body cell end the game', () => {
    for (const [head, direction] of [[15, 0], [0xb7, 1], [0x10, 2], [0, 3]]) {
        const m = machine(); m.run('SnakeInit'); m.body([head, 0x66, 0x65]);
        m.set('SnakePending', direction); m.tick(); assert.equal(m.get('SnakeState'), 2);
    }
    const m = machine(); m.run('SnakeInit'); m.body([0x22, 0x23, 0x33, 0x32]);
    m.tick(); assert.equal(m.get('SnakeState'), 2);
});

test('the departing tail is safe, but not when food causes growth', () => {
    const m = machine(); m.run('SnakeInit'); m.body([0x22, 0x32, 0x33, 0x23]);
    m.set('SnakeFoodCell', 0); m.tick(); assert.equal(m.get('SnakeState'), 0);
    assert.equal(m.get('SnakeBody'), 0x23);
    const n = machine(); n.run('SnakeInit'); n.body([0x22, 0x32, 0x33, 0x23]);
    n.set('SnakeFoodCell', 0x23); n.tick(); assert.equal(n.get('SnakeState'), 2);
});

test('pause stops movement and restart works while paused or crashed', () => {
    const m = machine(); m.run('SnakeInit'); m.key(' '); m.tick();
    assert.equal(m.get('SnakeBody'), 0x67); assert.equal(m.get('SnakeState'), 1);
    assert.equal(m.get('AppDirty'), 1);
    m.key('r'); assert.equal(m.get('SnakeState'), 0);
    m.key(13); assert.equal(m.get('SnakeState'), 1);
    m.key(13); assert.equal(m.get('SnakeState'), 0);
    m.set('SnakeState', 2); m.key('p'); assert.equal(m.get('SnakeState'), 2);
    m.key('R'); assert.equal(m.get('SnakeState'), 0);
});

test('mouse controls honor their painted bounds and directions', () => {
    const m = machine(); m.run('SnakeInit');
    m.run('SnakeClick', { x: 23, y: 9 }); assert.equal(m.get('SnakeState'), 1);
    m.run('SnakeClick', { x: 36, y: 9 }); assert.equal(m.get('SnakeState'), 1);
    m.run('SnakeClick', { x: 35, y: 12 }); assert.equal(m.get('SnakeState'), 0);
    m.run('SnakeClick', { x: 29, y: 15 }); assert.equal(m.get('SnakePending'), 3);
    m.run('SnakeClick', { x: 28, y: 18 }); assert.equal(m.get('SnakePending'), 1);
    m.run('SnakeClick', { x: 31, y: 19 }); assert.equal(m.get('SnakePending'), 0);
    m.set('SnakeDirection', 3);
    m.run('SnakeClick', { x: 25, y: 18 }); assert.equal(m.get('SnakePending'), 2);
});

test('every random seed finds an unoccupied board cell', () => {
    const m = machine(); m.body(Array.from({ length: 64 }, (_, i) => i));
    for (let seed = 0; seed < 256; seed++) {
        m.set('SnakeRandom', seed); m.run('SnakeFood');
        assert.ok(m.get('SnakeFoodCell') >= 64 && m.get('SnakeFoodCell') < 192);
    }
});

test('64 segments wins without writing past the fixed body buffer', () => {
    const m = machine(); m.run('SnakeInit');
    m.body([0x80, ...Array.from({ length: 62 }, (_, i) => i)]);
    m.memory[m.symbols.SnakeBody + 64] = 0xaa;
    m.set('SnakeFoodCell', 0x81); m.tick();
    assert.equal(m.get('SnakeState'), 3); assert.equal(m.get('SnakeLength'), 64);
    assert.equal(m.memory[m.symbols.SnakeBody + 64], 0xaa);
    m.tick(18); assert.equal(m.get('SnakeBody'), 0x81);
});

test('ordinary movement redraws only the departing tail and new head', () => {
    const m = machine(); m.run('SnakeInit'); m.set('SnakeFoodCell', 0); m.tick();
    assert.equal(m.get('AppDirty'), 2); assert.equal(m.get('SnakeOldTail'), 0x65);
    m.set('AppRenderMode', 2); m.run('SnakeDraw');
    assert.deepEqual(m.draws, [
        { RichX: 73, RichXHi: 0, RichY: 97, RichW: 6, RichH: 6, RichInk: 0 },
        { RichX: 97, RichXHi: 0, RichY: 97, RichW: 6, RichH: 6, RichInk: 255 },
    ]);
});

test('moving into the departing tail erases that square before repainting it', () => {
    const m = machine(); m.run('SnakeInit'); m.body([0x22, 0x32, 0x33, 0x23]);
    m.set('SnakeFoodCell', 0); m.tick(); m.set('AppRenderMode', 2); m.run('SnakeDraw');
    assert.equal(m.get('AppDirty'), 2);
    assert.deepEqual(m.draws.map(({ RichX, RichY, RichInk }) => [RichX, RichY, RichInk]),
        [[57, 65, 0], [57, 65, 255]]);
});
