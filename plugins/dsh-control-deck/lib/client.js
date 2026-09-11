/** Display-only rewrites run in a terminable worker; original text stays authoritative. */
window.__ModuleLoader__.load({
  id: 'dsh-control-deck',
  factory: () => {
    var module = { exports: {} }
    Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' })
    const ASSISTANTS = '[data-chat-flow-kind="assistant"], [class*="AssistantMarkdown"], [class*="assistantMarkdown"], [class*="assistant-markdown"]'
    const EXCLUDED = 'textarea, input, [contenteditable="true"], [data-dsh-ce-overlay], [data-dsh-ce-edited], [data-dsh-ce-hidden], [data-dsh-ce-collapsed]'
    const originals = (window.__dshControlDeckOriginals ??= new WeakMap())

    function displayWorkerMain() {
      const LIMIT = 1048576
      self.onmessage = event => {
        const { id, text, rules } = event.data
        try {
          let result = text
          const trim = (value, strings) => { let out = String(value ?? ''); for (const str of strings) out = out.split(str).join(''); return out }
          for (const rule of rules) {
            let re
            try { re = new RegExp(rule.findRegex, rule.flags) } catch { continue }
            const template = rule.replaceString.replace(/\{\{match\}\}/gi, '$0')
            let produced = 0
            result = result.replace(re, (...args) => {
              const hasNamed = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null
              const named = hasNamed ? args[args.length - 1] : {}
              const positional = args.slice(0, hasNamed ? -3 : -2)
              let replacementBudget = template.length
              const replacement = template.replace(/\$(\d+)|\$<([^>]+)>/g, (token, n, name) => {
                const value = trim(n !== undefined ? positional[Number(n)] : named[name], rule.trimStrings)
                replacementBudget += value.length
                if (produced + replacementBudget > LIMIT) throw new Error('Display regex output limit exceeded')
                return value
              })
              produced += replacement.length
              if (produced > LIMIT) throw new Error('Display regex output limit exceeded')
              return replacement
            })
            if (result.length > LIMIT) throw new Error('Display regex output limit exceeded')
          }
          self.postMessage({ type: 'result', id, text: result })
        } catch { self.postMessage({ type: 'failed', id }) }
      }
      self.postMessage({ type: 'ready' })
    }
    const WORKER_SOURCE = '(' + displayWorkerMain.toString() + ')()'

    function apply(ctx) {
      window.__dshControlDeckController?.dispose()
      let disposed = false, rules = [], rulesKey = '', blockedKey = null, epoch = 0, sequence = 0
      let worker = null, workerUrl = null, workerReady = false, workerTimer = null, active = null
      let scheduleTimer = null, fetchTimer = null, fetchController = null, fetching = false, fetchGeneration = 0, rescan = false
      const queue = new Map(), pending = new Set(), tracked = new Set()
      const eligible = node => Boolean(node.isConnected && node.parentElement?.closest(ASSISTANTS) && !node.parentElement.closest(EXCLUDED))
      const canRestore = node => Boolean(node.isConnected && node.parentElement && !node.parentElement.closest('textarea, input, [contenteditable="true"], [data-dsh-ce-overlay]'))
      const recordFor = node => {
        let record = originals.get(node)
        if (!record || typeof record === 'string') {
          record = { original: typeof record === 'string' ? record : node.textContent, lastRendered: node.textContent, version: 0, appliedEpoch: -1 }
          originals.set(node, record)
        } else if (node.textContent !== record.lastRendered) {
          record.original = node.textContent
          record.lastRendered = node.textContent
          record.version++
        }
        tracked.add(node)
        return record
      }
      function restore() {
        for (const node of tracked) {
          if (!node.isConnected) { tracked.delete(node); continue }
          const record = originals.get(node)
          if (record && canRestore(node) && node.textContent === record.lastRendered) {
            record.version++
            record.lastRendered = record.original
            if (node.textContent !== record.original) node.textContent = record.original
          }
        }
      }
      function stopWorker() {
        clearTimeout(workerTimer); workerTimer = null
        if (worker) worker.terminate()
        if (workerUrl) URL.revokeObjectURL(workerUrl)
        worker = null; workerUrl = null; workerReady = false; active = null; queue.clear()
      }
      function failWorker() {
        if (disposed) return
        blockedKey = rulesKey; epoch++; rescan = false
        stopWorker(); restore()
        console.warn('[control-deck] Display regex processing stopped; original text restored. Change the rules to retry.')
      }
      function startWorker() {
        if (worker || disposed || blockedKey === rulesKey) return
        try {
          workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
          const instance = new Worker(workerUrl)
          worker = instance
          workerTimer = setTimeout(failWorker, 5000)
          instance.onerror = instance.onmessageerror = failWorker
          instance.onmessage = event => {
            if (disposed || worker !== instance) return
            const data = event.data
            if (!workerReady) {
              if (data?.type !== 'ready') { failWorker(); return }
              clearTimeout(workerTimer); workerReady = true; pump(); return
            }
            if (!active || data?.type !== 'result' || data.id !== active.id || typeof data.text !== 'string' || data.text.length > 1048576) { failWorker(); return }
            clearTimeout(workerTimer)
            const task = active; active = null
            const record = originals.get(task.node)
            if (eligible(task.node) && task.epoch === epoch && record?.version === task.version && task.node.textContent === task.observed) {
              record.lastRendered = data.text
              record.appliedEpoch = epoch
              record.appliedVersion = record.version
              if (task.node.textContent !== data.text) task.node.textContent = data.text
            }
            pump()
          }
        } catch { failWorker() }
      }
      function pump() {
        if (disposed || active || blockedKey === rulesKey || rules.length === 0) return
        if (!worker) startWorker()
        if (!workerReady) return
        while (queue.size) {
          const [node, task] = queue.entries().next().value; queue.delete(node)
          if (!eligible(node) || task.epoch !== epoch || originals.get(node)?.version !== task.version || node.textContent !== task.observed) continue
          active = task
          workerTimer = setTimeout(failWorker, 150)
          try { worker.postMessage({ id: task.id, text: task.original, rules }) } catch { failWorker() }
          return
        }
        if (rescan) { rescan = false; schedule(document.body) }
      }
      function scan(root) {
        if (!root?.isConnected || disposed || rules.length === 0 || blockedKey === rulesKey) return
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          if (!eligible(node)) continue
          const record = recordFor(node)
          if (record.original.length > 131072 || (record.appliedEpoch === epoch && record.appliedVersion === record.version)) continue
          if (queue.has(node) || (active?.node === node && active.version === record.version)) continue
          if (queue.size >= 64) { rescan = true; break }
          queue.set(node, { node, original: record.original, observed: node.textContent, version: record.version, epoch, id: ++sequence })
        }
        pump()
      }
      function schedule(root = document.body) {
        if (disposed) return
        if (pending.size < 64) pending.add(root)
        else { pending.clear(); pending.add(document.body) }
        if (scheduleTimer !== null) return
        scheduleTimer = setTimeout(() => {
          scheduleTimer = null
          const roots = [...pending]; pending.clear()
          for (const node of tracked) if (!node.isConnected) tracked.delete(node)
          if (roots.includes(document.body)) scan(document.body)
          else for (const target of roots) scan(target)
        }, 16)
      }
      async function refreshRules() {
        if (disposed || fetching) return
        fetching = true
        const generation = ++fetchGeneration
        const request = new AbortController(); fetchController = request
        fetchTimer = setTimeout(() => request.abort(), 15000)
        try {
          const response = await fetch('/dsh-control-deck/display-regex.json', { cache: 'no-store', signal: request.signal })
          if (!response.ok) return
          const data = await response.json()
          if (disposed || generation !== fetchGeneration) return
          const next = Array.isArray(data.rules) ? data.rules.map(rule => ({ findRegex: String(rule.findRegex ?? ''), flags: String(rule.flags ?? ''), replaceString: String(rule.replaceString ?? ''), trimStrings: Array.isArray(rule.trimStrings) ? rule.trimStrings.map(String) : [] })) : []
          const key = JSON.stringify(next)
          if (key === rulesKey) return
          stopWorker(); rules = next; rulesKey = key; blockedKey = null; epoch++; rescan = false
          restore()
          if (next.length > 200 || next.some(rule => rule.findRegex.length > 8192 || rule.replaceString.length > 8192 || rule.trimStrings.length > 100 || rule.trimStrings.some(value => value.length > 8192))) { failWorker(); return }
          if (next.length) schedule()
        } catch { /* Keep last rules while the endpoint is temporarily unavailable. */ }
        finally { clearTimeout(fetchTimer); fetchTimer = null; if (fetchController === request) fetchController = null; fetching = false }
      }
      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') {
            const node = mutation.target
            if (!eligible(node)) continue
            const existing = originals.get(node)
            if (existing && node.textContent === existing.lastRendered) continue
            recordFor(node); schedule(node.parentElement)
          } else schedule(mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement)
        }
      })
      function dispose() {
        if (disposed) return
        disposed = true; epoch++; fetchGeneration++
        clearInterval(interval); clearTimeout(scheduleTimer); clearTimeout(fetchTimer)
        fetchController?.abort(); observer.disconnect(); stopWorker(); pending.clear(); restore(); tracked.clear()
        window.removeEventListener?.('pagehide', dispose)
        if (window.__dshControlDeckController === controller) delete window.__dshControlDeckController
      }
      const controller = { dispose }
      window.__dshControlDeckController = controller
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      const interval = setInterval(refreshRules, 5000)
      window.addEventListener?.('pagehide', dispose, { once: true })
      if (ctx?.effect) ctx.effect(() => dispose)
      refreshRules()
    }
    module.exports.apply = apply
    return module.exports
  },
})
