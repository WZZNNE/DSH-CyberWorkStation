/**
 * A time-bounded home for the deck's own text work.
 *
 * The regex rules and lorebook keys in a deck are user-authored (a SillyTavern import brings in
 * other people's), and they run against whatever the user just typed inside a single-threaded
 * harness. Some perfectly ordinary-looking patterns backtrack exponentially (`((a+))+b`,
 * `(a{1,})+b`, `(a|a)+b`), and no source-level heuristic can tell those apart from the safe ones —
 * an earlier attempt in this suite rejected `(\w+) *(\w+)` while letting all three of those through.
 * Nor can a pattern be measured and then run: the measurement is never the same work as the run (a
 * global replace scans repeatedly, a later rule sees an earlier rule's output, and the lorebook scan
 * buffer includes constant entries the message never mentioned). `RegExp` cannot be interrupted, so
 * the only real bound is to do the work somewhere that can be killed: a worker with a deadline,
 * running `deck.js` itself.
 *
 * The worker handles one job at a time (a plain FIFO), so a job that overruns is always the oldest
 * one in flight: that one is blamed and answered `null`, the worker is terminated to stop the
 * runaway match, and every other job in flight is re-posted to its replacement rather than being
 * failed for someone else's deck.
 */
import { Worker } from 'node:worker_threads'

const WORKER_FILE = new URL('./deck-worker.js', import.meta.url)

/**
 * @param {{ timeoutMs?: number, onTimeout?: (job: object) => void }} options
 * @returns {{ run(job: object): Promise<any>, dispose(): void }}
 */
export function createDeckRunner({ timeoutMs = 250, onTimeout } = {}) {
  let worker = null
  let nextId = 1
  let disposed = false
  /** id → { resolve, timer, job } in submission order. */
  const pending = new Map()

  const start = () => {
    // A rule can allocate as well as backtrack: the deadline bounds its time, this bounds its memory.
    const started = new Worker(WORKER_FILE, { resourceLimits: { maxOldGenerationSizeMb: 256 } })
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
      entry.resolve(message.error ? null : message.value ?? null)
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

  /** The oldest job in flight is the one that is stuck: blame it, keep the rest. */
  const onDeadline = () => {
    const oldest = [...pending.entries()][0]
    const dying = worker
    worker = null
    for (const [, entry] of pending) clearTimeout(entry.timer)
    if (oldest) {
      const [culpritId, culprit] = oldest
      pending.delete(culpritId)
      culprit.resolve(null)
      onTimeout?.(culprit.job)
    }
    dying?.terminate?.().catch(() => {})
    // Everything else was only waiting behind it: run it again on a fresh worker.
    const survivors = [...pending.entries()]
    pending.clear()
    for (const [id, entry] of survivors) submit(id, entry.job, entry.resolve)
    idleUnref()
  }

  const submit = (id, job, resolve) => {
    let current
    try { current = worker ?? start() } catch { resolve(null); return }
    const timer = setTimeout(onDeadline, timeoutMs)
    timer.unref?.()
    pending.set(id, { resolve, timer, job })
    current.ref?.()          // hold the loop while a job is actually in flight
    try { current.postMessage({ id, job }) } catch { clearTimeout(timer); pending.delete(id); resolve(null); idleUnref() }
  }

  return {
    /** Resolves with the job's result, or `null` when it overran the deadline or could not run. */
    async run(job) {
      // After dispose there is no runner: a caller still inside `await next()` gets `null` — the
      // deck simply does nothing that turn — rather than a worker that outlives its plugin.
      if (disposed) return null
      return new Promise(resolve => submit(nextId++, job, resolve))
    },
    dispose() { disposed = true; failAll() },
  }
}
