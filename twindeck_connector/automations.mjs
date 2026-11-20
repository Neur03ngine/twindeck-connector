// Shared bounded DSL: the server and the LAN connector rebuild the same HA config.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const automationPowerDomains = {
  light: ['light'],
  climate: ['climate'],
  appliance: ['switch', 'input_boolean', 'fan', 'camera'],
  security: ['switch', 'input_boolean', 'camera', 'siren'],
};
const object = v => v && typeof v === 'object' && !Array.isArray(v);
function exact(v, keys) { if (!object(v) || Object.keys(v).some(k => !keys.includes(k))) throw new Error('Unsupported automation field.'); }
function ids(v, domains) {
  const pattern = new RegExp(`^(?:${domains.join('|')})\\.[a-z0-9_]{1,120}$`);
  if (!Array.isArray(v) || !v.length || v.length > 100 || v.some(id => typeof id !== 'string' || !pattern.test(id))) throw new Error('Select 1–100 supported entities.');
  return [...new Set(v)].sort();
}
export function validateAutomation(input) {
  exact(input, ['version','name','enabled','timezone','trigger','actions']);
  if (input.version !== 1 || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || /[\x00-\x1f\x7f]/.test(input.name) || typeof input.enabled !== 'boolean' || typeof input.timezone !== 'string' || input.timezone.length > 80) throw new Error('Invalid automation name, version or timezone.');
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); } catch { throw new Error('Choose a valid home timezone.'); }
  let trigger;
  if (input.trigger?.type === 'state') {
    exact(input.trigger, ['type','entityIds','from','to']);
    if (!['on','off'].includes(input.trigger.from) || !['on','off'].includes(input.trigger.to) || input.trigger.from === input.trigger.to) throw new Error('Choose a sensor state transition.');
    trigger = { type: 'state', entityIds: ids(input.trigger.entityIds, ['binary_sensor']), from: input.trigger.from, to: input.trigger.to };
  } else {
    exact(input.trigger, ['type','time','weekdays']);
    if (input.trigger.type !== 'schedule' || typeof input.trigger.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.trigger.time) || !Array.isArray(input.trigger.weekdays) || !input.trigger.weekdays.length || input.trigger.weekdays.length > 7 || input.trigger.weekdays.some(d => !weekdays.includes(d))) throw new Error('Choose a time and at least one weekday.');
    trigger = { type: 'schedule', time: input.trigger.time, weekdays: weekdays.filter(d => input.trigger.weekdays.includes(d)) };
  }
  if (!Array.isArray(input.actions) || !input.actions.length || input.actions.length > 10) throw new Error('Add 1–10 actions.');
  const actions = input.actions.map(a => {
    const setsTemperature = a?.operation === 'set_temperature';
    exact(a, setsTemperature ? ['domain','operation','entityIds','selection','temperature','temperatureUnit'] : ['domain','operation','entityIds','selection']);
    if (setsTemperature) {
      if (a.domain !== 'climate' || !Number.isFinite(a.temperature) || !['°C','°F'].includes(a.temperatureUnit)) throw new Error('Enter a valid thermostat target temperature.');
    } else if (typeof a.domain !== 'string' || !Object.hasOwn(automationPowerDomains, a.domain) || !['turn_on','turn_off'].includes(a.operation)) throw new Error('Unsupported automation action.');
    exact(a.selection, ['mode','roomKey']);
    if (!['entities','room','home'].includes(a.selection.mode) || (a.selection.mode === 'room' ? typeof a.selection.roomKey !== 'string' || !/^[a-f0-9]{64}$/.test(a.selection.roomKey) : a.selection.roomKey !== undefined)) throw new Error('Choose a valid action scope.');
    const action = { domain: a.domain, operation: a.operation, entityIds: ids(a.entityIds, automationPowerDomains[a.domain]), selection: a.selection.mode === 'room' ? { mode: 'room', roomKey: a.selection.roomKey } : { mode: a.selection.mode } };
    return setsTemperature ? { ...action, temperature: a.temperature, temperatureUnit: a.temperatureUnit } : action;
  });
  const definition = { version: 1, name: input.name.trim(), enabled: input.enabled, timezone: input.timezone, trigger, actions };
  if (new TextEncoder().encode(JSON.stringify(definition)).byteLength > 60000) throw new Error('Automation is too large. Reduce its targets or split it into separate rules.');
  return definition;
}
export function automationId(homeId, id) {
  if (!uuid.test(homeId) || !uuid.test(id)) throw new Error('Invalid home automation identity.');
  return `twindeck_auto_${homeId}_${id}`;
}
function compileActions(action) {
  const targets = new Map();
  for (const id of action.entityIds) {
    const domain = id.split('.')[0];
    if (!targets.has(domain)) targets.set(domain, []);
    targets.get(domain).push(id);
  }
  return Array.from(targets, ([domain, entityIds]) => ({ action: `${domain}.${action.operation}`, target: { entity_id: entityIds },
    ...(action.operation === 'set_temperature' ? { data: { temperature: action.temperature } } : {}) }));
}
export function compileAutomation(homeId, id, revision, input) {
  const definition = validateAutomation(input), haId = automationId(homeId, id);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid automation revision.');
  const t = definition.trigger;
  return { id: haId, alias: `TwinDeck · ${definition.name}`, description: JSON.stringify({ twindeck: 2, homeId, automationId: id, revision, definition }), mode: 'single', initial_state: definition.enabled,
    triggers: t.type === 'state' ? [{ trigger: 'state', entity_id: t.entityIds, from: t.from, to: t.to }] : [{ trigger: 'time', at: `${t.time}:00` }],
    conditions: t.type === 'schedule' ? [{ condition: 'time', weekday: t.weekdays }] : [],
    actions: definition.actions.flatMap(compileActions) };
}
export function canonicalAutomation(value) {
  const canonical = v => Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return JSON.stringify(canonical(value));
}
export async function automationFingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalAutomation(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
