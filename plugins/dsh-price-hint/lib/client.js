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

    function apply(ctx) {
      let priceMap = {}
      let active = true
      let loading = false
      const owned = new Map()
      const changedElsewhere = new WeakSet()
      const controller = new AbortController()

      function restore(host, state) {
        if (host.title === state.written) {
          if (state.original === null) host.removeAttribute('title')
          else host.setAttribute('title', state.original)
        } else changedElsewhere.add(host)
        owned.delete(host)
      }

      function annotate() {
        for (const [host, state] of owned) restore(host, state)
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const label = node.textContent.trim()
          if (!Object.hasOwn(priceMap, label) || typeof priceMap[label] !== 'string') continue
          // Actual core ModelSelect uses menuitemradio. Do not annotate arbitrary
          // body text or class-name matches elsewhere in the application.
          const host = node.parentElement?.closest('[role="menuitemradio"], [role="option"]')
          if (!host || owned.has(host) || changedElsewhere.has(host)) continue
          // Model descriptions also contain text. The native title is the model's
          // actual display name; matching it avoids treating a description as a name.
          if (host.getAttribute('title')?.trim() !== label) continue
          owned.set(host, { original: host.getAttribute('title'), written: priceMap[label] })
          host.title = priceMap[label]
        }
      }

      async function refresh() {
        if (!active || loading) return
        loading = true
        try {
          const response = await fetch('/dsh-price-hint/prices.json', { cache: 'no-store', signal: controller.signal })
          const map = response.ok ? await response.json() : {}
          if (!active) return
          priceMap = map && typeof map === 'object' && !Array.isArray(map) ? map : {}
          annotate()
        } catch {
          if (active) { priceMap = {}; annotate() }
        } finally { loading = false }
      }

      const observer = new MutationObserver(() => { if (active) annotate() })
      observer.observe(document.body, { childList: true, characterData: true, subtree: true })
      const timer = setInterval(() => { void refresh() }, 30000)
      void refresh()
      ctx.effect(() => () => {
        active = false
        controller.abort()
        clearInterval(timer)
        observer.disconnect()
        for (const [host, state] of owned) restore(host, state)
      }, 'dsh-price-hint: title lifecycle')
    }

    exports.apply = apply
    return module.exports
  },
})
