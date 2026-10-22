import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  hasCachedSkyWeights,
  loadSkyWeights,
  SKY_DEPLOYMENT,
  SKY_BYTES,
  SKY_CACHE,
} from './skyWeights.js';
const root = new URL('https://example.test/models/current/');
function fixture({ existing = true, manifestCached = true, missing = null } = {}) {
  const entries = new Map();
  const files = Object.fromEntries(
    ['base', 'token'].map((part, i) => {
      const data = new Uint8Array([i + 1]);
      const shard = {
        name: `${part}.bin`,
        bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      };
      if (part !== missing) entries.set(new URL(shard.name, root).href, new Response(data));
      return [part, { ...shard, shards: [shard] }];
    }),
  );
  const manifest = { id: SKY_DEPLOYMENT, bytes: SKY_BYTES, files };
  if (manifestCached) entries.set(new URL('manifest.json', root).href, Response.json(manifest));
  const cache = {
    match: async (url) => entries.get(url)?.clone(),
    put: async (url, response) => entries.set(url, response.clone()),
    delete: async (url) => entries.delete(url),
  };
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('manifest.json')) return Response.json(manifest);
    throw Error('Unexpected weight download');
  };
  const storage = {
    has: async (name) => existing && name === SKY_CACHE,
    open: async () => cache,
  };
  return { storage, cache, entries, manifest, fetcher, calls };
}
test('first use or unavailable cache never triggers an automatic weight fetch', async () => {
  const fresh = fixture({ existing: false });
  assert.equal(await hasCachedSkyWeights(root, fresh), false);
  assert.deepEqual(fresh.calls, []);
  assert.equal(
    await hasCachedSkyWeights(root, {
      storage: {
        has: async () => {
          throw Error('blocked');
        },
      },
    }),
    false,
  );
});
test('complete legacy caches are recognized without redownloading any weights', async () => {
  const legacy = fixture({ manifestCached: false });
  assert.equal(await hasCachedSkyWeights(root, legacy), true);
  assert.deepEqual(legacy.calls, [new URL('manifest.json', root).href]);
  assert.equal(await hasCachedSkyWeights(root, fixture({ missing: 'token' })), false);
});
test('cache inspection does not read or hash weight bodies on the UI thread', async () => {
  const complete = fixture();
  const match = complete.cache.match;
  complete.cache.match = async (url) => {
    const response = await match(url);
    if (response && !url.endsWith('manifest.json'))
      response.arrayBuffer = () => {
        throw Error('weight body read');
      };
    return response;
  };
  assert.equal(await hasCachedSkyWeights(root, complete), true);
  assert.deepEqual(complete.calls, []);
});
test('automatic initialization verifies cached bytes and saves the manifest for future offline checks', async () => {
  const complete = fixture({ manifestCached: false });
  const loaded = await loadSkyWeights(root, () => {}, { ...complete, cachedOnly: true });
  assert.deepEqual([...loaded.buffers.base], [1]);
  assert.deepEqual([...loaded.buffers.token], [2]);
  assert.equal(loaded.persistent, true);
  complete.calls.length = 0;
  assert.equal(await hasCachedSkyWeights(root, complete), true);
  assert.deepEqual(complete.calls, []);
});
test('evicted or corrupt shards fail automatic initialization without falling back to a download', async () => {
  for (const corrupt of [false, true]) {
    const incomplete = fixture({ missing: 'token' });
    if (corrupt)
      incomplete.entries.set(new URL('token.bin', root).href, new Response(new Uint8Array([99])));
    await assert.rejects(
      () => loadSkyWeights(root, () => {}, { ...incomplete, cachedOnly: true }),
      { code: 'WEIGHT_CACHE_INCOMPLETE' },
    );
    assert.deepEqual(incomplete.calls, []);
  }
});
