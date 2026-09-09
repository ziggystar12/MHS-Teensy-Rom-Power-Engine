'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourceDir = path.join(__dirname, '..', 'source');
const mouseSource = fs.readFileSync(path.join(sourceDir, 'Mouse1351.s'), 'utf8');
const mainSource = fs.readFileSync(path.join(sourceDir, 'MainMenu.asm'), 'utf8');
const regsHeader = fs.readFileSync(path.resolve(sourceDir, '../../../Teensy/MinimalBoot/Common/Menu_Regs.h'), 'utf8');
const iohSource = fs.readFileSync(path.resolve(sourceDir, '../../../Teensy/MinimalBoot/Common/IO_Handlers/IOH_TeensyROM.c'), 'utf8');
const teensySource = fs.readFileSync(path.resolve(sourceDir, '../../../Teensy/Teensy.ino'), 'utf8');

// Executable contract for the C64-side 1351 driver. The assembly can use
// different storage, but must preserve these observable rules.
const POT_COUNTER_MASK = 0x7f;
const PORT_1_FIRE_MASK = 0x10;
const INPUT_MOUSE1_JOY2 = 0x00;
const INPUT_JOY1_MOUSE2 = 0x02;
const INPUT_JOY1_JOY2 = 0x04;
const LOGICAL_X_MAX = 159;
const LOGICAL_Y_MAX = 199;

const GRID_COLUMNS = 5;
const GRID_ROWS = 4;
const GRID_CELL_WIDTH = 32;  // 8 text columns at two pixels per logical X.
const GRID_CELL_HEIGHT = 32; // 4 text rows.
const GRID_TOP = 24;         // Text row 3.
const GRID_ITEM_COUNT = 19;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function decodePotDelta(previous, current) {
    const wrappedDelta = (current - previous) & POT_COUNTER_MASK;

    if (wrappedDelta < 0x40) {
        const delta = wrappedDelta >> 1;
        return { accepted: delta !== 0, delta };
    }

    const signedDelta = wrappedDelta - 0x80;
    if (signedDelta === -1) {
        return { accepted: false, delta: 0 };
    }

    // This matches the 6502 SEC/ROR used by the established 1351 algorithm.
    return { accepted: true, delta: Math.floor(signedDelta / 2) };
}

class Mouse1351InputModel {
    constructor({ x = 80, y = 100 } = {}) {
        this.x = clamp(x, 0, LOGICAL_X_MAX);
        this.y = clamp(y, 0, LOGICAL_Y_MAX);
        this.oldPotX = 0;
        this.oldPotY = 0;
        this.leftDown = false;
        this.calibrated = false;
    }

    sample({ potX, potY, port1 = 0xff }) {
        const nextLeftDown = (port1 & PORT_1_FIRE_MASK) === 0;

        if (!this.calibrated) {
            this.oldPotX = potX;
            this.oldPotY = potY;
            this.leftDown = nextLeftDown;
            this.calibrated = true;
            return this.result(0, 0, false);
        }

        const xMovement = decodePotDelta(this.oldPotX, potX);
        const yMovement = decodePotDelta(this.oldPotY, potY);

        if (xMovement.accepted) {
            this.oldPotX = potX;
            this.x = clamp(this.x + xMovement.delta, 0, LOGICAL_X_MAX);
        }

        if (yMovement.accepted) {
            this.oldPotY = potY;
            this.y = clamp(this.y - yMovement.delta, 0, LOGICAL_Y_MAX);
        }

        const activate = nextLeftDown && !this.leftDown;
        this.leftDown = nextLeftDown;
        return this.result(xMovement.delta, -yMovement.delta, activate);
    }

    result(dx, dy, activate) {
        return {
            x: this.x,
            y: this.y,
            dx,
            dy,
            leftDown: this.leftDown,
            activate,
        };
    }
}

function hitTestGrid(x, y, itemCount = GRID_ITEM_COUNT) {
    if (x < 0 || x > LOGICAL_X_MAX || y < GRID_TOP) {
        return null;
    }

    const column = Math.floor(x / GRID_CELL_WIDTH);
    const row = Math.floor((y - GRID_TOP) / GRID_CELL_HEIGHT);
    if (column >= GRID_COLUMNS || row < 0 || row >= GRID_ROWS) {
        return null;
    }

    const item = row * GRID_COLUMNS + column;
    return item < itemCount ? item : null;
}

class MousePresenceGate {
    constructor() {
        this.active = false;
        this.motionFrames = 0;
        this.buttonFrames = 0;
        this.leftDown = false;
        this.debounceFrames = 0;
    }

    sample({ plausibleMotion = false, leftDown = false, menuEnabled = true } = {}) {
        if (!this.active) {
            this.motionFrames = plausibleMotion ? this.motionFrames + 1 : 0;
            this.buttonFrames = leftDown ? this.buttonFrames + 1 : 0;
            const activated = this.motionFrames >= 3 || this.buttonFrames >= 2;
            if (activated) {
                this.active = true;
                this.motionFrames = 0;
                this.buttonFrames = 0;
            }
            this.leftDown = leftDown;
            return { active: this.active, activated, clickEdge: false };
        }

        if (leftDown === this.leftDown) {
            this.debounceFrames = 0;
            return { active: true, activated: false, clickEdge: false };
        }
        this.debounceFrames += 1;
        if (this.debounceFrames < 2) {
            return { active: true, activated: false, clickEdge: false };
        }
        this.debounceFrames = 0;
        const clickEdge = menuEnabled && leftDown;
        this.leftDown = leftDown;
        return { active: true, activated: false, clickEdge };
    }
}

function clickIcon(state, item, selectedItem) {
    if (state.armed && state.lastItem === item && selectedItem === item) {
        return { state: { armed: false, lastItem: item }, selectedItem, open: true };
    }
    return { state: { armed: true, lastItem: item }, selectedItem: item, open: false };
}

function postMouseSampleCiaState(port1) {
    const anyPort1SwitchActive = port1 !== 0xff;
    return {
        ddra: 0xff,
        ddrb: anyPort1SwitchActive ? 0xff : 0x00,
        prbLatch: anyPort1SwitchActive ? 0x00 : null,
    };
}

test('first sample calibrates counters and button state without movement or activation', () => {
    const mouse = new Mouse1351InputModel({ x: 42, y: 77 });
    const first = mouse.sample({ potX: 0x7e, potY: 0x02, port1: 0xef });

    assert.deepEqual(first, {
        x: 42,
        y: 77,
        dx: 0,
        dy: 0,
        leftDown: true,
        activate: false,
    });
    assert.equal(mouse.oldPotX, 0x7e);
    assert.equal(mouse.oldPotY, 0x02);
});

test('decodes positive and negative movement in logical-coordinate units', () => {
    assert.deepEqual(decodePotDelta(0x20, 0x26), { accepted: true, delta: 3 });
    assert.deepEqual(decodePotDelta(0x20, 0x1a), { accepted: true, delta: -3 });

    const mouse = new Mouse1351InputModel({ x: 80, y: 100 });
    mouse.sample({ potX: 0x20, potY: 0x20 });
    assert.deepEqual(
        mouse.sample({ potX: 0x26, potY: 0x1a }),
        { x: 83, y: 103, dx: 3, dy: 3, leftDown: false, activate: false },
    );
});

test('decodes movement across both ends of the modulo counter', () => {
    assert.deepEqual(decodePotDelta(0x7e, 0x04), { accepted: true, delta: 3 });
    assert.deepEqual(decodePotDelta(0x02, 0x7c), { accepted: true, delta: -3 });
});

test('rejects one-count POT jitter and retains the last accepted baseline', () => {
    assert.deepEqual(decodePotDelta(0x40, 0x41), { accepted: false, delta: 0 });
    assert.deepEqual(decodePotDelta(0x40, 0x3f), { accepted: false, delta: 0 });

    const mouse = new Mouse1351InputModel({ x: 80, y: 100 });
    mouse.sample({ potX: 0x40, potY: 0x40 });
    mouse.sample({ potX: 0x41, potY: 0x3f });
    assert.equal(mouse.oldPotX, 0x40);
    assert.equal(mouse.oldPotY, 0x40);
    assert.deepEqual(
        mouse.sample({ potX: 0x42, potY: 0x3e }),
        { x: 81, y: 101, dx: 1, dy: 1, leftDown: false, activate: false },
    );
});

test('clamps logical coordinates to 0..159 by 0..199', () => {
    const high = new Mouse1351InputModel({ x: 158, y: 198 });
    high.sample({ potX: 0x20, potY: 0x20 });
    assert.deepEqual(
        high.sample({ potX: 0x28, potY: 0x18 }),
        { x: 159, y: 199, dx: 4, dy: 4, leftDown: false, activate: false },
    );

    const low = new Mouse1351InputModel({ x: 1, y: 1 });
    low.sample({ potX: 0x20, potY: 0x20 });
    assert.deepEqual(
        low.sample({ potX: 0x18, potY: 0x28 }),
        { x: 0, y: 0, dx: -4, dy: -4, leftDown: false, activate: false },
    );
});

test('port-1 fire activates once per press edge, not while held', () => {
    const mouse = new Mouse1351InputModel();
    mouse.sample({ potX: 0x20, potY: 0x20, port1: 0xff });

    assert.equal(mouse.sample({ potX: 0x20, potY: 0x20, port1: 0xef }).activate, true);
    assert.equal(mouse.sample({ potX: 0x20, potY: 0x20, port1: 0xef }).activate, false);
    assert.equal(mouse.sample({ potX: 0x20, potY: 0x20, port1: 0xff }).activate, false);
    assert.equal(mouse.sample({ potX: 0x20, potY: 0x20, port1: 0xef }).activate, true);
});

test('hit-tests 19 page items in the 5x4 GEOS grid and rejects slot 20', () => {
    for (let item = 0; item < GRID_ITEM_COUNT; item += 1) {
        const column = item % GRID_COLUMNS;
        const row = Math.floor(item / GRID_COLUMNS);
        const x = column * GRID_CELL_WIDTH + GRID_CELL_WIDTH / 2;
        const y = GRID_TOP + row * GRID_CELL_HEIGHT + GRID_CELL_HEIGHT / 2;
        assert.equal(hitTestGrid(x, y), item, `center of item ${item}`);
    }

    assert.equal(hitTestGrid(0, GRID_TOP), 0);
    assert.equal(hitTestGrid(31, GRID_TOP + 31), 0);
    assert.equal(hitTestGrid(32, GRID_TOP), 1);
    assert.equal(hitTestGrid(159, GRID_TOP), 4);
    assert.equal(hitTestGrid(128, GRID_TOP + 3 * GRID_CELL_HEIGHT), null);
    assert.equal(hitTestGrid(0, GRID_TOP - 1), null);
    assert.equal(hitTestGrid(0, GRID_TOP + GRID_ROWS * GRID_CELL_HEIGHT), null);
});

test('presence gate stays hidden on an idle open port and consumes its activation click', () => {
    const gate = new MousePresenceGate();
    for (let frame = 0; frame < 8; frame += 1) {
        assert.deepEqual(gate.sample(), { active: false, activated: false, clickEdge: false });
    }

    assert.deepEqual(
        gate.sample({ leftDown: true }),
        { active: false, activated: false, clickEdge: false },
    );
    assert.deepEqual(
        gate.sample({ leftDown: true }),
        { active: true, activated: true, clickEdge: false },
    );
    gate.sample({ leftDown: false });
    gate.sample({ leftDown: false });
    assert.equal(gate.sample({ leftDown: true }).clickEdge, false);
    assert.equal(gate.sample({ leftDown: true }).clickEdge, true);
    assert.equal(gate.sample({ leftDown: true }).clickEdge, false);
});

test('presence motion must be plausible and consecutive', () => {
    const gate = new MousePresenceGate();
    gate.sample({ plausibleMotion: true });
    gate.sample({ plausibleMotion: false });
    gate.sample({ plausibleMotion: true });
    gate.sample({ plausibleMotion: true });
    assert.equal(gate.active, false);
    assert.deepEqual(
        gate.sample({ plausibleMotion: true }),
        { active: true, activated: true, clickEdge: false },
    );
});

test('an icon opens only on a second click on that same selected item', () => {
    let state = { armed: false, lastItem: 0 };
    let result = clickIcon(state, 7, 0);
    assert.equal(result.open, false);
    assert.equal(result.selectedItem, 7);

    state = result.state;
    result = clickIcon(state, 8, result.selectedItem);
    assert.equal(result.open, false);
    assert.equal(result.selectedItem, 8);

    state = result.state;
    result = clickIcon(state, 8, result.selectedItem);
    assert.equal(result.open, true);
});

test('an active port-1 switch blinds the following KERNAL keyboard scan', () => {
    assert.deepEqual(
        postMouseSampleCiaState(0xef),
        { ddra: 0xff, ddrb: 0xff, prbLatch: 0x00 },
    );
    assert.deepEqual(
        postMouseSampleCiaState(0xfe),
        { ddra: 0xff, ddrb: 0xff, prbLatch: 0x00 },
    );
    assert.deepEqual(
        postMouseSampleCiaState(0xff),
        { ddra: 0xff, ddrb: 0x00, prbLatch: null },
    );
});

test('an active mouse ignores one-sample press/release glitches while moving', () => {
    const gate = new MousePresenceGate();
    for (let frame = 0; frame < 3; frame += 1) gate.sample({ plausibleMotion: true });

    assert.equal(gate.sample({ plausibleMotion: true, leftDown: true }).clickEdge, false);
    assert.equal(gate.sample({ plausibleMotion: true }).clickEdge, false);
    assert.equal(gate.leftDown, false, 'a single noisy low must not select an icon');

    assert.equal(gate.sample({ leftDown: true }).clickEdge, false);
    assert.equal(gate.sample({ leftDown: true }).clickEdge, true);
    assert.equal(gate.leftDown, true);
    gate.sample({ leftDown: false });
    assert.equal(gate.leftDown, true, 'a one-frame release must not finish a drag');
    assert.equal(gate.sample({ leftDown: true }).clickEdge, false);
    assert.equal(gate.sample({ leftDown: true }).clickEdge, false);

    gate.sample({ leftDown: false });
    gate.sample({ leftDown: false });
    assert.equal(gate.leftDown, false);
    assert.equal(gate.sample({ leftDown: true }).clickEdge, false);
    assert.equal(gate.sample({ leftDown: true }).clickEdge, true);
});

// Electrical matrix model: closed keys connect CIA A columns to B rows.
// A grounded controller/low output can propagate through those switches,
// which is why normal keyboard scan latches are not joystick samples.
function ciaPins({ pra = 0x7f, prb = 0x00, ddra = 0xff, ddrb = 0,
    port1 = 0xff, port2 = 0xff, keys = [] } = {}) {
    let a = (pra | (~ddra & 0xff)) & port2;
    let b = (prb | (~ddrb & 0xff)) & port1;
    for (let pass = 0; pass < 8; pass += 1) {
        for (const [column, row] of keys) {
            if (!(a & (1 << column)) || !(b & (1 << row))) {
                a &= ~(1 << column);
                b &= ~(1 << row);
            }
        }
    }
    return { a, b };
}

function irqControllerSnapshot(input, layout = INPUT_MOUSE1_JOY2) {
    const { a, b } = ciaPins({ ...input, ddra: 0, ddrb: 0 });
    if (layout === INPUT_MOUSE1_JOY2) {
        return { mousePort: b, joystick: (b & 0x1f) === 0x1f ? a : 0xff };
    }
    if (layout === INPUT_JOY1_MOUSE2) {
        return { mousePort: a, joystick: (a & 0x1f) === 0x1f ? b : 0xff };
    }
    return { mousePort: 0xff, joystick: (a & b) | 0xe0 };
}

test('isolated joystick sampling never treats physical cursor/Shift keys as joystick directions', () => {
    for (const cursor of [[0, 2], [0, 7]]) {
        for (const shift of [null, [1, 7], [6, 4]]) {
            const keys = shift ? [cursor, shift] : [cursor];
            assert.deepEqual(irqControllerSnapshot({ keys }), { mousePort: 0xff, joystick: 0xff });
            const duringMouseButton = { keys, port1: 0xef };
            assert.equal(irqControllerSnapshot(duringMouseButton).joystick, 0xff);
            assert.notEqual(ciaPins({ ...duringMouseButton, ddrb: 0xff }).a & 0x1f, 0x1f,
                'old main-loop PRA read sees a keyboard column as a joystick action');
        }
    }
});

test('isolated joystick sampling preserves all five port-2 controls when port 1 is idle', () => {
    for (const bit of [0, 1, 2, 3, 4]) {
        const port2 = 0xff ^ (1 << bit);
        assert.deepEqual(irqControllerSnapshot({ port2 }), { mousePort: 0xff, joystick: port2 });
    }
    // F1 connects mouse-fire's B4 to joystick-up's A0. Both devices are
    // inputs, but the physical mouse switch can still ground the A0 wire.
    assert.equal(ciaPins({ ddra: 0, ddrb: 0, port1: 0xef, keys: [[0, 4]] }).a, 0xfe);
    assert.equal(irqControllerSnapshot({ port1: 0xef, keys: [[0, 4]] }).joystick, 0xff);
});

test('port assignments are symmetric, exclusive, and allow either joystick in two-joystick mode', () => {
    for (const bit of [0, 1, 2, 3, 4]) {
        const port1 = 0xff ^ (1 << bit);
        assert.deepEqual(
            irqControllerSnapshot({ port1 }, INPUT_JOY1_MOUSE2),
            { mousePort: 0xff, joystick: port1 },
        );
    }
    assert.deepEqual(
        irqControllerSnapshot({ port1: 0xf7, port2: 0xfe }, INPUT_JOY1_JOY2),
        { mousePort: 0xff, joystick: 0xf6 },
    );
    assert.equal(
        irqControllerSnapshot({ port1: 0xfe, port2: 0xef }, INPUT_JOY1_MOUSE2).joystick,
        0xff,
        'a port-2 mouse switch suppresses a matrix-ambiguous port-1 joystick sample',
    );
});

test('input layout shares the existing persisted defaults byte without changing its other settings', () => {
    assert.match(regsHeader, /rpud3InputLayoutMask\s*=\s*0b00000110/);
    assert.match(regsHeader, /rpud3InputMouse1Joy2\s*=\s*0b00000000/);
    assert.match(regsHeader, /rpud3InputJoy1Mouse2\s*=\s*0b00000010/);
    assert.match(regsHeader, /rpud3InputJoy1Joy2\s*=\s*0b00000100/);
    assert.match(iohSource, /case rwRegPwrUpDefaults3:[\s\S]*?IO1\[rwRegPwrUpDefaults3\]\s*=\s*Data;[\s\S]*?eepAddrToWrite\s*=\s*eepAdPwrUpDefaults3;[\s\S]*?rsWriteEEPROM/);
    assert.match(teensySource, /IO1\[rwRegPwrUpDefaults3\]\s*=\s*EEPROM\.read\(eepAdPwrUpDefaults3\)/);
});

test('assembly samples joystick only in the isolated IRQ window and debounces both button edges', () => {
    assert.match(mouseSource, /MouseButtonDebounceFrames\s*=\s*2/);
    assert.match(mouseSource, /sta CIA1_DDRB\s+sta CIA1_DDRA\s+lda CIA1_RegB\s+sta InputPort1Sample\s+lda CIA1_RegA\s+sta InputPort2Sample/);
    assert.match(mouseSource, /MouseInputLayoutMouse1:[\s\S]*?MouseInputLayoutMouse2:[\s\S]*?stx Joystick2Sample/);
    assert.match(mouseSource, /lda InputPort1Sample\s+and InputPort2Sample\s+ora #%11100000\s+sta Joystick2Sample/);
    assert.match(mouseSource, /MouseInputRestoreCIA:\s+dec CIA1_DDRA/);
    assert.match(mouseSource, /MouseActiveButtonEdge:[\s\S]*?cmp MouseLeftDown\s+beq MouseButtonDebounceReset[\s\S]*?cmp #MouseButtonDebounceFrames\s+bcc MouseButtonDebounceDone/);
    const mainLoop = mainSource.slice(mainSource.indexOf('MouseNoMenuEvent:'), mainSource.indexOf('JSDelay:'));
    assert.match(mainLoop, /lda Joystick2Sample/);
    assert.doesNotMatch(mainLoop, /lda CIA1_RegA/);
    for (const code of ['ChrCRSRUp', 'ChrCRSRDn', 'ChrCRSRLeft', 'ChrCRSRRight']) {
        assert.match(mainSource, new RegExp(`cmp #${code}\\b`));
    }
});

test('assembled desktop IRQ publishes the live pointer without borrowing renderer state', async t => {
    const {desktopMachine} = require('./desktop-machine');
    await desktopMachine(t, async ({s, fresh, stub}) => {
        function prepare(x, y, active = 1, enabled = 1, visibility = 0xa5) {
            const cpu = fresh();
            cpu.m[s.MouseLogicalX] = x; cpu.m[s.MouseLogicalY] = y;
            cpu.m[s.MouseActive] = active; cpu.m[s.MouseMenuEnabled] = enabled;
            cpu.m[s.MouseCalibrated] = 1;
            cpu.m[s.MouseOldPotX] = cpu.m[s.MouseOldPotY] = 64;
            cpu.m[s.PadlXReg] = cpu.m[s.PadlYReg] = 64;
            cpu.m[s.CIA1_RegA] = cpu.m[s.CIA1_RegB] = 255;
            cpu.m[s.SpriteEnable] = visibility;
            cpu.m[s.Sprite0Xpos] = 0xc1; cpu.m[s.Sprite0Ypos] = 0xd2;
            cpu.m[s.SpriteXMSB] = 0xb6;
            cpu.m[s.MouseFrameX] = 17; cpu.m[s.MouseFrameY] = 23;
            cpu.m[s.MouseFrameClick] = 0x43; cpu.m[s.MouseFrameDown] = 0x54;
            cpu.m[s.MouseClickEdge] = 0x65;
            return cpu;
        }
        function position(cpu, x, y, msb = 0xb6) {
            assert.equal(cpu.m[s.Sprite0Xpos], (x * 2 + 24) & 255);
            assert.equal(cpu.m[s.SpriteXMSB], (msb & 254) | (x >= 116 ? 1 : 0));
            assert.equal(cpu.m[s.Sprite0Ypos], y + 50);
        }
        await t.test('persisted layouts normalize safely and preserve unrelated defaults bits', () => {
            const cpu = fresh(); let waits = 0;
            stub(cpu, 'WaitForTRWaitMsg', () => waits++);
            cpu.m[s.GeosInputLayout] = INPUT_MOUSE1_JOY2;
            cpu.m[s.rwRegPwrUpDefaults3 + s.IO1Port] = 0xb9;
            cpu.m[s.MouseActive] = 1;
            cpu.m[s.SpriteEnable] = 0xff;
            cpu.p &= ~4;

            cpu.a = INPUT_JOY1_MOUSE2;
            cpu.call(s.GeosInputSetLayout);
            assert.equal(cpu.a, INPUT_JOY1_MOUSE2);
            assert.equal(cpu.p & 4, 0, 'live assignment preserves the caller interrupt state');
            assert.equal(cpu.m[s.GeosInputLayout], INPUT_JOY1_MOUSE2);
            assert.equal(cpu.m[s.rwRegPwrUpDefaults3 + s.IO1Port], 0xbb);
            assert.equal(cpu.m[s.MouseActive], 0);
            assert.equal(waits, 1);

            cpu.a = 0x06;
            cpu.call(s.GeosInputSetLayout);
            assert.equal(cpu.a, INPUT_MOUSE1_JOY2);
            assert.equal(cpu.m[s.GeosInputLayout], INPUT_MOUSE1_JOY2);
            assert.equal(cpu.m[s.rwRegPwrUpDefaults3 + s.IO1Port], 0xb9);
            assert.equal(waits, 2);

            cpu.m[s.rwRegPwrUpDefaults3 + s.IO1Port] = 0xbf;
            cpu.a = INPUT_MOUSE1_JOY2;
            cpu.call(s.GeosInputSetLayout);
            assert.equal(cpu.m[s.rwRegPwrUpDefaults3 + s.IO1Port], 0xb9);
            assert.equal(waits, 3, 'reserved persisted layout is rewritten as the safe default');
            cpu.a = INPUT_MOUSE1_JOY2;
            cpu.call(s.GeosInputSetLayout);
            assert.equal(waits, 3, 'an already-live, already-persisted layout does no extra write');
        });
        await t.test('CIA selector chooses the configured mouse port and no POT port for two joysticks', () => {
            const cpu = fresh();
            for (const [layout, selector, ready] of [
                [INPUT_MOUSE1_JOY2, 0x7f, 1],
                [INPUT_JOY1_MOUSE2, 0xbf, 1],
            ]) {
                cpu.m[s.GeosInputLayout] = layout;
                cpu.call(s.Mouse1351SelectConfiguredPots);
                assert.equal(cpu.m[s.CIA1_DDRA], 0xc0);
                assert.equal(cpu.m[s.CIA1_RegA], selector);
                assert.equal(cpu.m[s.MousePotSelectionReady], ready);
            }
            cpu.m[s.GeosInputLayout] = INPUT_JOY1_JOY2;
            cpu.m[s.CIA1_DDRA] = 0x5a; cpu.m[s.CIA1_RegA] = 0xa5;
            cpu.call(s.Mouse1351SelectConfiguredPots);
            assert.equal(cpu.m[s.CIA1_DDRA], 0x5a);
            assert.equal(cpu.m[s.CIA1_RegA], 0xa5);
            assert.equal(cpu.m[s.MousePotSelectionReady], 0);
        });
        await t.test('actual sampler routes both mouse/joystick swaps and combines two joysticks', () => {
            const sample = (layout, port1, port2) => {
                const cpu = fresh();
                cpu.m[s.GeosInputLayout] = layout;
                cpu.m[s.MousePotSelectionReady] = 1;
                cpu.m[s.CIA1_RegB] = port1;
                cpu.m[s.CIA1_RegA] = port2;
                cpu.m[s.PadlXReg] = cpu.m[s.PadlYReg] = 64;
                cpu.call(s.Mouse1351SampleState);
                return cpu;
            };
            const mouse1 = sample(INPUT_MOUSE1_JOY2, 0xff, 0xf7);
            assert.equal(mouse1.m[s.MousePort1Sample], 0xff);
            assert.equal(mouse1.m[s.Joystick2Sample], 0xf7);

            const mouse2 = sample(INPUT_JOY1_MOUSE2, 0xfb, 0xff);
            assert.equal(mouse2.m[s.MousePort1Sample], 0xff);
            assert.equal(mouse2.m[s.Joystick2Sample], 0xfb);
            assert.equal(mouse2.m[s.CIA1_DDRB], 0xff, 'port-1 joystick cannot become a phantom key');
            assert.equal(mouse2.m[s.CIA1_RegB], 0x00);

            const suppressed = sample(INPUT_JOY1_MOUSE2, 0xfe, 0xef);
            assert.equal(suppressed.m[s.MouseNewLeftDown], 1);
            assert.equal(suppressed.m[s.Joystick2Sample], 0xff);

            const dual = sample(INPUT_JOY1_JOY2, 0xf7, 0xfe);
            assert.equal(dual.m[s.Joystick2Sample], 0xf6);
            assert.equal(dual.m[s.MouseNewLeftDown], 0);
            assert.equal(dual.m[s.MouseActive], 0);
            assert.equal(dual.m[s.CIA1_DDRB], 0xff, 'dual-mode port-1 joystick blinds the keyboard scan');
        });
        await t.test('both mouse-port layouts consume fresh POT movement and stale port-2 selection is ignored', () => {
            for (const layout of [INPUT_MOUSE1_JOY2, INPUT_JOY1_MOUSE2]) {
                const cpu = fresh();
                cpu.m[s.GeosInputLayout] = layout;
                cpu.m[s.MousePotSelectionReady] = 1;
                cpu.m[s.MouseCalibrated] = 1;
                cpu.m[s.MouseOldPotX] = cpu.m[s.MouseOldPotY] = 64;
                cpu.m[s.MouseLogicalX] = 80; cpu.m[s.MouseLogicalY] = 100;
                cpu.m[s.PadlXReg] = 66; cpu.m[s.PadlYReg] = 62;
                cpu.m[s.CIA1_RegA] = cpu.m[s.CIA1_RegB] = 0xff;
                cpu.call(s.Mouse1351SampleState);
                assert.equal(cpu.m[s.MouseLogicalX], 81, `layout ${layout} X`);
                assert.equal(cpu.m[s.MouseLogicalY], 101, `layout ${layout} Y`);
                assert.equal(cpu.m[s.MousePotSampleValid], 1, `layout ${layout} fresh`);
            }

            const stalePort2 = fresh();
            stalePort2.m[s.GeosInputLayout] = INPUT_JOY1_MOUSE2;
            stalePort2.m[s.MousePotSelectionReady] = 0;
            stalePort2.m[s.MouseCalibrated] = 1;
            stalePort2.m[s.MouseOldPotX] = stalePort2.m[s.MouseOldPotY] = 64;
            stalePort2.m[s.MouseLogicalX] = 80; stalePort2.m[s.MouseLogicalY] = 100;
            stalePort2.m[s.PadlXReg] = 90; stalePort2.m[s.PadlYReg] = 30;
            stalePort2.m[s.CIA1_RegA] = stalePort2.m[s.CIA1_RegB] = 0xff;
            stalePort2.call(s.Mouse1351SampleState);
            assert.equal(stalePort2.m[s.MouseLogicalX], 80);
            assert.equal(stalePort2.m[s.MouseLogicalY], 100);
            assert.equal(stalePort2.m[s.MousePotSampleValid], 0);
        });
        await t.test('sampler publishes all X boundaries and both Y limits while preserving other sprites', () => {
            for (const x of [0, 1, 114, 115, 116, 117, 127, 128, 159]) {
                for (const y of [0, 1, 199]) for (const msb of [0, 0x56, 0xfe, 0xff]) {
                    const cpu = prepare(x, y); cpu.m[s.SpriteXMSB] = msb;
                    cpu.call(s.Mouse1351IRQSample);
                    position(cpu, x, y, msb);
                    assert.equal(cpu.m[s.SpriteEnable], 0xa5);
                    for (const [name, value] of [['MouseFrameX', 17], ['MouseFrameY', 23],
                        ['MouseFrameClick', 0x43], ['MouseFrameDown', 0x54], ['MouseClickEdge', 0x65]])
                        assert.equal(cpu.m[s[name]], value, name);
                }
            }
        });
        await t.test('movement accepted in this IRQ reaches the VIC before returning to a busy renderer', () => {
            const cpu = prepare(115, 100);
            cpu.m[s.PadlXReg] = 66; cpu.m[s.PadlYReg] = 62;
            cpu.m[1] = 0x36; // Renderer is using RAM under BASIC.
            const saved = Buffer.from(cpu.m);
            cpu.call(s.Mouse1351IRQSample);
            assert.equal(cpu.m[s.MouseLogicalX], 116); assert.equal(cpu.m[s.MouseLogicalY], 101);
            position(cpu, 116, 101);
            for (const [first, last] of [[0, 256], [s.GeosRichBegin, s.Mouse1351Init],
                [s.GeosRichCanvas, s.GeosRichCanvas + 8000], [s.GeosBitmapRAM, s.GeosBitmapRAM + 8000]])
                assert.deepEqual(cpu.m.subarray(first, last), saved.subarray(first, last), `renderer region $${first.toString(16)}`);
        });
        await t.test('inactive and exited menus do not publish; temporarily hidden pointers stay hidden', () => {
            for (const [active, enabled] of [[0, 0], [0, 1], [1, 0]]) {
                const cpu = prepare(116, 100, active, enabled, 0xa4), writes = [];
                cpu.onWrite = address => { if ([s.Sprite0Xpos, s.Sprite0Ypos, s.SpriteXMSB, s.SpriteEnable].includes(address)) writes.push(address); };
                cpu.call(s.Mouse1351IRQSample);
                assert.deepEqual(writes, []); assert.equal(cpu.m[s.SpriteEnable], 0xa4);
            }
            const hidden = prepare(116, 100, 1, 1, 0xa4);
            hidden.call(s.Mouse1351IRQSample); position(hidden, 116, 100);
            assert.equal(hidden.m[s.SpriteEnable], 0xa4, 'IRQ cannot unhide sprite zero');
        });
        await t.test('coordinate helper writes only three VIC registers and preserves bank, canvas and frame state', () => {
            for (const bank of [0x35, 0x36, 0x37]) {
                const cpu = prepare(116, 100); cpu.m[1] = bank;
                const snapshot = Buffer.from(cpu.m), writes = [];
                cpu.onWrite = address => writes.push(address);
                cpu.call(s.Mouse1351PublishPosition);
                const allowed = new Set([s.Sprite0Xpos, s.Sprite0Ypos, s.SpriteXMSB]);
                assert.ok(writes.every(address => allowed.has(address) || (address >= 0x100 && address < 0x200)));
                assert.equal(cpu.m[1], bank);
                for (let address = 0; address < 65536; address++) {
                    if (!allowed.has(address) && !(address >= 0x100 && address < 0x200))
                        assert.equal(cpu.m[address], snapshot[address], `untouched $${address.toString(16)}`);
                }
            }
        });
        await t.test('main-loop show uses current coordinates atomically rather than an older frame snapshot', () => {
            const cpu = prepare(116, 100); cpu.p &= ~4;
            cpu.m[s.MouseFrameX] = 115; cpu.m[s.MouseFrameY] = 20;
            let masked = 0, longestMask = 0, span = 0;
            const step = cpu.step.bind(cpu);
            cpu.step = () => { if (cpu.p & 4) { masked++; longestMask = Math.max(longestMask, ++span); } else span = 0; step(); };
            cpu.onWrite = address => {
                if ([s.Sprite0Xpos, s.Sprite0Ypos, s.SpriteXMSB].includes(address)) assert.ok(cpu.p & 4, 'coordinate stores form one short atomic group');
            };
            cpu.call(s.Mouse1351ShowPointer); position(cpu, 116, 100);
            assert.equal(cpu.m[s.MouseFrameX], 115); assert.equal(cpu.m[s.MouseFrameY], 20);
            assert.equal(cpu.p & 4, 0); assert.ok(masked > 0 && longestMask < 30, `${longestMask} masked instructions`);
        });
        await t.test('pointer and drag ghost color follows the desktop light/dark appearance', () => {
            const cpu = prepare(80, 100);
            assert.equal(s.rpud3AppearanceDark, 0x08);
            cpu.m[s.GeosAppearancePrefs] = 0;
            cpu.call(s.Mouse1351ShowPointer);
            assert.equal(cpu.m[s.Sprite0Color], 0, 'black over light desktop');
            cpu.m[s.GeosAppearancePrefs] = s.rpud3AppearanceDark;
            cpu.call(s.Mouse1351ShowPointer);
            assert.equal(cpu.m[s.Sprite0Color], 1, 'white over dark desktop');
        });
    }, {apps: false, livePointer: true});
});
