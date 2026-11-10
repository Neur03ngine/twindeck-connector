export const lampState = (value = 'on') => ({ entity_id: 'light.kitchen', state: value, attributes: { brightness: 123, friendly_name: 'Kitchen', access_token: 'ha-secret' } });
export class ConnectorHomeAssistantSocket {
  constructor() { this.readyState = 1; this.messages = []; queueMicrotask(() => this.emit({ type: 'auth_required' })); }
  emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
  send(raw) {
    const message = JSON.parse(raw); this.messages.push(message);
    queueMicrotask(() => {
      if (message.type === 'auth') { this.emit({ type: 'auth_ok' }); return; }
      const result = message.type === 'get_states' ? [lampState()] : message.type === 'config/area_registry/list' ? [{ area_id: 'kitchen', name: 'Kitchen', secret: 'hidden' }] : message.type === 'config/entity_registry/list' ? [{ entity_id: 'light.kitchen', device_id: 'lamp', access_token: 'hidden' }] : message.type === 'config/device_registry/list' ? [{ id: 'lamp', name: 'Lamp', configuration_url: 'http://private' }] : null;
      this.emit({ id: message.id, type: message.type === 'ping' ? 'pong' : 'result', success: true, result });
    });
  }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(); }
}
