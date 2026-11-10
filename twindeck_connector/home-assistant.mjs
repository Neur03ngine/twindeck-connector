import { boundedJson, sanitizeState } from './protocol.mjs';

export class HomeAssistant {
  constructor({ token, restUrl = 'http://supervisor/core/api', socketUrl = 'ws://supervisor/core/websocket', fetcher = fetch, socketFactory = url => new WebSocket(url) }) {
    this.token = token; this.restUrl = restUrl; this.socketUrl = socketUrl; this.fetcher = fetcher; this.socketFactory = socketFactory;
    this.connected = false; this.stopped = true; this.sequence = 0; this.pending = new Map(); this.states = new Map();
    this.discovery = { areas: [], registryEntities: [], registryDevices: [] }; this.temperatureUnit = '°C'; this.timezone = 'UTC';
  }
  async request(path, method = 'GET', body) {
    const response = await this.fetcher(`${this.restUrl}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`Home Assistant returned HTTP ${response.status}.`);
    if (response.status === 204) return null;
    return boundedJson(response);
  }
  snapshot() { return { connected: this.connected, entities: [...this.states.values()], discovery: this.discovery, temperatureUnit: this.temperatureUnit, timezone: this.timezone }; }
  start() { this.stop(); this.stopped = false; this.open(); }
  stop() { this.stopped = true; clearTimeout(this.reconnect); clearTimeout(this.watchdog); clearTimeout(this.registryTimer); clearInterval(this.heartbeat); this.disconnect(); }
  disconnect() {
    this.connected = false; const socket = this.socket; this.socket = undefined; socket?.close();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Home Assistant disconnected.')); } this.pending.clear();
  }
  rpc(type, extra = {}) {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== 1) { reject(new Error('Home Assistant socket is closed.')); return; }
      const id = ++this.sequence, timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Home Assistant request timed out.')); }, 12000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, type, ...extra }));
    });
  }
  async registries() {
    const [areas, entities, devices] = await Promise.all(['config/area_registry/list','config/entity_registry/list','config/device_registry/list'].map(type => this.rpc(type)));
    const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined && value[key] !== null).map(key => [key, value[key]]));
    this.discovery = { areas: areas.map(area => pick(area, ['area_id','name'])), registryEntities: entities.map(entity => pick(entity, ['entity_id','device_id','area_id','disabled_by'])), registryDevices: devices.map(device => pick(device, ['id','area_id','name','name_by_user','manufacturer','model'])) };
  }
  async initialize(socket) {
    this.buffer = [];
    await this.rpc('subscribe_events', { event_type: 'state_changed' });
    const states = await this.rpc('get_states');
    if (this.socket !== socket) return;
    this.states = new Map(states.map(entity => { const state = sanitizeState(entity); return [state.entity_id, state]; }));
    for (const change of this.buffer) this.change(change); this.buffer = null;
    await this.registries();
    const config = await this.request('/config');
    this.temperatureUnit = config.unit_system?.temperature === '°F' ? '°F' : '°C'; this.timezone = config.time_zone || 'UTC';
    for (const event_type of ['area_registry_updated','entity_registry_updated','device_registry_updated']) await this.rpc('subscribe_events', { event_type });
    if (this.socket !== socket) return;
    this.connected = true; this.attempt = 0; clearTimeout(this.watchdog);
    this.heartbeat = setInterval(() => void this.rpc('ping').catch(() => socket.close()), 15000);
  }
  change(change) { if (change.new_state) this.states.set(change.entity_id, sanitizeState(change.new_state)); else this.states.delete(change.entity_id); }
  open() {
    if (this.stopped) return;
    let socket;
    try { socket = this.socketFactory(this.socketUrl); }
    catch { this.retry(); return; }
    this.socket = socket;
    this.watchdog = setTimeout(() => socket.close(), 30000);
    socket.onmessage = event => {
      if (this.socket !== socket || this.stopped) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: this.token }));
        else if (message.type === 'auth_ok') void this.initialize(socket).catch(() => socket.close());
        else if (message.type === 'auth_invalid') socket.close();
        else if (message.type === 'result' || message.type === 'pong') {
          const pending = this.pending.get(message.id); if (!pending) return;
          clearTimeout(pending.timer); this.pending.delete(message.id);
          if (message.success === false) pending.reject(new Error('Home Assistant refused a registry request.')); else pending.resolve(message.result);
        } else if (message.type === 'event') {
          if (message.event?.event_type === 'state_changed') {
            if (this.buffer) this.buffer.push(message.event.data); else this.change(message.event.data);
          } else if (String(message.event?.event_type).endsWith('_registry_updated')) {
            clearTimeout(this.registryTimer); this.registryTimer = setTimeout(() => void this.registries().catch(() => socket.close()), 1000);
          }
        }
      } catch { socket.close(); }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => { if (this.socket === socket) { clearTimeout(this.watchdog); clearInterval(this.heartbeat); this.disconnect(); this.retry(); } };
  }
  retry() { if (!this.stopped) this.reconnect = setTimeout(() => this.open(), Math.min(30000, 1000 * 2 ** Math.min(this.attempt = (this.attempt || 0) + 1, 5))); }
}
