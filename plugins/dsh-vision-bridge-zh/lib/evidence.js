// dsh-vision-bridge — evidence store (Block 4, 0.2.9).
//
// Persists image descriptions across sessions in a JSON file (no sqlite dep).
// Key: composite cacheKey (bytes+prompt+model+mode). Value: {description, ts}.
// ponytail: JSON append-only file with LRU cap; upgrade to better-sqlite3 if
// the store grows past ~5k entries.

import fs from 'node:fs'
import path from 'node:path'

export class EvidenceStore {
  constructor(dir, maxEntries = 2000) {
    this.file = path.join(dir, 'vision-evidence.json')
    this.max = maxEntries
    this.map = new Map()
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      for (const [k, v] of Object.entries(JSON.parse(raw))) this.map.set(k, v)
    } catch {}
  }
  get(key) {
    const hit = this.map.get(key)
    return hit && typeof hit.description === 'string' ? hit.description : undefined
  }
  set(key, description) {
    this.map.set(key, { description, ts: Date.now() })
    if (this.map.size > this.max) {
      // evict oldest by ts
      const entries = [...this.map.entries()].sort((a, b) => a[1].ts - b[1].ts)
      for (const [k] of entries.slice(0, this.map.size - this.max)) this.map.delete(k)
    }
    this.flush()
  }
  recent(n = 20) {
    return [...this.map.values()].sort((a, b) => b.ts - a.ts).slice(0, n)
  }
  get size() {
    return this.map.size
  }
  clear() {
    this.map.clear()
    this.flush()
  }
  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.map)))
    } catch {}
  }
}
