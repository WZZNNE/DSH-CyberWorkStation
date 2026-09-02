// dsh-vision-bridge — vision journal (Block 0.5.0, #108).
//
// Append-only audit trail of every vision call: time, channel, key, image hash,
// prompt, tokens, result. Persisted to a JSON file (no sqlite dep), capped by
// maxEntries. Complements /stats (counters) with a real log.
//
// ponytail: JSON file with LRU cap; upgrade to better-sqlite3 if the journal
// grows past ~5k entries.

import fs from 'node:fs'
import path from 'node:path'

export class VisionJournal {
  constructor(dir, maxEntries = 2000) {
    this.file = path.join(dir, 'vision-journal.json')
    this.max = maxEntries
    this.entries = []
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) this.entries = parsed
    } catch {}
  }
  add(entry) {
    this.entries.push({ ts: Date.now(), ...entry })
    if (this.entries.length > this.max) {
      this.entries = this.entries.slice(this.entries.length - this.max)
    }
    this.flush()
  }
  recent(n = 50) {
    return this.entries.slice(-n).reverse()
  }
  filter({ channel, ok, since } = {}) {
    let out = this.entries
    if (channel) out = out.filter((e) => e.channel === channel)
    if (ok !== undefined) out = out.filter((e) => e.ok === ok)
    if (since) out = out.filter((e) => e.ts >= since)
    return out.slice(-200).reverse()
  }
  get size() {
    return this.entries.length
  }
  clear() {
    this.entries = []
    this.flush()
  }
  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.entries))
    } catch {}
  }
}
