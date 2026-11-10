import { appendFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { apps, yaml } from './validate.mjs';

const matrix = [];
for (const app of apps) {
  const config = await yaml(`${app}/config.yaml`);
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    const old = spawnSync('git', ['show', `origin/stable:${app}/config.yaml`], { encoding: 'utf8' });
    if (old.status === 0) {
      const { parse } = await import('yaml');
      const previous = parse(old.stdout);
      const changes = execFileSync('git', ['diff', '--name-only', 'origin/stable', 'HEAD', '--', `${app}/Dockerfile`, `${app}/run.sh`, `${app}/.dockerignore`, `${app}/*.mjs`], { encoding: 'utf8' });
      if (previous.version === config.version && changes.trim()) throw new Error(`${app}: bump config.yaml version before changing image contents`);
      if (previous.version !== config.version) {
        const parts = value => value.split('.').map(Number);
        const before = parts(previous.version), after = parts(config.version);
        const index = after.findIndex((value, i) => value !== before[i]);
        if (index < 0 || after[index] < before[index]) throw new Error(`${app}: version must increase`);
      }
    }
  }
  matrix.push({ app, version: config.version, name: config.image.split('/').at(-1), prefix: config.image.split('/').slice(0, -1).join('/'), architectures: JSON.stringify(config.arch) });
}
await appendFile(process.env.GITHUB_OUTPUT, `apps=${JSON.stringify({ include: matrix })}\n`);
