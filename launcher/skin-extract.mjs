/**
 * Community skin extraction worker. Runs a skin package's legacy `lib/client.js`
 * against a DOM stub and prints the CSS it would inject as JSON on stdout.
 *
 * The `vm` context below is a convenience for stubbing the DOM, NOT a security boundary: code in a
 * `vm` realm reaches the outer one through any constructor it is given. The boundary is this
 * process: server.mjs runs it under the permission model (no filesystem writes, no child processes,
 * no workers, reads limited to this script and the skin's own file) with an empty environment and an
 * 8 s kill, and refuses to run the extraction at all on a runtime that cannot enforce that. A skin
 * "does one thing" — create a style tag and fill it — so the longest captured style text is the
 * skin body.
 *
 * Usage: node skin-extract.mjs <path-to-client.js>
 */
import fs from 'node:fs'
import vm from 'node:vm'

const file = process.argv[2]
let src = ''
try { src = fs.readFileSync(file, 'utf8') } catch { process.stdout.write(JSON.stringify({ css: '' })); process.exit(0) }

const styles = []
const rootVars = [] // CSS variables written through style.setProperty (typically background data URIs)
const mkEl = () => {
  const el = { dataset: {}, setAttribute() {}, appendChild() {}, append() {}, remove() {}, classList: { add() {}, remove() {}, toggle() {} } }
  el.style = { setProperty(k, v) { if (typeof k === 'string' && typeof v === 'string' && v.length > 0) rootVars.push(k + ':' + v) }, removeProperty() {} }
  Object.defineProperty(el, 'textContent', { set(v) { if (typeof v === 'string' && v.length > 200) styles.push(v) }, get() { return '' } })
  return el
}
const doc = {
  createElement: () => mkEl(), createTextNode: () => ({}),
  head: { appendChild() {}, append() {} },
  body: mkEl(), documentElement: mkEl(),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {},
}
const win = {
  document: doc, addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  MutationObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame() { return 0 }, setTimeout() { return 0 }, setInterval() { return 0 }, clearTimeout() {}, clearInterval() {},
  fetch: () => new Promise(() => {}), location: { href: 'http://127.0.0.1/' }, navigator: { userAgent: 'dsh-launcher' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  console: { log() {}, warn() {}, error() {} },
  __ModuleLoader__: { load(mod) {
    try {
      const out = mod?.factory?.(() => new Proxy(function () {}, { get: () => () => {}, apply: () => ({}) })) ?? {}
      for (const k of ['apply', 'activate', 'mount', 'install', 'default']) {
        if (typeof out?.[k] === 'function') { try { out[k]() } catch { /* best effort */ } }
      }
    } catch { /* extraction is best effort */ }
  } },
}
win.window = win
try { vm.runInNewContext(src, vm.createContext(win), { timeout: 5000 }) } catch { /* syntax differences are not fatal */ }
let css = styles.sort((a, b) => b.length - a.length)[0] ?? ''
if (css.length > 0 && rootVars.length > 0) css += '\n:root{' + rootVars.join(';') + '}\n'
process.stdout.write(JSON.stringify({ css }))
