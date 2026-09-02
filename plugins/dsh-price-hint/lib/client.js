/**
 * dsh-price-hint browser half: fetch the name → price map and, through a
 * MutationObserver, give every model entry in the model picker a native title
 * attribute (hover shows input / output prices). Zero layout impact.
 */
window.__ModuleLoader__.load({
  id: 'dsh-price-hint',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    let priceMap = {}
    let names = []

    function annotate(root) {
      if (names.length === 0) return
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let n
      while ((n = walker.nextNode())) {
        const t = n.textContent.trim()
        if (t.length < 3 || t.length > 60) continue
        if (priceMap[t] === undefined) continue
        const host = n.parentElement?.closest('[role="option"], li, [class*="item"], [class*="Item"], [class*="option"]') ?? n.parentElement
        if (host && host.title !== priceMap[t]) host.title = priceMap[t]
      }
    }

    function apply() {
      fetch('/dsh-price-hint/prices.json', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : {}))
        .then(map => {
          priceMap = map ?? {}
          names = Object.keys(priceMap)
          annotate(document.body)
          const mo = new MutationObserver(muts => {
            for (const m of muts) for (const node of m.addedNodes) {
              if (node.nodeType === 1) annotate(node)
            }
          })
          mo.observe(document.body, { childList: true, subtree: true })
        })
        .catch(() => { /* no price data = no annotations */ })
    }

    exports.apply = apply
    return module.exports
  },
})
