import test from 'node:test';
import assert from 'node:assert/strict';
import { Connector } from '../twindeck_connector/connector.mjs';
import { validateJob } from '../twindeck_connector/protocol.mjs';

const serverNow = Date.parse('2026-11-17T19:17:12Z');
const entityId = 'climate.badkamer_2_vloerverwarming_thermostaat';
const command = (expiresAt = serverNow + 20000) => ({ id: crypto.randomUUID(), expiresAt, method: 'POST', path: '/services/climate/set_temperature', body: { entity_id: entityId, temperature: 10.5 } });

function fixture({ skew = -122000, delay = 0, date = new Date(serverNow).toUTCString(), jobs = [command()] } = {}) {
  let monotonic = 0, localNow = serverNow + skew;
  const calls = [], logs = [];
  const connector = new Connector({ origin: 'https://twindeck.example', log: value => logs.push(value), monotonicNow: () => monotonic, wallNow: () => localNow,
    homeAssistant: { connected: true, snapshot: () => ({ connected: true }), request: async (...args) => { calls.push(args); return []; } },
    fetcher: async () => { monotonic += delay; return Response.json({ protocol: 1, jobs, pollAfterMs: 3000 }, { headers: date === null ? {} : { Date: date } }); },
  });
  connector.credentials = { token: 'a'.repeat(64) };
  return { connector, calls, logs, advance: ms => { monotonic += ms; }, setWall: value => { localNow = value; } };
}

test('cloud jobs work with HA clocks two minutes behind or ahead without relaxing expiry limits', async () => {
  for (const skew of [-122000, 122000, -86400000, 86400000]) {
    const job = command(), { connector, calls } = fixture({ skew, jobs: [job] });
    assert.throws(() => validateJob(job, serverNow + skew), /expired/, 'old local-clock validation rejects this valid job');
    await connector.exchange();
    assert.deepEqual(calls, [['/services/climate/set_temperature', 'POST', { entity_id: entityId, temperature: 10.5 }]]);
    assert.deepEqual(connector.results, [{ id: job.id, ok: true, result: null }]);
  }
});

test('cloud time advances monotonically when the HA wall clock is corrected', async () => {
  const f = fixture({ jobs: [] });
  await f.connector.exchange();
  f.setWall(serverNow - 86400000); f.advance(20000);
  assert.equal(f.connector.cloudNow(), serverNow + 21000);
  assert.equal((await f.connector.execute(command())).ok, false);
  assert.equal(f.calls.length, 0);
});

test('expired, delayed and excessive deadlines are rejected on the cloud clock', async () => {
  for (const options of [{ jobs: [command(serverNow)] }, { jobs: [command()], delay: 19500 }, { jobs: [command(serverNow + 60000)] }]) {
    const f = fixture(options);
    await f.connector.exchange();
    assert.equal(f.connector.results[0].ok, false);
    assert.equal(f.calls.length, 0);
  }
});

test('missing or invalid cloud Date headers retain local-clock validation', async () => {
  for (const date of [null, 'invalid']) {
    const f = fixture({ date });
    await f.connector.exchange();
    assert.equal(f.connector.results[0].ok, false);
    assert.equal(f.calls.length, 0);
    const synced = fixture({ date, skew: 0 });
    await synced.connector.exchange();
    assert.equal(synced.connector.results[0].ok, true);
  }
});

test('cloud clock alignment never permits unsupported device requests', async () => {
  const f = fixture({ jobs: [{ ...command(), path: '/services/shell_command/run' }] });
  await f.connector.exchange();
  assert.equal(f.connector.results[0].ok, false);
  assert.equal(f.calls.length, 0);
});
