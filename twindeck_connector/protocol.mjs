export const VERSION = 1;
export const MAX_RESPONSE_BYTES = 1500000;
const entityPattern = /^[a-z_]+\.[a-z0-9_]+$/;
const attributes = new Set(['friendly_name','device_class','unit_of_measurement','temperature_unit','current_temperature','temperature','target_temperature','target_temp_low','target_temp_high','current_humidity','humidity','hvac_modes','hvac_action','preset_mode','preset_modes','fan_mode','fan_modes','swing_mode','swing_modes','swing_horizontal_mode','swing_horizontal_modes','supported_features','min_temp','max_temp','target_temp_step','min','max','step','value','brightness','rgb_color','hs_color','xy_color','color_temp_kelvin','min_color_temp_kelvin','max_color_temp_kelvin','supported_color_modes','battery_level','battery','last_triggered','id','twindeck_schedule','floor_temperature','measured_temperature','local_temperature','target_temp']);
export function sanitizeState(entity) {
  if (!entity || !entityPattern.test(entity.entity_id) || typeof entity.state !== 'string' || !entity.attributes || typeof entity.attributes !== 'object') throw new Error('Invalid Home Assistant state.');
  return { entity_id: entity.entity_id, state: entity.state,
    attributes: Object.fromEntries(Object.entries(entity.attributes).filter(([key]) => attributes.has(key))),
    last_updated: entity.last_updated, last_changed: entity.last_changed, last_reported: entity.last_reported };
}
export function cloudOrigin(value, allowLoopback = false) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('TwinDeck URL must use HTTPS.');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the TwinDeck website origin without a path.');
  return url.origin;
}
export async function boundedJson(response, limit = MAX_RESPONSE_BYTES) {
  if (!response.body) throw new Error('Empty response.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Response is too large.');
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function allowedRequest(path, method) {
  if (typeof path !== 'string') return false;
  if (method === 'GET' && (/^\/(config|states)$/.test(path) || /^\/states\/[a-z_]+\.[a-z0-9_]+$/.test(path))) return true;
  if (method === 'GET' && /^\/history\/period\/[0-9TZ:%.+-]+\?filter_entity_id=(climate|sensor|number|input_number)\.[a-z0-9_]+&end_time=[0-9TZ:%.+-]+$/.test(path)) return true;
  if (method === 'POST' && /^\/services\/(light|switch|fan|input_boolean|automation)\/turn_(on|off)$/.test(path)) return true;
  if (method === 'POST' && /^\/services\/climate\/(set_temperature|set_hvac_mode|set_preset_mode|set_fan_mode|set_swing_mode|set_swing_horizontal_mode|turn_on|turn_off)$/.test(path)) return true;
  if (method === 'POST' && /^\/services\/(number|input_number)\/set_value$/.test(path)) return true;
  return ['POST', 'DELETE'].includes(method) && /^\/config\/automation\/config\/twindeck_[a-zA-Z0-9_-]+$/.test(path);
}
function targets(value, domain) {
  const ids = Array.isArray(value) ? value : [value];
  if (!ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(id))) throw new Error('Invalid service target.');
  return ids;
}
/** Independently constrain cloud commands before they enter the local administrator API. */
export function validateJob(job, now = Date.now()) {
  if (!job || typeof job.id !== 'string' || !/^[a-f0-9-]{36}$/.test(job.id) || !Number.isFinite(job.expiresAt) || job.expiresAt <= now || job.expiresAt > now + 30000 || !allowedRequest(job.path, job.method)) throw new Error('Unsupported or expired connector job.');
  if (job.method === 'GET' || job.method === 'DELETE') {
    if (job.body !== undefined) throw new Error('Unexpected request body.');
    return job;
  }
  if (!job.body || typeof job.body !== 'object' || Array.isArray(job.body)) throw new Error('Invalid service body.');
  const service = job.path.match(/^\/services\/([a-z_]+)\/([a-z_]+)$/);
  if (service) {
    const [, domain, action] = service;
    targets(job.body.entity_id, domain);
    const permitted = domain === 'light' ? ['entity_id','brightness','rgb_color','color_temp_kelvin'] : domain === 'climate' ? ['entity_id','temperature','target_temp_low','target_temp_high','hvac_mode','preset_mode','fan_mode','swing_mode','swing_horizontal_mode'] : ['number','input_number'].includes(domain) ? ['entity_id','value'] : ['entity_id'];
    if (Object.keys(job.body).some(key => !permitted.includes(key))) throw new Error('Unsupported service field.');
    for (const key of ['temperature','target_temp_low','target_temp_high','value','brightness','color_temp_kelvin']) {
      if (job.body[key] !== undefined && (typeof job.body[key] !== 'number' || !Number.isFinite(job.body[key]))) throw new Error('Invalid numeric service value.');
    }
    if (job.body.brightness !== undefined && (!Number.isInteger(job.body.brightness) || job.body.brightness < 0 || job.body.brightness > 255)) throw new Error('Invalid brightness.');
    if (job.body.color_temp_kelvin !== undefined && (!Number.isInteger(job.body.color_temp_kelvin) || job.body.color_temp_kelvin < 1000 || job.body.color_temp_kelvin > 40000)) throw new Error('Invalid color temperature.');
    if (job.body.rgb_color !== undefined && (!Array.isArray(job.body.rgb_color) || job.body.rgb_color.length !== 3 || job.body.rgb_color.some(v => !Number.isInteger(v) || v < 0 || v > 255))) throw new Error('Invalid RGB color.');
    for (const key of ['hvac_mode','preset_mode','fan_mode','swing_mode','swing_horizontal_mode']) if (job.body[key] !== undefined && (typeof job.body[key] !== 'string' || job.body[key].length > 128)) throw new Error('Invalid climate mode.');
    const required = { set_value: 'value', set_hvac_mode: 'hvac_mode', set_preset_mode: 'preset_mode', set_fan_mode: 'fan_mode', set_swing_mode: 'swing_mode', set_swing_horizontal_mode: 'swing_horizontal_mode' }[action];
    if (required && job.body[required] === undefined) throw new Error('Missing service value.');
    return job;
  }
  // Never accept arbitrary automation YAML/actions from the cloud. Rebuild only TwinDeck light timers.
  const id = job.path.split('/').at(-1), description = JSON.parse(job.body.description);
  if (description.twindeck !== 1 || !['turn_on','turn_off'].includes(description.action) || !Number.isFinite(Date.parse(description.dueAt)) || Date.parse(description.dueAt) < now || Date.parse(description.dueAt) > now + 7 * 86400000 + 60000) throw new Error('Invalid light timer.');
  targets(description.entityIds, 'light');
  const dueAt = new Date(description.dueAt).toISOString();
  return { ...job, body: { id, alias: `TwinDeck timer ${id}`, description: JSON.stringify({ twindeck: 1, entityIds: description.entityIds, action: description.action, dueAt }), mode: 'single',
    triggers: [{ trigger: 'template', value_template: `{{ now() >= as_datetime('${dueAt}') }}` }, { trigger: 'homeassistant', event: 'start' }],
    conditions: [{ condition: 'template', value_template: `{{ now() >= as_datetime('${dueAt}') and now().timestamp() < as_timestamp('${dueAt}') + 300 and this.attributes.last_triggered == none }}` }],
    actions: [{ action: 'automation.turn_off', target: { entity_id: '{{ this.entity_id }}' }, data: { stop_actions: false } }, { action: `light.${description.action}`, target: { entity_id: description.entityIds } }] } };
}
