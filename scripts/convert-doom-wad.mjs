// SPDX-License-Identifier: GPL-2.0-or-later
// Prepare user-supplied Doom shareware 1.9 data; no firmware/engine build needed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const commit = '89097b3ff31ac1e1b2cdce9854e49726cfa462bf';
const wadSha = '1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771';
const outputSha = 'ced4f5804b2dafd9cc9db781ba1e82a4c7a0e4de14c2de885007add10e76d5da';
const converterFiles = {
    'GbaWadUtil.exe': 'e18af04285a8b1c2bf884c6db58377059c7fb6f449ba41125c6cec5cedbc621f',
    'Qt5Core.dll': 'b4cfab7f3b08814cbfc30c5e20eaea69080da656ec9b98f1ae43bf6e4fd15369',
    'gbadoom.wad': '458361df4ef4b1cd14d27ff9e283320eff97b88b1469e72bcc26770621bf55d9',
};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function check(ok, message) { if (!ok) throw new Error(message); }
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

async function main() {
    const args = process.argv.slice(2);
    if (!args.length || args.includes('--help')) {
        console.log('Windows, Node.js 22 or newer:\n' +
            '  node convert-doom-wad.mjs --wad "C:/Downloads/DOOM1.WAD" --out "C:/DoomVM/doom1.gbd"\n' +
            'Optional: --converter "C:/GBADoom/GbaWadUtil" for offline conversion.\n' +
            'Otherwise the three pinned, hash-checked GBADoom conversion files are downloaded.\n' +
            'Only original Doom shareware 1.9 is accepted. Existing output is never overwritten.');
        return;
    }
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
        check(['--wad', '--out', '--converter'].includes(args[i]) && args[i + 1] &&
            !args[i + 1].startsWith('--') && !options[args[i]], 'Invalid arguments; use --help.');
        options[args[i]] = args[i + 1];
    }
    check(options['--wad'] && options['--out'], 'Specify both --wad and --out; use --help.');
    check(process.platform === 'win32', 'This helper uses the upstream Windows converter.');
    const input = path.resolve(options['--wad']);
    const output = path.resolve(options['--out']);
    check(path.extname(output).toLowerCase() === '.gbd', '--out must name a .gbd file.');
    check(!fs.existsSync(output), 'Output already exists; choose a new path.');
    const original = fs.readFileSync(input);
    check(original.length === 4196020 && hash(original) === wadSha,
        'Expected unmodified Doom shareware 1.9 DOOM1.WAD (4,196,020 bytes). ' +
        'Registered/Ultimate Doom, Doom II, mods and renamed .gbd files are unsupported.');

    // Use a fresh private folder so the converter cannot pick up stale output.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mpe-doom-data-'));
    console.log('Conversion workspace: ' + work);
    for (const [name, expected] of Object.entries(converterFiles)) {
        let bytes;
        if (options['--converter']) {
            bytes = fs.readFileSync(path.join(path.resolve(options['--converter']), name));
        } else {
            const url = `https://raw.githubusercontent.com/doomhack/GBADoom/${commit}/GbaWadUtil/${name}`;
            console.log('Downloading ' + name);
            const response = await fetch(url, {signal: AbortSignal.timeout(60000)});
            check(response.ok, `Download failed for ${name}: HTTP ${response.status}`);
            bytes = Buffer.from(await response.arrayBuffer());
        }
        check(hash(bytes) === expected, name + ' does not match the supported converter version.');
        fs.writeFileSync(path.join(work, name), bytes, {flag: 'wx'});
    }
    // Snapshot the validated WAD. The supplied original is never edited.
    fs.writeFileSync(path.join(work, 'doom1.wad'), original, {flag: 'wx'});
    const result = spawnSync(path.join(work, 'GbaWadUtil.exe'),
        ['-in', 'doom1.wad', '-out', 'converted.wad'],
        {cwd: work, windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024});
    fs.writeFileSync(path.join(work, 'conversion.log'), (result.stdout ?? '') + (result.stderr ?? ''));
    check(!result.error && result.status === 0,
        'Conversion failed; see ' + path.join(work, 'conversion.log') + (result.error ? ': ' + result.error.message : ''));
    const payload = fs.readFileSync(path.join(work, 'converted.wad'));
    check(payload.toString('ascii', 0, 4) === 'IWAD', 'Converter did not produce a converted IWAD.');
    const header = Buffer.alloc(16);
    header.write('GBDWAD1');
    header.writeUInt32LE(payload.length, 8);
    header.writeUInt32LE(crc32(payload), 12);
    const data = Buffer.concat([header, payload]);
    check(data.length === 3842060 && hash(data) === outputSha,
        'Converted data differs from the supported DoomVM data; no output written.');
    check(hash(fs.readFileSync(input)) === wadSha, 'Input changed during conversion; no output written.');
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, data, {flag: 'wx'});
    console.log(`Created ${output}\nBytes: ${data.length}\nSHA-256: ${hash(data)}\n` +
        'Copy this file to VMS/DOOMVM/doom1.gbd on the SD card. Music is optional.');
}

main().catch(error => { console.error('Doom data preparation: ' + error.message); process.exitCode = 1; });
