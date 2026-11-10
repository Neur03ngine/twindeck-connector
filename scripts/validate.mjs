import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseDocument } from 'yaml';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const apps = ['hello_world', 'twindeck_connector'];
export async function yaml(path) {
  const doc = parseDocument(await readFile(resolve(root, path), 'utf8'), { uniqueKeys: true });
  assert.equal(doc.errors.length, 0, `${path}: ${doc.errors.map(e => e.message).join('; ')}`);
  return doc.toJS();
}
export async function validate() {
  const repository = await yaml('repository.yaml');
  assert.equal(repository.url, 'https://github.com/Neur03ngine/twindeck-connector');
  assert.ok(repository.name && repository.maintainer);
  const keys = new Set(['name', 'version', 'slug', 'description', 'url', 'image', 'arch', 'init', 'startup', 'boot', 'stage', 'timeout', 'homeassistant_api', 'options', 'schema']);
  const images = new Set();
  for (const app of apps) {
    const config = await yaml(`${app}/config.yaml`);
    for (const key of Object.keys(config)) assert.ok(keys.has(key), `${app}: unexpected configuration key ${key}`);
    for (const key of ['name', 'description', 'version', 'slug', 'url', 'image']) assert.ok(typeof config[key] === 'string' && config[key].length, `${app}: missing ${key}`);
    assert.equal(config.slug, app);
    assert.match(config.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual([...config.arch].sort(), ['aarch64', 'amd64']);
    assert.equal(config.init, false, 's6-overlay requires init: false');
    assert.match(config.image, /^ghcr\.io\/neur03ngine\/[a-z0-9-]+$/, 'image must be lowercase and have no tag');
    assert.ok(!images.has(config.image), 'apps must use distinct images'); images.add(config.image);
    assert.equal(new URL(config.url).protocol, 'https:');
    assert.deepEqual(Object.keys(config.options).sort(), Object.keys(config.schema).sort());
    for (const name of ['Dockerfile', 'run.sh', 'DOCS.md', 'README.md', 'CHANGELOG.md', '.dockerignore']) {
      const text = await readFile(resolve(root, app, name), 'utf8');
      assert.ok(text.length > 0); assert.ok(!text.includes('\r'), `${app}/${name}: requires LF endings`);
      if (name === 'Dockerfile') {
        assert.match(text, /^FROM ghcr\.io\/home-assistant\/base:3\.24$/m);
        assert.match(text, /io\.hass\.type="app"/);
        assert.match(text, /io\.hass\.arch="\$\{BUILD_ARCH\}"/);
        assert.match(text, /io\.hass\.version="\$\{BUILD_VERSION\}"/);
        assert.match(text, /CMD \["\/run\.sh"\]/);
      }
      if (name === 'run.sh') assert.match(text, /^#!\/command\/with-contenv bash(?:io)?\n# shellcheck shell=bash\nset -euo pipefail/);
    }
    const changelog = await readFile(resolve(root, app, 'CHANGELOG.md'), 'utf8');
    assert.ok(changelog.includes(`## ${config.version}`), `${app}: missing changelog version`);
    for (const name of await readdir(resolve(root, app))) if (name.endsWith('.mjs')) {
      const check = spawnSync(process.execPath, ['--check', resolve(root, app, name)], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    }
  }
  // Supervisor recursively discovers config files. Catch accidentally shipped fixtures.
  async function discover(path = '') {
    const found = [];
    for (const entry of await readdir(resolve(root, path), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['rootfs', 'node_modules'].includes(entry.name)) continue;
      const relative = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) found.push(...await discover(relative));
      else if (/^config\.(yaml|yml|json)$/.test(entry.name)) found.push(relative);
    }
    return found;
  }
  assert.deepEqual((await discover()).sort(), apps.map(app => `${app}/config.yaml`).sort());
  for (const name of await readdir(resolve(root, '.github/workflows'))) await yaml(`.github/workflows/${name}`);
  console.log('Validated repository, both app configurations, image/version references, scripts and workflows.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await validate();
