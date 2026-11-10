import assert from 'node:assert/strict';
import { apps, yaml } from './validate.mjs';

// Intentionally anonymous: Supervisor cannot use the maintainer's GitHub login.
const accept = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';
for (const app of apps) {
  const config = await yaml(`${app}/config.yaml`);
  const imageName = config.image.replace('ghcr.io/', '');
  for (const [name, expected] of [[imageName, ['amd64', 'arm64']], ...config.arch.map(arch => [imageName.replace(/([^/]+)$/, `${arch}-$1`), [arch === 'aarch64' ? 'arm64' : 'amd64']])]) {
    const tokenResponse = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${name}:pull`);
    assert.ok(tokenResponse.ok, `${name}: anonymous access denied; make the GHCR package public before promotion`);
    const { token } = await tokenResponse.json();
    const request = async (path) => {
      const result = await fetch(`https://ghcr.io/v2/${name}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
      assert.ok(result.ok, `${name}/${path}: anonymous pull failed (${result.status})`);
      return result;
    };
    const response = await request(`manifests/${config.version}`);
    const digest = response.headers.get('docker-content-digest');
    const index = await response.json();
    assert.ok(Array.isArray(index.manifests), `${name}: expected a platform manifest index`);
    const platforms = index.manifests.filter(item => item.platform?.os === 'linux' && item.platform?.architecture !== 'unknown');
    assert.deepEqual([...new Set(platforms.map(item => item.platform.architecture))].sort(), expected.sort(), `${name}: wrong platforms`);
    for (const platform of platforms) {
      const manifest = await (await request(`manifests/${platform.digest}`)).json();
      const metadata = await (await request(`blobs/${manifest.config.digest}`)).json();
      const labels = metadata.config.Labels;
      assert.equal(labels['io.hass.type'], 'app');
      assert.equal(labels['io.hass.version'], config.version);
      assert.equal(labels['io.hass.arch'], platform.platform.architecture === 'arm64' ? 'aarch64' : 'amd64');
    }
    console.log(JSON.stringify({ image: `ghcr.io/${name}:${config.version}`, digest, platforms: expected, anonymous: true }));
  }
}
