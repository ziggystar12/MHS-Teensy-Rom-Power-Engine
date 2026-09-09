const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {mkdtempSync, rmSync, existsSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');

test('production desktop file engine passes host storage fault injection', () => {
  const candidates = [process.env.CXX, 'g++', 'clang++', 'C:/msys64/mingw64/bin/g++.exe'].filter(Boolean);
  const compiler = candidates.find(candidate => spawnSync(candidate, ['--version'], {encoding: 'utf8'}).status === 0);
  assert.ok(compiler, 'Set CXX to a C++11-capable host compiler');
  const directory = mkdtempSync(path.join(tmpdir(), 'tr-desktop-file-ops-'));
  const executable = path.join(directory, process.platform === 'win32' ? 'file-ops.exe' : 'file-ops');
  const environment = {...process.env, PATH: path.dirname(compiler) + path.delimiter + process.env.PATH};
  try {
    const build = spawnSync(compiler, ['-std=c++11', '-Wall', '-Wextra', '-Werror',
      path.join(__dirname, 'desktop-file-ops.cpp'), '-o', executable], {encoding: 'utf8', env: environment});
    assert.equal(build.status, 0, build.stdout + build.stderr);
    assert.ok(existsSync(executable));
    const run = spawnSync(executable, [], {encoding: 'utf8', env: environment});
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /\d+ desktop file operation scenarios passed/);
    console.log(run.stdout.trim());
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
