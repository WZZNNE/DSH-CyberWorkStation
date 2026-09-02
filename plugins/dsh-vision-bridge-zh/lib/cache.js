// dsh-vision-bridge — minimal LRU cache (in-memory).
//
// Used for the per-image description cache so the same bytes+prompt don't
// repeatedly call a vision model across sessions. Evicts the least-recently-used
// entry when size exceeds `max`.
//
// ponytail: hand-rolled Map-based LRU. Map preserves insertion order; on get
// we delete+set to move to the end, on set we drop the head when full. No
// external dep; lru-cache npm package would do the same in 30 lines but adds
// a peer.

export function createLru(max) {
  const limit = Math.max(1, Number(max) || 256)
  const map = new Map()
  return {
    get(key) {
      if (!map.has(key)) return undefined
      const value = map.get(key)
      map.delete(key)
      map.set(key, value)
      return value
    },
    set(key, value) {
      if (map.has(key)) map.delete(key)
      map.set(key, value)
      if (map.size > limit) {
        const oldest = map.keys().next().value
        map.delete(oldest)
      }
      return value
    },
    has(key) {
      return map.has(key)
    },
    delete(key) {
      return map.delete(key)
    },
    keys() {
      return map.keys()
    },
    clear() {
      map.clear()
    },
    get size() {
      return map.size
    },
  }
}

/**
 * Stable key for the description cache. Includes everything that influences
 * the answer: bytes, prompt, detail, mode, model, promptVersion. Different
 * prompts/models → different cache entry even for the same image bytes.
 */
export function descriptionCacheKey({bytes, prompt, model, mode, promptVersion = 1}) {
  const parts = [
    contentHash(bytes),
    String(prompt || ''),
    String(model || ''),
    String(mode || 'auto'),
    String(promptVersion),
  ]
  return parts.join('\u0001')
}

/** Non-cryptographic FNV-1a content hash (fast, no dependencies). */
export function contentHash(bytes) {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
