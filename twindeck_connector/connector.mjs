import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { HomeAssistant } from './home-assistant.mjs';
import { boundedJson, cloudOrigin, sanitizeState, validateJob, VERSION } from './protocol.mjs';

export class Connector {
  constructor({ origin, pairingCode, sitesServiceToken = '', homeAssistant, dataDirectory = '/data', fetcher = fetch, log = console.log }) {
    this.origin = origin; this.pairingCode = pairingCode; this.ha = homeAssistant; this.dataDirectory = dataDirectory; this.fetcher = fetcher; this.log = log;
    this.results = []; this.executed = new Set(); this.stopped = false;
    this.sitesServiceToken = sitesServiceToken;
  }
  async cloud(path, input, token) {
    const signal = AbortSignal.any([AbortSignal.timeout(15000), ...(this.abort ? [this.abort.signal] : [])]);
    const response = await this.fetcher(`${this.origin}/api/devices/connector/${path}`, { method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(this.sitesServiceToken ? { 'OAI-Sites-Authorization': `Bearer ${this.sitesServiceToken}` } : {}) }, body: JSON.stringify(input) });
    if (!response.ok) { const error = new Error(`TwinDeck returned HTTP ${response.status}.`); error.status = response.status; throw error; }
    let value;
    try { value = await boundedJson(response, 500000); } catch { throw new Error('TwinDeck returned an invalid connector response.'); }
    if (value.protocol !== VERSION) throw new Error('Unsupported TwinDeck connector protocol.');
    return value;
  }
  async pair() {
    const file = join(this.dataDirectory, 'connection.json');
    let saved;
    try { saved = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read connector credentials. Restore the add-on data or pair again.'); }
    // Changing the origin never forwards an existing credential to another server.
    if (saved?.origin === this.origin && /^[a-f0-9]{64}$/.test(saved.token) && (!this.pairingCode || saved.pairingCode === this.pairingCode)) { this.credentials = saved; return; }
    if (!/^[a-f0-9]{32}$/.test(this.pairingCode || '')) throw new Error('Enter a fresh pairing code from TwinDeck settings.');
    const response = await this.cloud('claim', { pairingCode: this.pairingCode });
    if (!/^[a-f0-9]{64}$/.test(response.token) || typeof response.connectorId !== 'string') throw new Error('Invalid pairing response.');
    const credentials = { origin: this.origin, token: response.token, connectorId: response.connectorId, pairingCode: this.pairingCode };
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
    await writeFile(file + '.tmp', JSON.stringify(credentials), { mode: 0o600 }); await rename(file + '.tmp', file);
    this.credentials = credentials; this.log('Paired with your TwinDeck home.');
  }
  async execute(raw) {
    if (this.executed.has(raw?.id)) return;
    if (this.executed.size > 1000) this.executed.clear();
    if (typeof raw?.id === 'string') this.executed.add(raw.id);
    try {
      const job = validateJob(raw);
      if (!this.ha.connected) throw new Error('Home Assistant is offline.');
      let result = await this.ha.request(job.path, job.method, job.body);
      if (job.path === '/config') result = { unit_system: { temperature: result.unit_system?.temperature }, time_zone: result.time_zone };
      else if (job.path === '/states') result = result.map(sanitizeState);
      else if (job.path.startsWith('/states/')) result = sanitizeState(result);
      else if (job.path.startsWith('/history/period/')) result = result.map(series => series.map(sanitizeState));
      else result = null; // Service responses can contain unrelated entity data.
      if (Buffer.byteLength(JSON.stringify(result)) > 490000) throw new Error('Home Assistant result is too large.');
      return { id: job.id, ok: true, result };
    } catch {
      this.log('A device operation was not confirmed. Check Home Assistant and the device state.');
      return { id: typeof raw?.id === 'string' ? raw.id : '', ok: false };
    }
  }
  async exchange() {
    const snapshot = this.ha.snapshot();
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized) > 1500000) { const error = new Error('Home Assistant snapshot exceeds the connector limit of 1.5 MB.'); error.permanent = true; throw error; }
    // Upload changes promptly and re-confirm an unchanged snapshot periodically.
    const sendSnapshot = serialized !== this.lastSnapshot || Date.now() - (this.lastSnapshotAt || 0) >= 15000;
    const sent = []; let bytes = 0;
    for (const result of this.results) { const size = Buffer.byteLength(JSON.stringify(result)); if (bytes + size > 500000) break; sent.push(result); bytes += size; }
    const response = await this.cloud('exchange', { ...(sendSnapshot ? { snapshot } : {}), results: sent }, this.credentials.token);
    if (sendSnapshot) { this.lastSnapshot = serialized; this.lastSnapshotAt = Date.now(); }
    this.results = this.results.slice(sent.length);
    if (!Array.isArray(response.jobs) || response.jobs.length > 10) throw new Error('Invalid connector job list.');
    this.results.push(...(await Promise.all(response.jobs.map(job => this.execute(job)))).filter(Boolean));
    return this.results.length ? 0 : Math.max(1000, Math.min(10000, Number(response.pollAfterMs) || 3000));
  }
  stop() { this.stopped = true; this.abort?.abort(); this.ha.stop(); }
  async run() {
    this.abort = new AbortController(); let failures = 0;
    try {
      await this.pair();
      if (this.stopped) return;
      this.ha.start();
      this.log('Connector running. The Home Assistant credential stays inside this add-on.');
      while (!this.stopped) {
        let delay;
        try { delay = await this.exchange(); failures = 0; }
        catch (error) {
          if (this.stopped) break;
          if (error.permanent) throw error;
          if (error.status === 401 || error.status === 403) throw new Error('Connector access was revoked or denied. Generate a new pairing code in TwinDeck, update Configuration, and restart.');
          delay = Math.min(60000, 2000 * 2 ** Math.min(failures++, 5));
          this.log('TwinDeck is unavailable. Reconnecting automatically.');
        }
        await sleep(delay, undefined, { signal: this.abort.signal }).catch(() => {});
      }
    } finally { this.ha.stop(); }
  }
}

async function main() {
  const dataDirectory = process.env.TWINDECK_DATA_DIR || '/data';
  let options;
  try { options = JSON.parse(await readFile(join(dataDirectory, 'options.json'), 'utf8')); } catch { throw new Error('Cannot read add-on Configuration. Save the URL and pairing code, then restart.'); }
  const origin = cloudOrigin(options.twindeck_url);
  if (!process.env.SUPERVISOR_TOKEN) throw new Error('Supervisor did not provide a Home Assistant API credential.');
  const ha = new HomeAssistant({ token: process.env.SUPERVISOR_TOKEN });
  const connector = new Connector({ origin, pairingCode: options.pairing_code?.trim(), sitesServiceToken: options.sites_service_token?.trim(), homeAssistant: ha, dataDirectory });
  process.once('SIGTERM', () => connector.stop()); process.once('SIGINT', () => connector.stop());
  await connector.run();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Connector could not start.'); process.exitCode = 1; });
}
