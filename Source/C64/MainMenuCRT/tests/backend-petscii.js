'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the wire encoding used by the real IO1 serial-message channel.
// Raw filename selectors deliberately do not use this conversion.
const source = fs.readFileSync(path.resolve(__dirname,
    '../../../Teensy/MinimalBoot/Common/IO_Handlers/IOH_TeensyROM.c'), 'utf8');
const body = source.match(/uint8_t ASCIItoPETSCII\[128\]\s*=\s*\{([\s\S]*?)\};/)[1];
const table = [...body.matchAll(/\/\*[^\r\n]*?\*\/\s*(\d+),/g)].map(match => Number(match[1]));
assert.equal(table.length, 128, 'read the actual backend conversion table');
const backendPETSCII = text => Buffer.from([...Buffer.from(text, 'latin1')].map(code => table[code & 127]));
module.exports = { backendPETSCII };
