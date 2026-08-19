/**
 * dsh-skin-loader 浏览器半:启动时拉取 /dsh-skin-loader/active.css,
 * 注入 <head> 末尾的 style 标签(空内容 = 原生外观)。切换皮肤后刷新页面生效。
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
        // 保持"最后一个 style"位置,确保覆盖后续插件样式表的令牌定义。
        document.head.appendChild(tag)
      }
      tag.textContent = css
    }

    function apply() {
      fetch('/dsh-skin-loader/active.css', { cache: 'no-store' })
        .then(r => (r.ok ? r.text() : ''))
        .then(css => { if (typeof css === 'string' && css.length > 0) applyCss(css) })
        .catch(() => { /* 拉取失败 = 保持原生外观 */ })
    }

    exports.apply = apply
    return module.exports
  },
})
