/**
 * dsh-skin-loader browser half: fetch /dsh-skin-loader/active.css at boot and
 * inject it as the last <style> tag in <head> (empty content = stock look).
 * Switching skins takes effect on the next page refresh.
 */
window.__ModuleLoader__.load({
  id: 'dsh-skin-loader',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const TAG_ID = 'dsh-skin-loader/active.css'

    function applyCss(css) {
      let tag = document.querySelector('style[data-plugin-css="' + TAG_ID + '"]')
      if (tag === null) {
        tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-skin-loader'
        tag.dataset.pluginCss = TAG_ID
        document.head.appendChild(tag)
      } else {
        // Keep the "last style tag" position so later plugin stylesheets cannot override the token overrides.
        document.head.appendChild(tag)
      }
      tag.textContent = css
    }

    function apply() {
      fetch('/dsh-skin-loader/active.css', { cache: 'no-store' })
        .then(r => (r.ok ? r.text() : ''))
        .then(css => { if (typeof css === 'string' && css.length > 0) applyCss(css) })
        .catch(() => { /* fetch failure = keep the stock look */ })
    }

    exports.apply = apply
    return module.exports
  },
})
