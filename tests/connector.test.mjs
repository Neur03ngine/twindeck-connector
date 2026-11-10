import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Connector } from '../twindeck_connector/connector.mjs';
import { HomeAssistant } from '../twindeck_connector/home-assistant.mjs';
import { boundedJson, cloudOrigin, sanitizeState, validateJob } from '../twindeck_connector/protocol.mjs';
import { ConnectorHomeAssistantSocket as FakeSocket } from './helpers/connector-home-assistant.mjs';

const state = (value = 'on') => ({ entity_id: 'light.kitchen', state: value, attributes: { brightness: 123, friendly_name: 'Kitchen', access_token: 'ha-secret' } });
const job = (changes = {}) => ({ id: crypto.randomUUID(), path: '/services/light/turn_off', method: 'POST', body: { entity_id: ['light.kitchen'] }, expiresAt: Date.now() + 20000, ...changes });
const credential = 'a'.repeat(64), code = 'b'.repeat(32);

test('HTTPS origin and response bounds protect credentials', async () => {
  assert.equal(cloudOrigin('https://twindeck.example/'), 'https://twindeck.example');
  for (const url of ['http://twindeck.example','https://user:secret@twindeck.example','https://twindeck.example/settings','https://twindeck.example/?secret=x']) assert.throws(() => cloudOrigin(url));
  await assert.rejects(boundedJson(new Response('"too large"'), 5), /too large/);
  assert.equal(sanitizeState(state()).attributes.access_token, undefined);
});
test('local validation rejects expired jobs, administrator APIs, wrong targets and extra service fields', () => {
  assert.equal(validateJob(job()).path, '/services/light/turn_off');
  for (const changes of [{ expiresAt: 0 }, { expiresAt: Date.now() + 60000 }, { path: '/auth' }, { path: '//router/admin' }, { path: '/services/shell_command/run' }, { body: { entity_id: 'switch.other' } }, { body: { entity_id: 'light.kitchen', profile: 'unrestricted' } }, { body: { entity_id: 'light.kitchen', brightness: 256 } }, { body: { entity_id: 'light.kitchen', rgb_color: [1,2] } }]) assert.throws(() => validateJob(job(changes)));
});
test('timer automation is rebuilt locally and cannot carry arbitrary cloud actions', () => {
  const timer = job({ path: '/config/automation/config/twindeck_test', body: { description: JSON.stringify({ twindeck: 1, entityIds: ['light.kitchen'], action: 'turn_off', dueAt: new Date(Date.now() + 120000).toISOString() }), actions: [{ action: 'shell_command.run' }] } });
  const safe = validateJob(timer); assert.equal(safe.body.actions[1].action, 'light.turn_off'); assert.doesNotMatch(JSON.stringify(safe), /shell_command/);
  assert.throws(() => validateJob(job({ ...timer, body: { description: JSON.stringify({ twindeck: 1, entityIds: ['switch.other'], action: 'turn_off', dueAt: new Date(Date.now() + 120000).toISOString() }) } })));
});
test('pairing persists only connector credentials, survives restart, and never sends Supervisor token', async () => {
  const root = process.platform === 'win32' ? fileURLToPath(new URL('../tmp/connector-runtime/', import.meta.url)) : join(tmpdir(), 'twindeck-connector-tests'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'connector-')); const calls = [], logs = []; let claims = 0;
  const fetcher = async (url, options) => { calls.push([url, options]); claims++; return Response.json({ protocol: 1, connectorId: 'test-connector', token: credential }); };
  try {
    const connector = new Connector({ origin: 'https://twindeck.example', pairingCode: code, dataDirectory: dir, homeAssistant: { token: 'supervisor-secret' }, fetcher, log: value => logs.push(value) });
    await connector.pair();
    const persisted = await readFile(join(dir, 'connection.json'), 'utf8'); assert.doesNotMatch(persisted, /supervisor-secret/);
    const restarted = new Connector({ origin: 'https://twindeck.example', pairingCode: code, dataDirectory: dir, homeAssistant: {}, fetcher }); await restarted.pair();
    assert.equal(claims, 1); assert.equal(restarted.credentials.token, credential);
    assert.doesNotMatch(JSON.stringify([calls, logs]), /supervisor-secret/);
    assert.equal(calls[0][1].redirect, 'error');
    const other = new Connector({ origin: 'https://different.example', pairingCode: code, dataDirectory: dir, homeAssistant: {}, fetcher, log: () => {} }); await other.pair();
    assert.equal(calls[1][1].headers.Authorization, undefined, 'existing credentials never go to a different origin');
  } finally { assert.ok(resolve(dir).startsWith(resolve(root) + sep)); await rm(dir, { recursive: true, force: true }); }
});
test('exchange retains acknowledgements on network failure and never re-executes a duplicate job', async () => {
  const command = job(); let fetches = 0, actions = 0;
  const connector = new Connector({ origin: 'https://twindeck.example', homeAssistant: { connected: true, snapshot: () => ({ connected: true }), request: async () => { actions++; return []; } }, log: () => {}, fetcher: async () => {
    fetches++; if (fetches === 2) throw new Error('Network interrupted');
    return Response.json({ protocol: 1, jobs: fetches < 4 ? [command] : [], pollAfterMs: 3000 });
  } }); connector.credentials = { token: credential };
  await connector.exchange(); assert.equal(actions, 1); assert.equal(connector.results.length, 1);
  await assert.rejects(connector.exchange(), /Network interrupted/); assert.equal(connector.results.length, 1);
  await connector.exchange(); assert.equal(actions, 1); assert.equal(connector.results.length, 0);
});
test('a local error is acknowledged without disclosing response details or credentials', async () => {
  const logs = [];
  const connector = new Connector({ origin: 'https://twindeck.example', homeAssistant: { connected: true, request: async () => { throw new Error('supervisor-secret'); } }, log: value => logs.push(value) });
  const result = await connector.execute(job()); assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify([result, logs]), /supervisor-secret/);
});

test('Home Assistant proxy authenticates locally, discovers rooms, receives state changes and stops cleanly', async () => {
  let socket; const calls = [];
  const ha = new HomeAssistant({ token: 'supervisor-secret', socketFactory: () => (socket = new FakeSocket()), fetcher: async (url, options) => { calls.push([url, options]); return Response.json({ unit_system: { temperature: '°C' }, time_zone: 'Europe/Amsterdam' }); } });
  try {
    ha.start(); for (let i = 0; i < 100 && !ha.connected; i++) await sleep(5);
    assert.equal(ha.connected, true); assert.equal(ha.snapshot().entities[0].attributes.brightness, 123);
    assert.equal(ha.snapshot().discovery.areas[0].name, 'Kitchen'); assert.doesNotMatch(JSON.stringify(ha.snapshot()), /access_token|configuration_url|secret/);
    assert.equal(calls[0][0], 'http://supervisor/core/api/config'); assert.equal(calls[0][1].headers.Authorization, 'Bearer supervisor-secret');
    assert.equal(socket.messages[0].access_token, 'supervisor-secret');
    socket.emit({ type: 'event', event: { event_type: 'state_changed', data: { entity_id: 'light.kitchen', new_state: state('off') } } });
    assert.equal(ha.snapshot().entities[0].state, 'off');
    socket.emit({ type: 'event', event: { event_type: 'state_changed', data: { entity_id: 'light.kitchen', new_state: null } } });
    assert.equal(ha.snapshot().entities.length, 0);
  } finally { ha.stop(); }
  assert.equal(ha.connected, false); assert.equal(socket.readyState, 3);
});

test('shutdown aborts an in-flight cloud exchange without reconnecting', async () => {
  let signal, started = 0, stopped = 0;
  const logs = [];
  const ha = { start: () => started++, stop: () => stopped++, snapshot: () => ({ connected: true }) };
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const connector = new Connector({ origin: 'https://twindeck.example', homeAssistant: ha, log: value => logs.push(value), fetcher: async (_url, options) => {
    signal = options.signal; entered();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  connector.pair = async () => { connector.credentials = { token: credential }; };
  const running = connector.run();
  try { await ready; connector.stop(); await running; }
  finally { connector.stop(); }
  assert.equal(signal.aborted, true); assert.equal(started, 1); assert.ok(stopped >= 1);
  assert.ok(logs.every(line => !line.includes('Reconnecting')));
});

test('shutdown during pairing cannot restart Home Assistant afterward', async () => {
  let finish, starts = 0;
  const connector = new Connector({ origin: 'https://twindeck.example', homeAssistant: { start: () => starts++, stop: () => {} }, log: () => {} });
  connector.pair = () => new Promise(resolve => { finish = resolve; });
  const running = connector.run(); connector.stop(); finish(); await running;
  assert.equal(starts, 0);
});
