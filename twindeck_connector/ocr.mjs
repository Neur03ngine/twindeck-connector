import { setTimeout as sleep } from 'node:timers/promises';
import { boundedJson } from './protocol.mjs';

const maxDocument = 20 * 1024 * 1024;
const maxResult = 4 * 1024 * 1024;
const localOrigin = 'http://local-twindeck-ocr:8789';
const allowedType = /^(application\/pdf|image\/(jpeg|png|webp|gif|tiff|avif))$/;

export async function runConnectorOcr(connector, token, signal, ocrOrigin = localOrigin) {
  const localAuth = { Authorization: `Bearer ${token}` };
  const cloudAuth = {
    Authorization: `Bearer ${connector.credentials.token}`,
    ...(connector.sitesServiceToken ? { 'OAI-Sites-Authorization': `Bearer ${connector.sitesServiceToken}` } : {}),
  };
  const cloud = (path, options) => connector.fetcher(`${connector.origin}/api/devices/connector/ocr${path}`, {
    ...options, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  const local = (path, options, timeout) => connector.fetcher(ocrOrigin + path, {
    ...options, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  });
  let lastMessage = '';
  const status = message => {
    if (message !== lastMessage && message) connector.log(message);
    lastMessage = message;
  };
  while (!signal.aborted) {
    try {
      const ready = await local('/health', { method: 'HEAD', headers: localAuth }, 3000)
        .then(response => response.status === 204, () => false);
      const response = await cloud('', { method: 'POST', headers: { ...cloudAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ ready }) });
      if (!response.ok) { await response.body?.cancel(); throw new Error('TwinDeck OCR unavailable'); }
      const payload = await boundedJson(response, 4096);
      if (payload.protocol !== 1) throw new Error('Unsupported OCR protocol');
      if (!ready) status('TwinDeck OCR is unavailable. Check the local OCR app and token.');
      else if (!payload.authorized) status('Allow connector OCR in the TwinDeck Home Assistant settings.');
      else status('TwinDeck OCR is connected.');
      const job = payload.job;
      if (ready && job) {
        if (!/^[a-f0-9]{64}$/.test(job.id) || !/^[a-f0-9-]{36}$/.test(job.leaseToken)
          || !allowedType.test(job.contentType) || !Array.isArray(job.pages) || job.pages.length < 1 || job.pages.length > 12
          || new Set(job.pages).size !== job.pages.length || !job.pages.every(page => Number.isInteger(page) && page >= 1 && page <= 100)
          || job.contentType !== 'application/pdf' && (job.pages.length !== 1 || job.pages[0] !== 1)) throw new Error('Invalid OCR job');
        const taskPath = '/' + job.id, headers = { ...cloudAuth, 'X-OCR-Lease': job.leaseToken };
        let result = null;
        try {
          const source = await cloud(taskPath, { headers });
          const declared = source.headers.get('Content-Length'), length = Number(declared);
          if (!source.ok || !source.body || declared !== null && (!Number.isSafeInteger(length) || length < 1 || length > maxDocument)
            || source.headers.get('Content-Type') !== job.contentType) {
            await source.body?.cancel();
            throw new Error('OCR document unavailable');
          }
          let received = 0;
          const input = source.body.pipeThrough(new TransformStream({
            transform(chunk, controller) {
              received += chunk.byteLength;
              if (received > maxDocument) throw new Error('OCR document is too large');
              controller.enqueue(chunk);
            },
          }));
          const recognized = await local('/recognize', { method: 'POST', duplex: 'half', body: input,
            headers: { ...localAuth, 'Content-Type': job.contentType, 'X-OCR-Pages': job.pages.join(',') } }, 110_000);
          if (!recognized.ok) { await recognized.body?.cancel(); throw new Error('OCR app could not process the job'); }
          result = await boundedJson(recognized, maxResult);
          if (!Array.isArray(result)) result = null;
        } catch {
          if (signal.aborted) return;
          connector.log('The local OCR app could not complete a document.');
        }
        let outcome;
        const send = body => cloud(taskPath, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body });
        const body = JSON.stringify(result);
        try { outcome = await send(body); }
        catch { if (signal.aborted) return; outcome = await send(body); }
        if (outcome.status === 400 && result !== null) {
          await outcome.body?.cancel();
          outcome = await send('null');
        }
        if (outcome.status !== 204 && outcome.status !== 404) {
          await outcome.body?.cancel();
          throw new Error('Could not deliver OCR result');
        }
        await outcome.body?.cancel();
      }
    } catch {
      if (!signal.aborted) status('TwinDeck OCR transport is unavailable. It will reconnect automatically.');
    }
    await sleep(10_000, undefined, { signal }).catch(() => {});
  }
}
