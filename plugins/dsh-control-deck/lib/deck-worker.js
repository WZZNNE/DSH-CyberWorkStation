/**
 * The deck's text work, run somewhere that can be killed.
 *
 * A regex rule and a lorebook `/re/` key are user-authored — a SillyTavern import brings in other
 * people's — and both run against the user's own message on the agent's hot path, where a regular
 * expression cannot be interrupted once it has started. Measuring a pattern before running it does
 * not work: the measurement and the run are never the same thing (a global replace scans repeatedly,
 * a rule later in the chain sees an earlier rule's output, a lorebook scan buffer includes constant
 * entries the message never mentioned). So the engine itself runs here, on the real inputs, and the
 * host kills this thread if it overruns.
 *
 * `deck.js` is imported rather than reimplemented: the worker runs the same code the host would.
 */
import { parentPort } from 'node:worker_threads'
import { compileRules, applyRules, activateLorebook } from './deck.js'

parentPort.on('message', ({ id, job }) => {
  parentPort.postMessage({ id, started: true })
  try {
    if (job.op === 'rules') {
      const rules = compileRules(job.regex, job.placement)
      parentPort.postMessage({ id, value: rules.length === 0 ? job.texts : job.texts.map(text => applyRules(text, rules)) })
      return
    }
    if (job.op === 'lore') {
      parentPort.postMessage({ id, value: activateLorebook(job.deck, job.scan, job.state, Math.random) })
      return
    }
    parentPort.postMessage({ id, value: null, error: `unknown job "${String(job.op)}"` })
  } catch (error) {
    parentPort.postMessage({ id, value: null, error: String(error && error.message ? error.message : error) })
  }
})
