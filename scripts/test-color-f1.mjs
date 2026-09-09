// SPDX-License-Identifier: MIT
// Host regression suite; no firmware release, download or flash.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'build/color-f1/tests');fs.mkdirSync(out,{recursive:true});
const compiler=process.env.CXX??'C:/msys64/mingw64/bin/g++.exe';
const env={...process.env},key=Object.keys(env).find(k=>k.toUpperCase()==='PATH');env[key]=path.dirname(compiler)+path.delimiter+env[key];
for(const name of ['color_f1_test','color_f1_host_test','indexed_ram2_source_test','indexed_timing_test','mpe_video_live_test','mpe_video_crop_test','mpe_video_detail_test','mpe_video_sprite_test','indexed_host_test','full_video_converter_test','full_video_host_test']){
 const exe=path.join(out,name+'.exe');
 for(const [tool,args] of [[compiler,['-std=c++17','-O2','-I.','Source/VM/tests/'+name+'.cpp','-static','-o',exe]],[exe,name==='color_f1_test'?process.argv.slice(2):[]]]){
  const r=spawnSync(tool,args,{cwd:root,env,windowsHide:true,encoding:'utf8',maxBuffer:4e6});assert.ifError(r.error);
  process.stdout.write(r.stdout);process.stderr.write(r.stderr);assert.equal(r.status,0,name);
 }
}
