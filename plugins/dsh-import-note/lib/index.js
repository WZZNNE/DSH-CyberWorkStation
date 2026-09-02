/**
 * dsh-import-note — host half: nothing to serve. The plugin exists for its browser half, one card
 * under Settings → Plugins that says what the community session importer (dsh-chat-import) does
 * with a source transcript's system prompt. Read from that plugin's code (0.8.2):
 *
 *   - lib/import-prefs.mjs: settings namespace `chat-import`, one switch `importSystemPrompt`,
 *     default false — system / developer messages of the source are dropped on import;
 *   - lib/convert/core.mjs contextInjectionText() + synthesizeSession(): with the switch on, the
 *     collected prompt is appended to an "environment changed" notice and written as ONE
 *     `user/message` event with source { kind: 'plugin', plugin: 'chat-import' }, pinned before
 *     the first turn of the imported session — the folded "context injection" line in the UI;
 *   - nothing in the import chain writes to `ctx.systemPrompt` or any plugin's prompt section.
 *
 * So an import never overrides dsh's own system prompt or a plugin's injected prompt. The
 * importer's settings page is its own (its locale namespace has a single owner and the section
 * carries no slot), which is why the sentence is a card here rather than a line on that page.
 */
import z from '@deepseek-ai/schemastery'

export const name = 'import-note'
export const inject = []
/** The Plugins tab renders a card only for a settings namespace the host serves; this one is empty on purpose. */
const NS = 'import-note'

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  ctx.inject(['settings'], sctx => {
    try { sctx.settings.register(NS, z.object({})) } catch (error) { console.warn(`[import-note] settings namespace not registered: ${String(error?.message ?? error)}`) }
  })
  console.log('[import-note] ready (a Settings → Plugins card; no routes)')
}
