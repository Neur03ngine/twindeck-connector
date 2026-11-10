import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './validate.mjs';

const [app, image] = process.argv.slice(2);
assert.ok(['hello_world', 'twindeck_connector'].includes(app) && image);
const directory = await mkdtemp(join(tmpdir(), 'twindeck-smoke-'));
const docker = args => spawnSync('docker', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 2e6 });
try {
  const syntax = docker(['run', '--rm', '--entrypoint', '/bin/bash', image, '-n', '/run.sh']);
  assert.equal(syntax.status, 0, syntax.stderr);
  const options = app === 'hello_world' ? { message: 'TwinDeck smoke test passed' } : { twindeck_url: 'https://twindeck.example', pairing_code: '', sites_service_token: '' };
  await writeFile(join(directory, 'options.json'), JSON.stringify(options));
  const result = docker(['run', '--rm', '-v', `${directory}:/data`, image]);
  const output = result.stdout + result.stderr;
  if (app === 'hello_world') {
    assert.equal(result.status, 0, output); assert.match(output, /TwinDeck smoke test passed/);
    await writeFile(join(directory, 'options.json'), JSON.stringify({ message: '' }));
    const invalid = docker(['run', '--rm', '-v', `${directory}:/data`, image]);
    assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
  } else {
    assert.equal(result.status, 1, output);
    assert.match(output, /Supervisor did not provide a Home Assistant API credential/);
    // Execute the real connector suite in the actual architecture's Node/Alpine image.
    const tests = docker(['run', '--rm', '-v', `${root}:/repo:ro`, '--workdir', '/repo', '--entrypoint', 'node', image, '--test', 'tests/connector.test.mjs']);
    assert.equal(tests.status, 0, tests.stdout + tests.stderr);
    console.log(tests.stdout);
  }
  console.log(`${app}: container entry point and runtime checks passed.`);
} finally { await rm(directory, { recursive: true, force: true }); }
