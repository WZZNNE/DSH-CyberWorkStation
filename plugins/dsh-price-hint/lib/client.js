/**
 * dsh-price-hint 浏览器半:拉取 名称→价格 映射,用 MutationObserver 在模型选择
 * 弹层出现时给每个模型条目挂原生 title(悬停即显输入/输出价)。零布局影响。
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
        .catch(() => { /* 无价格数据 = 不注解 */ })
    }

    exports.apply = apply
    return module.exports
  },
})
