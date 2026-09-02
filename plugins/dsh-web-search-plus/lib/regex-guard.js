/**
 * A time-bounded home for the one regular expression this plugin runs on the agent's hot path.
 *
 * The trigger pattern is written by the user and matched against whatever they just typed, inside a
 * single-threaded harness. Some perfectly ordinary-looking patterns backtrack exponentially
 * (`((a+))+b`, `(a{1,})+b`, `(a|a)+b`), and no source-level heuristic can tell those apart from the
 * safe ones — an earlier attempt rejected `(\w+) *(\w+)` and `(C\+\+) *fans` while letting all four
 * of those through. `RegExp.exec` cannot be interrupted, so the only real bound is to run it
 * somewhere that can be killed: a worker thread with a deadline.
 *
 * The worker runs one match at a time (it is a plain FIFO), so a request that overruns is always the
 * oldest one in flight: that one is blamed, reported by name and answered "no match", the worker is
 * terminated to stop the runaway match, and every other request in flight is re-posted to its
 * replacement rather than being failed for someone else's pattern.
 */
import { Worker } from 'node:worker_threads'

const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads')
parentPort.on('message', ({ id, pattern, flags, text }) => {
  parentPort.postMessage({ id, started: true })
  try {
    const match = new RegExp(pattern, flags).exec(text)
    parentPort.postMessage({ id, match: match === null ? null : [...match] })
  } catch (error) {
    parentPort.postMessage({ id, match: null, error: String(error && error.message ? error.message : error) })
  }
})
`

/**
 * @param {{ timeoutMs?: number, onTimeout?: (pattern: string) => void }} options
 * @returns {{ match(pattern: string, flags: string, text: string): Promise<string[] | null>, dispose(): void }}
 */
export function createRegexMatcher({ timeoutMs = 60, onTimeout } = {}) {
  let worker = null
  let nextId = 1
  let disposed = false
  /** id → { resolve, timer, pattern, flags, text } in submission order. */
  const pending = new Map()

  const start = () => {
    // A pattern can allocate as well as backtrack: the deadline bounds its time, this its memory.
    const started = new Worker(WORKER_SOURCE, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 256 } })
    // The handlers first, then unref: attaching a `message` listener re-refs the worker's port, so
    // unref'ing before this line leaves the event loop held open and the process unable to exit.
    started.on('message', message => {
      const entry = pending.get(message.id)
      if (!entry) return
      // The worker is a FIFO: a queued job must not be charged the time its predecessor spent
      // running. The clock starts when the worker says it has picked this job up.
      if (message.started === true) {
        clearTimeout(entry.timer)
        entry.timer = setTimeout(onDeadline, timeoutMs)
        entry.timer.unref?.()
        return
      }
      pending.delete(message.id)
      clearTimeout(entry.timer)
      entry.resolve(message.match ?? null)
      idleUnref()
    })
    started.on('error', () => { if (worker === started) failAll() })
    started.on('exit', () => { if (worker === started) failAll() })
    started.unref()
    worker = started
    return started
  }
  /** Nothing in flight: let the process exit even though a worker is alive. */
  const idleUnref = () => { if (pending.size === 0) worker?.unref?.() }
  const failAll = () => {
    const dying = worker
    worker = null
    for (const [, entry] of pending) { clearTimeout(entry.timer); entry.resolve(null) }
    pending.clear()
    dying?.terminate?.().catch(() => {})
  }

  /** The oldest request in flight is the one that is stuck: blame it, keep the rest. */
  const onDeadline = () => {
    const oldest = [...pending.entries()][0]
    const dying = worker
    worker = null
    for (const [, entry] of pending) clearTimeout(entry.timer)
    if (oldest) {
      const [culpritId, culprit] = oldest
      pending.delete(culpritId)
      culprit.resolve(null)
      onTimeout?.(culprit.pattern)
    }
    dying?.terminate?.().catch(() => {})
    // Everything else was only waiting behind it: run it again on a fresh worker.
    const survivors = [...pending.entries()]
    pending.clear()
    for (const [id, entry] of survivors) submit(id, entry.pattern, entry.flags, entry.text, entry.resolve)
    idleUnref()
  }

  const submit = (id, pattern, flags, text, resolve) => {
    let current
    try { current = worker ?? start() } catch { resolve(null); return }
    const timer = setTimeout(onDeadline, timeoutMs)
    timer.unref?.()
    pending.set(id, { resolve, timer, pattern, flags, text })
    current.ref?.()          // hold the loop while a match is actually in flight
    try { current.postMessage({ id, pattern, flags, text }) } catch { clearTimeout(timer); pending.delete(id); resolve(null); idleUnref() }
  }

  return {
    async match(pattern, flags, text) {
      if (typeof pattern !== 'string' || pattern.length === 0) return null
      // After dispose there is no matcher: a caller still inside `await next()` gets "no match"
      // rather than a worker that outlives the plugin that owns it.
      if (disposed) return null
      return new Promise(resolve => submit(nextId++, pattern, flags, text, resolve))
    },
    dispose() { disposed = true; failAll() },
  }
}
