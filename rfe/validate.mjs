// SPDX-License-Identifier: MIT
// Inspect a vendor development payload. This does not package or install .trx.
import fs from 'node:fs';
import path from 'node:path';
import {validateHostImage} from './lib/contract.mjs';
import {decodeHostHex} from './lib/image.mjs';

const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
  console.log('node rfe/validate.mjs PATH.bin|PATH.hex\nValidates a raw development image; no .trx format or installation is provided.');
}else{
  try{
    if(args.length!==1)throw Error('Supply one raw .bin or .hex development image.');
    const extension=path.extname(args[0]).toLowerCase();
    if(!['.bin','.hex'].includes(extension))throw Error('Only .bin and .hex are supported; the authoritative .trx codec is still pending.');
    const input=fs.readFileSync(args[0]);
    const decoded=extension==='.hex'?decodeHostHex(input):null;
    console.log(JSON.stringify({image:validateHostImage(decoded?.payload??input),...(decoded?{hex:decoded.report}:{})},null,2));
  }catch(error){
    console.error('RFE image validation failed: '+error.message);
    process.exitCode=1;
  }
}
