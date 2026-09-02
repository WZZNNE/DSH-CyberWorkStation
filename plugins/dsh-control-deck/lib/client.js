/**
 * dsh-control-deck browser half: display-only regex rewrites (SillyTavern
 * "AI output" placement with ephemerality = display). Rules come from
 * GET /dsh-control-deck/display-regex.json (refreshed every 5 s). Only text
 * nodes under assistant message containers are rewritten, always from the
 * node's original text (kept in a WeakMap), so rules can change without
 * compounding. The session log and what the model sees are never touched.
 * Limitation (documented in the deck help): rules run per rendered text node,
 * not per message string as in SillyTavern — a pattern that must span inline
 * markup or anchor to the whole message behaves differently here.
 */
window.__ModuleLoader__.load({
  id: 'dsh-control-deck',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const ASSISTANT_SELECTORS = ['[data-chat-flow-kind="assistant"]', '[class*="AssistantMarkdown"]', '[class*="assistantMarkdown"]', '[class*="assistant-markdown"]']
    let rules = []
    // One originals map per page, shared by every instance of this module (HMR / double load),
    // so a second instance never mistakes an already rewritten node text for the original.
    const originals = (window.__dshControlDeckOriginals ??= new WeakMap())

    function compile(list) {
      const out = []
      for (const r of list) {
        try {
          // flags exactly as written (no g = first occurrence only), the same as the host engine
          out.push({ re: new RegExp(r.findRegex, String(r.flags ?? '')), replaceString: String(r.replaceString ?? ''), trimStrings: Array.isArray(r.trimStrings) ? r.trimStrings : [] })
        } catch { /* invalid rule skipped */ }
      }
      return out
    }
    // Mirror of deck.js applyRules (SillyTavern runRegexScript): {{match}} (any case) = $0, multi-digit $N,
    // $<name>, trimStrings removed from every substituted value, $$ / $& literal, flags as written.
    // Keyed by the pattern itself, not by the compiled object: `refreshRules` rebuilds those every
    // five seconds, so a Set of objects forgot the drop on the next poll and re-froze the tab.
    const slow = new Set()
    function applyRules(text) {
      const trim = (v, strings) => { let x = String(v ?? ''); for (const s of strings) x = x.split(s).join(''); return x }
      let t = text
      for (const rule of rules) {
        // A display rule is user-authored too, and this runs in the page — on every assistant text
        // node, on every mutation. The page has no way to kill a running regex, so each rule is
        // timed once: one that takes longer than a frame is dropped for the rest of the session
        // rather than freezing the tab again on the next node.
        if (slow.has(rule.re.source + '\u0000' + rule.re.flags)) continue
        const started = performance.now()
        if (rule.re.global || rule.re.sticky) rule.re.lastIndex = 0
        const template = rule.replaceString.replace(/\{\{match\}\}/gi, '$0')
        t = t.replace(rule.re, (...args) => {
          const hasNamed = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null
          const named = hasNamed ? args[args.length - 1] : {}
          const positional = args.slice(0, hasNamed ? -3 : -2)
          return template.replace(/\$(\d+)|\$<([^>]+)>/g, (tok, n, name) => trim(n !== undefined ? positional[Number(n)] : named[name], rule.trimStrings))
        })
        if (performance.now() - started > 50) {
          slow.add(rule.re.source + '\u0000' + rule.re.flags)
          console.warn('[control-deck] a display regex is too slow to run on this page and was dropped:', rule.re.source)
        }
      }
      return t
    }
    function isAssistantContainer(el) {
      return ASSISTANT_SELECTORS.some(sel => { try { return el.closest(sel) !== null } catch { return false } })
    }
    function rewrite(root) {
      if (rules.length === 0) return
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let n
      while ((n = walker.nextNode())) {
        const parent = n.parentElement
        if (!parent || !isAssistantContainer(parent)) continue
        if (parent.closest('textarea, input, [contenteditable="true"]')) continue
        const original = originals.has(n) ? originals.get(n) : n.textContent
        if (!originals.has(n)) originals.set(n, original)
        const next = applyRules(original)
        if (next !== n.textContent) n.textContent = next
      }
    }
    // Pending roots to rewrite (whole document when rules change; mutated subtrees otherwise).
    let pending = new Set()
    let scheduled = false
    function schedule(root) {
      pending.add(root ?? document.body)
      if (scheduled) return
      scheduled = true
      // setTimeout rather than requestAnimationFrame: rAF is paused in hidden/background tabs, and the
      // rewrite must still land before the user switches back.
      setTimeout(() => {
        scheduled = false
        const roots = pending; pending = new Set()
        if (roots.has(document.body)) { rewrite(document.body); return }
        for (const r of roots) if (r.isConnected) rewrite(r)
      }, 16)
    }
    async function refreshRules() {
      try {
        const r = await fetch('/dsh-control-deck/display-regex.json', { cache: 'no-store' })
        const data = r.ok ? await r.json() : { rules: [] }
        rules = compile(Array.isArray(data.rules) ? data.rules : [])
        schedule()
      } catch { /* keep last rules */ }
    }
    function apply() {
      if (window.__dshControlDeckApplied) return
      window.__dshControlDeckApplied = true
      refreshRules()
      setInterval(refreshRules, 5000)
      const mo = new MutationObserver(muts => {
        for (const m of muts) {
          if (m.type === 'characterData') { const n = m.target; if (originals.has(n) && n.textContent !== applyRules(originals.get(n))) originals.set(n, n.textContent); schedule(n.parentElement ?? document.body) }
          else schedule(m.target.nodeType === 1 ? m.target : (m.target.parentElement ?? document.body))
        }
      })
      mo.observe(document.body, { childList: true, subtree: true, characterData: true })
    }
    exports.apply = apply
    return module.exports
  },
})
