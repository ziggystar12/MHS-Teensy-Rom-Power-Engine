'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {desktopMachine} = require('./desktop-machine');

test('relocated Popcorn preserves every SID write and instruction timing through a complete loop', t => desktopMachine(t, ({fresh, menuDir}) => {
    const original = fs.readFileSync(path.join(__dirname, 'fixtures/Popcorn-original.sid'));
    const header = fs.readFileSync(path.resolve(menuDir, '../../Teensy/TRMenuFiles/SIDs/Popcorn.sid.h'), 'utf8');
    const relocated = Buffer.from([...header.matchAll(/0x([0-9a-f]{2})/gi)].map(m => parseInt(m[1], 16)));
    assert.deepEqual(relocated.subarray(14, 120), original.subarray(14, 120), 'song, clock, SID model and attribution preserved');
    assert.equal(relocated.readUInt16LE(124), 0xe000);
    assert.equal(relocated.readUInt16BE(10), 0xe000);
    assert.equal(relocated.readUInt16BE(12), 0xe006);
    assert.ok(0xe000 + relocated.length - 126 <= 0xf000, 'fits existing music RAM');
    const tunes = [original, relocated];
    const cpus = tunes.map(tune => {
        const cpu = fresh();
        cpu.m.fill(0); cpu.m[1] = 0x35;
        const load = tune.readUInt16LE(124), end = load + tune.length - 126;
        tune.subarray(126).copy(cpu.m, load);
        cpu.steps = 0; cpu.trace = []; cpu.execution = [];
        const step = cpu.step.bind(cpu);
        cpu.step = () => {
            assert.ok(cpu.pc >= load && cpu.pc < end, 'player executes within its own RAM');
            cpu.execution.push(cpu.pc - load, cpu.m[cpu.pc]);
            cpu.steps++; step();
        };
        cpu.onWrite = (address, value) => {
            assert.ok(address < 512 || (address >= load && address < end) ||
                (address >= 0xd400 && address <= 0xd418), `player writes outside its RAM/SID: $${address.toString(16)}`);
            if (address >= 0xd400 && address <= 0xd418) cpu.trace.push(cpu.steps, address, value);
        };
        return cpu;
    });
    const seen = new Map();
    let writes = 0;
    for (let frame = -1; frame < 100000; frame++) {
        cpus.forEach((cpu, i) => {
            cpu.trace = []; cpu.execution = []; cpu.steps = 0;
            cpu.call(tunes[i].readUInt16BE(frame < 0 ? 10 : 12));
        });
        // All instructions follow the same path; page alignment and all
        // indexed effective-address low bytes preserve page-cross timing.
        assert.equal(cpus[1].steps, cpus[0].steps, `instruction count at frame ${frame}`);
        assert.deepEqual(cpus[1].execution, cpus[0].execution, `instruction path at frame ${frame}`);
        assert.deepEqual(cpus[1].trace, cpus[0].trace, `exact SID write sequence at frame ${frame}`);
        writes += cpus[0].trace.length / 3;
        const hash = crypto.createHash('sha256');
        for (let i = 0; i < 2; i++) {
            const cpu = cpus[i], load = tunes[i].readUInt16LE(124);
            hash.update(cpu.m.subarray(2, 256));
            hash.update(cpu.m.subarray(load, load + tunes[i].length - 126));
            hash.update(cpu.m.subarray(0xd400, 0xd419));
            hash.update(Buffer.from([cpu.a, cpu.x, cpu.y, cpu.p, cpu.sp]));
        }
        const state = hash.digest('hex');
        if (seen.has(state)) {
            assert.ok(frame > 1000 && writes > 10000, 'covers music progression');
            t.diagnostic(`${writes} identical SID writes; full player-state loop ${seen.get(state)}..${frame}`);
            return;
        }
        seen.set(state, frame);
    }
    assert.fail('no complete player-state loop within 100000 calls');
}));
