// SPDX-License-Identifier: GPL-2.0-or-later
// Standalone corresponding-source build; requires no game data or converter.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {packVmImage} from './vm-image.mjs';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'source-manifest.json')));
const out=path.resolve(process.argv[2]??path.join(root,'output'));
const prefix=process.env.MPE_ARM_PREFIX??'arm-none-eabi-';
const suffix=process.platform==='win32'?'.exe':'';
const env={...process.env},key=Object.keys(env).find(k=>k.toUpperCase()==='PATH')??'PATH';
// Pin __DATE__ for a reproducible release instead of embedding today's date.
if(manifest.sourceDateEpoch!==undefined)env.SOURCE_DATE_EPOCH=String(manifest.sourceDateEpoch);
env[key]=path.dirname(prefix)+path.delimiter+(env[key]??'');
fs.mkdirSync(out,{recursive:true});
function run(name,args){
    const r=spawnSync(prefix+name+suffix,args,{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
    assert.ifError(r.error);assert.equal(r.status,0,(r.stdout+r.stderr).slice(-4000));return r.stdout;
}
const cpu=['-mcpu=cortex-m7','-mthumb','-mfpu=fpv5-d16','-mfloat-abi=hard'];
const common=['-Os','-funsigned-char','-fno-strict-aliasing','-fwrapv','-ffunction-sections','-fdata-sections',
    '-fno-unwind-tables','-fno-asynchronous-unwind-tables','-fstack-usage',
    '-I',path.join(root,'core/include'),'-I',path.join(root,'Source/VM/doom/gba'),'-include',path.join(root,'Source/VM/doom/gba/core_api.h')];
const objects=[];
for(const source of manifest.sources){
    const cpp=source.endsWith('.cpp'),object=path.join(out,path.basename(source)+'.o');
    run(cpp?'g++':'gcc',[...cpu,...common,cpp?'-std=c++17':'-std=gnu11',
        ...(cpp?['-fno-exceptions','-fno-rtti','-fno-threadsafe-statics']:[]),'-c',path.join(root,source),'-o',object]);
    objects.push(object);
}
const elf=path.join(out,'doomvm.elf');
const wraps=['malloc','calloc','realloc','free','_malloc_r','_calloc_r','_realloc_r','_free_r'].map(n=>'-Wl,--wrap='+n);
run('g++',[...cpu,'-nostartfiles','--specs=nano.specs',...objects,...wraps,'-Wl,--gc-sections','-lc','-lm','-lgcc',
    '-T',path.join(root,'Source/VM/doom/gba/module.ld'),'-Wl,-Map='+path.join(out,'doomvm.map'),'-o',elf]);
assert.equal(run('nm',['-u',elf]).trim(),'');
const symbols=run('nm',['-n',elf]),sizes=run('size',['-A',elf]),sections={};
for(const name of ['text','data','rodata2']){
    const file=path.join(out,name+'.bin');run('objcopy',['-O','binary','--only-section=.'+name,elf,file]);sections[name]=fs.readFileSync(file);
}
const module=packVmImage({code:sections.text,data:sections.data,rodata:sections.rodata2,
    bssBytes:Number(sizes.match(/^\.bss\s+(\d+)/m)?.[1]),entry:parseInt(symbols.match(/^([0-9a-f]+) T vm_entry$/m)?.[1],16)|1,
    requiredServices:211,profile:1});
fs.writeFileSync(path.join(out,'engine.mvm'),module);
const sha256=crypto.createHash('sha256').update(module).digest('hex');
console.log(JSON.stringify({bytes:module.length,sha256,compiler:run('gcc',['-dumpfullversion']).trim(),
    matchesRelease:sha256===manifest.moduleSha256},null,2));
