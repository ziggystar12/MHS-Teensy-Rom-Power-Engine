'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

test('firmware parser fails closed on malformed, truncated, and out-of-range HEX files',()=>{
  const compiler=[process.env.CXX,'g++','clang++','C:/msys64/mingw64/bin/g++.exe'].filter(Boolean)
    .find(candidate=>spawnSync(candidate,['--version'],{encoding:'utf8'}).status===0);
  assert.ok(compiler,'C++11 host compiler required');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'firmware-parser-'));
  try {
    const output=path.join(temporary,process.platform==='win32'?'parser.exe':'parser');
    const env={...process.env,PATH:path.dirname(compiler)+path.delimiter+process.env.PATH};
    const build=spawnSync(compiler,['-std=c++11','-Wall','-Wextra','-Werror',
      path.join(__dirname,'flash-update-parser.cpp'),'-o',output],{encoding:'utf8',env});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const run=spawnSync(output,[],{encoding:'utf8',env});
    assert.equal(run.status,0,run.stdout+run.stderr);
    assert.match(run.stdout,/25 flash parser safety scenarios passed/);
  } finally {
    assert.equal(path.dirname(temporary),path.resolve(os.tmpdir()));
    fs.rmSync(temporary,{recursive:true,force:true});
  }
});
