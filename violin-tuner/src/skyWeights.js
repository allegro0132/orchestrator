export const SKY_DEPLOYMENT = 'skytnt-tv2o-medium-w4a16-stable-v2';
export const SKY_CACHE = `arco-${SKY_DEPLOYMENT}`;
export const SKY_BYTES = 144494146;
export async function verified(buffer, file) {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  if (buffer.byteLength !== file.bytes || hash !== file.sha256)
    throw new Error('Model checksum mismatch');
  return buffer;
}
export async function loadSkyWeights(
  root,
  progress,
  { fetcher = fetch, storage = globalThis.caches } = {},
) {
  const response = await fetcher(new URL('manifest.json', root), {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error('Model manifest unavailable');
  const manifest = await response.json();
  if (manifest.id !== SKY_DEPLOYMENT || manifest.bytes !== SKY_BYTES)
    throw new Error('Unsupported model version');
  let cache;
  try {
    cache = await storage?.open(SKY_CACHE);
  } catch {
    /* Private browsing may disable persistent storage. */
  }
  let loaded = 0,
    persistent = !!cache;
  const buffers = {};
  for (const part of ['base', 'token']) {
    const file = manifest.files[part],
      output = new Uint8Array(file.bytes);
    let offset = 0;
    for (const shard of file.shards) {
      const url = new URL(shard.name, root).href;
      let buffer;
      const cached = await cache?.match(url);
      if (cached) {
        try {
          buffer = await verified(await cached.arrayBuffer(), shard);
        } catch {
          await cache.delete(url);
        }
      }
      if (!buffer) {
        const result = await fetcher(url, { signal: AbortSignal.timeout(300000) });
        if (!result.ok) throw new Error(`Weight download failed (${result.status})`);
        // Stream progress within each shard, including slow mobile connections.
        const reader = result.body?.getReader();
        if (reader) {
          const bytes = new Uint8Array(shard.bytes);
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (received + value.length > bytes.length) {
              await reader.cancel();
              throw new Error('Invalid shard length');
            }
            bytes.set(value, received);
            received += value.length;
            progress({ loaded: loaded + received, total: manifest.bytes, persistent });
          }
          if (received !== bytes.length) throw new Error('Incomplete weight download');
          buffer = await verified(bytes.buffer, shard);
        } else buffer = await verified(await result.arrayBuffer(), shard);
        if (cache)
          try {
            await cache.put(url, new Response(buffer));
          } catch {
            persistent = false;
          }
      }
      output.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
      loaded += buffer.byteLength;
      progress({ loaded, total: manifest.bytes, persistent });
    }
    buffers[part] = new Uint8Array(await verified(output.buffer, file));
  }
  return { buffers, persistent };
}
