// dsh-vision-bridge — host half.
//
// A self-owned vision bridge for text-only DeepSeek conversations:
//  1. At the agent boundary (agent/pre-step) it replaces every image block in
//     the MODEL's request with a text marker pointing at `describe_image`, so
//     an image content block never reaches a text-only provider (which would
//     otherwise fail the whole turn with UNSUPPORTED_CONTENT). The session log
//     keeps the original image, so the Web UI still shows it.
//  2. It registers a `describe_image` tool that sends the image to a vision
//     model of the DEPLOYMENT'S choosing (auto-picked from the LLM catalog, or
//     set explicitly via the Web settings card) and returns its answer to the
//     text model.
//
// Nothing is delegated to third parties: both the rewrite and the vision call
// run here, using the harness `llm` service and the configured vision model.

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runChannels, probeOllama, channelKey } from './channels.js'
import { createLru, descriptionCacheKey } from './cache.js'
import { EvidenceStore } from './evidence.js'
import { VisionJournal } from './journal.js'

export const name = 'dsh-vision-bridge'
export const inject = ['tools', 'llm', 'attachments', 'fs', 'webServer', 'settings', 'skills']

export const Config = z.object({
  // Empty => auto-pick the first vision-capable model found in the LLM catalog.
  visionProvider: z
    .string()
    .description('Provider of the vision model that answers describe_image. Empty = auto-detect.')
    .default(''),
  visionModel: z
    .string()
    .description('Model id of the vision model. Empty = auto-detect.')
    .default(''),
  sanitizeImages: z
    .boolean()
    .description('Rewrite image blocks to text markers for text-only models so turns never fail.')
    .default(true),
  // 'hybrid' preserves the legacy behavior (auto-rewrite + tools available).
  // 'llm' = same rewrite but explicitly user-chosen. 'tools' = never auto-rewrite;
  // the model has to call describe_image itself, otherwise the adapter fails.
  mode: z
    .union([z.const('hybrid'), z.const('llm'), z.const('tools')])
    .description('Bridge mode: hybrid (default, auto-rewrite + tools), llm (auto-rewrite only), tools (no auto-rewrite, model must call describe_image).')
    .default('hybrid'),
  // 'auto' = call the vision LLM (current behavior). 'ocr-local' / 'cache-only' are
  // hints reserved for future local-OCR fallback; until then they behave like 'auto'.
  describeStrategy: z
    .union([z.const('auto'), z.const('llm'), z.const('ocr-local'), z.const('cache-only')])
    .description('How describe_image and the auto-rewrite resolve a description. auto/llm use the vision LLM today; ocr-local/cache-only are reserved.')
    .default('auto'),
  // 'simple-only' = one pass. 'auto-escalate' = ask the vision model to self-rate
  // complexity; if complex, do a second deeper pass before substituting (idea from
  // 54xkeee/dsh-vision-web).
  escalation: z
    .union([z.const('simple-only'), z.const('auto-escalate')])
    .description('Escalation policy for the auto-rewrite. simple-only = one pass; auto-escalate = second pass on complex images.')
    .default('simple-only'),
  // Multi-channel vision endpoint (Issue #2). Empty = legacy auto-pick from
  // the DSH LLM catalog (one channel = {type:'dsh-catalog'}).
  channels: z
    .array(z.any())
    .description('Vision endpoints tried in order. Empty array = legacy auto-pick. Supported types: dsh-catalog, openai-compatible, ollama, custom.')
    .default([]),
  channelFallback: z
    .union([z.const('sequential'), z.const('parallel-race')])
    .description('How channels are tried. sequential = one by one until one succeeds (default). parallel-race = all at once, first success wins.')
    .default('sequential'),
  channelTimeoutMs: z
    .number()
    .description('Per-channel HTTP timeout in milliseconds.')
    .default(30000),
  channelCooldownMs: z
    .number()
    .description('Skip a failing channel for this long after a 4xx/timeout. 0 disables cooldown.')
    .default(60000),
  channelFailureMode: z
    .union([z.const('placeholder'), z.const('error')])
    .description('What to do when ALL channels fail. placeholder (default) inserts "[image description unavailable]" and lets the chat continue; error throws.')
    .default('placeholder'),
  autoLocalOllama: z
    .boolean()
    .description('On startup, probe http://localhost:11434/v1 and prepend an ollama channel if reachable.')
    .default(true),
  keysFromEnv: z
    .array(z.string())
    .description('Env-var names to look up when a channel has no apiKey. Order matters: first match wins.')
    .default(['VISION_API_KEY', 'DASHSCOPE_API_KEY', 'OPENAI_API_KEY', 'ZHIPUAI_API_KEY']),
  // Per-image description cache (Issue #3). LRU with composite key.
  cacheEnabled: z
    .boolean()
    .description('Enable in-memory cache of descriptions keyed by image bytes + prompt + model + mode.')
    .default(true),
  cacheMaxEntries: z
    .number()
    .description('Maximum number of cached descriptions before LRU eviction.')
    .default(256),
  // Block 7 (0.2.12): native passthrough control.
  nativePassthrough: z
    .union([z.const('prefer'), z.const('always'), z.const('never')])
    .description('prefer (default): bridge only for text-only models; always: never bridge; never: always bridge even for vision models.')
    .default('prefer'),
  // Block 4 (0.2.9): persist evidence across restarts.
  evidencePersist: z
    .boolean()
    .description('Persist descriptions to disk so later sessions reuse them without re-calling the vision model.')
    .default(false),
  evidenceDir: z
    .string()
    .description('Directory for vision-evidence.json. Empty = plugin data dir (DSH-provided) or cwd fallback.')
    .default(''),
  evidenceMaxEntries: z
    .number()
    .description('Maximum persisted entries before oldest-ts eviction.')
    .default(2000),
  // Block 8 (0.2.13): privacy boundary.
  allowedImageDirs: z
    .array(z.string())
    .description('If non-empty, only allow image paths under these dirs; others are rejected.')
    .default([]),
  auditLog: z
    .union([z.const('off'), z.const('errors'), z.const('all')])
    .description('off: no log; errors: log failures; all: log every vision call.')
    .default('off'),
  maskSecrets: z
    .boolean()
    .description('Mask API keys in error messages.')
    .default(true),
  // Block 0.3.9 (#65): task-aware vision prompts.
  focusHint: z
    .boolean()
    .description('Pass the latest user message as a focus hint to the vision model, so the description emphasises what the user asked about.')
    .default(true),
  taskMode: z
    .union([z.const('glance'), z.const('ocr'), z.const('region'), z.const('compare')])
    .description('Default framing for the auto-rewrite prompt. glance = general; ocr = transcribe; region = spatial layout; compare = differences across images.')
    .default('glance'),
  maxImageBytes: z
    .number()
    .description('Upper bound in bytes for a single image sent to the vision model.')
    .default(20 * 1024 * 1024),
  // #91: uniform pixel-count guard before the vision call. Without a native
  // image lib we reject oversized images with a clear error instead of silently
  // sending multi-MP payloads that providers reject. Upgrade path: if sharp is
  // installed, downscale to this limit in one place here.
  maxImagePixels: z
    .number()
    .description('Upper bound in pixels (width*height) for a single image. 0 disables the guard. Default 4MP.')
    .default(4_000_000),
  // #96: per-call resolution hint for vision tools (token economy on large images).
  detail: z
    .union([z.const('auto'), z.const('low'), z.const('high')])
    .description('Resolution hint passed to providers that support it. auto = let the provider decide; low = fewer tokens; high = maximum fidelity.')
    .default('auto'),
  // #106: stream vision responses token-by-token for faster first-token latency.
  stream: z
    .boolean()
    .description('Stream openai-compatible responses (SSE) for faster first token. Falls back to non-stream automatically.')
    .default(false),
  timeoutMs: z
    .number()
    .description('Timeout for a describe_image call in milliseconds.')
    .default(120000),
})

/** True when the bridge is allowed to substitute image blocks for the given mode. */
export function sanitizeAllowed(config) {
  return config.sanitizeImages !== false && config.mode !== 'tools'
}

/** Whether to let a vision-capable model see the image natively instead of bridging. */
export function shouldBridgeForModel(config, supportsImages) {
  const pref = config.nativePassthrough || 'prefer'
  if (pref === 'never') return true
  if (pref === 'always') return false
  return !supportsImages // prefer: bridge only when text-only
}

export function isPathAllowed(path, allowedDirs) {
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) return true
  const p = String(path || '')
  return allowedDirs.some((d) => p.startsWith(String(d)))
}

export function maskSecretsInError(msg) {
  if (typeof msg !== 'string') return msg
  return msg.replace(/(api[_-]?key\s*[:=]\s*)[^,\s]+/gi, '$1***')
}

/** True when `info` (from ctx.llm) explicitly declares image input. */
export function acceptsImages(info) {
  return Array.isArray(info && info.inputModalities) && info.inputModalities.includes('image')
}

/** Whether any block in `content` is an image. */
export function blocksHaveImage(content) {
  if (!Array.isArray(content)) return false
  return content.some((block) => {
    if (!block || typeof block !== 'object') return false
    if (block.type === 'image') return true
    return Array.isArray(block.content) && blocksHaveImage(block.content)
  })
}

/**
 * Recursively rewrite image blocks anywhere in a content tree (including
 * inside tool-result blocks and top-level tool results), and collect every
 * attachment reference found so describe_image can read them by id.
 */
export async function rewriteImagesDeep(content, replace) {
  const attachments = []
  const walk = async (blocks) => {
    if (!Array.isArray(blocks)) return { content: blocks, changed: false }
    let changed = false
    const next = []
    for (const block of blocks) {
      if (block && block.type === 'image') {
        if (block.attachment) attachments.push(block.attachment)
        changed = true
        // replace may be sync or async; await the (possibly already-resolved) value.
        const out = await (async () => Promise.resolve(replace(block)))()
        if (out !== undefined && out !== null) {
          if (Array.isArray(out)) next.push(...out)
          else next.push(out)
        }
        continue
      }
      if (block && Array.isArray(block.content)) {
        const nested = await walk(block.content)
        if (nested.changed) {
          changed = true
          next.push({ ...block, content: nested.content })
          continue
        }
      }
      next.push(block)
    }
    return { content: changed ? next : blocks, changed }
  }
  const result = await walk(content)
  return { content: result.content, changed: result.changed, attachments }
}

/** Marks a request this plugin re-dispatched, so the interceptor does not recurse. */
const VISION_PASS = Symbol.for('dsh-vision-bridge/pass')

export function apply(ctx, config) {
  // Helper: do we have any way to authenticate a channel? Used by the UI status-dot.
  const hasUsableKey = (channel) => {
    if (!channel) return false
    if (typeof channel.apiKey === 'string' && channel.apiKey.trim()) return true
    const names = Array.isArray(config.keysFromEnv) ? config.keysFromEnv : []
    for (const n of names) {
      const v = process.env[n]
      if (typeof v === 'string' && v.trim()) return true
    }
    return false
  }
  // Helper: name the key the channel will use, for the status-dot label.
  const resolveKey = (channel) => {
    if (channel && typeof channel.apiKey === 'string' && channel.apiKey.trim()) return 'config'
    const names = Array.isArray(config.keysFromEnv) ? config.keysFromEnv : []
    for (const n of names) {
      if (typeof process.env[n] === 'string' && process.env[n].trim()) return n
    }
    return ''
  }
  // attachmentId -> full ref, recorded from image blocks seen at the agent
  // boundary so describe_image can read them by id without session plumbing.
  const attachmentById = new Map()
  // Channel cooldowns persist across calls within the plugin lifetime.
  const channelCooldowns = new Map()
  // Block 0.3.9 (#65): last user text, used as focus hint for task-aware prompts.
  let lastUserText = ''
  // Block B (0.3.6): per-channel usage stats (calls/latency/errors) for /stats + bench.
  const usageByChannel = new Map()
  const bumpUsage = (key, ms, ok, keyUsed, usage) => {
    const cur = usageByChannel.get(key) || { calls: 0, totalMs: 0, errors: 0, lastMs: 0 }
    cur.calls++; cur.totalMs += ms; cur.lastMs = ms; if (!ok) cur.errors++
    // #98: track which key/quota label the read spent.
    if (ok && keyUsed) {
      cur.quota = cur.quota || {}
      cur.quota[keyUsed] = (cur.quota[keyUsed] || 0) + 1
    }
    // #107: real token usage from the provider response (accurate cost).
    if (ok && usage) {
      const pt = Number(usage.prompt_tokens) || 0
      const ct = Number(usage.completion_tokens) || 0
      cur.tokensIn = (cur.tokensIn || 0) + pt
      cur.tokensOut = (cur.tokensOut || 0) + ct
    }
    usageByChannel.set(key, cur)
  }
  // contentHash -> description, so repeated questions about the same image
  // reuse a cached answer instead of re-spending a vision-model call, and so
  // later text turns substitute a real description instead of a bare marker.
  // Issue #3: LRU cache keyed by bytes+prompt+model+mode. Map-based, no deps.
  const descriptionByHash = config.cacheEnabled === false ? null : createLru(config.cacheMaxEntries)
  // Block 4 (0.2.9): optional persistent evidence store behind the LRU.
  const evidenceStore = config.evidencePersist ? new EvidenceStore(config.evidenceDir || '.', config.evidenceMaxEntries) : null
  // #108: vision journal — audit trail of every vision call.
  const journal = new VisionJournal(config.evidenceDir || '.', config.evidenceMaxEntries)
  // #110: batch manager — track in-flight batches for progress + cancel.
  const batches = new Map()
  let batchSeq = 0
  // attachmentId -> description, for inline substitution in later text turns.
  const descriptionByAttachmentId = new Map()

  const visionSelection = async () => {
    const provider = (config.visionProvider || '').trim()
    const model = (config.visionModel || '').trim()
    if (provider && model) {
      let info
      try {
        info = await ctx.llm.resolveModelInfo(provider, model)
      } catch {
        info = undefined
      }
      // Explicitly configured but not vision-capable / not found: refuse loudly.
      if (!(info && acceptsImages(info))) {
        throw new Error(
          `dsh-vision-bridge: модель "${provider}/${model}" не объявлена как принимающая изображения (input: ${info && info.inputModalities ? info.inputModalities.join(',') : 'unknown'}). Укажите vision-модель в настройках плагина.`,
        )
      }
      return { provider, model }
    }
    // Auto-detect the first vision-capable model in the catalog.
    const providers = ctx.llm.listProviders().map((p) => p.id)
    if (providers.length > 0) {
      for (const prov of providers) {
        try {
          const models = await ctx.llm.listModels(prov)
          for (const m of models || []) {
            if (acceptsImages(m)) return { provider: prov, model: m.id }
          }
        } catch {
          // try the next provider
        }
      }
    }
    throw new Error(
      'dsh-vision-bridge: не найдено ни одной vision-модели в каталоге LLM. Добавьте vision-модель (input: [text, image]) в Настройки → Модели, либо укажите visionProvider/visionModel в настройках плагина.',
    )
  }

  // Prefer a stable resolution but watch for topologies that change at boot
  // (adapters register asynchronously). Re-resolve per call is safest.
  //
  // Send one image's bytes to the chosen vision model and return the
  // description. Cache by composite key (bytes+prompt+model+mode) so repeated
  // questions about the same image (or the same image appearing in many later
  // turns) reuse the previous answer.
  const cacheKeyFor = (bytes, question, model) => {
    if (!descriptionByHash) return null
    return descriptionCacheKey({
      bytes,
      prompt: question,
      model,
      mode: config.describeStrategy || 'auto',
    })
  }
  // #110: run a batch of images with progress + cancel. Returns a batch id; the
  // caller polls /batch/:id for progress and can POST /batch/:id/cancel.
  const startBatch = async (items, prompt) => {
    const id = 'b' + (++batchSeq)
    const ctrl = new AbortController()
    const state = { id, prompt, total: items.length, done: 0, ok: 0, failed: 0, results: [], cancelled: false, startedAt: Date.now() }
    batches.set(id, { state, ctrl })
    ;(async () => {
      for (const item of items) {
        if (ctrl.signal.aborted) { state.cancelled = true; break }
        try {
          const r = await callVisionModelWithBytes(item.bytes, item.contentType, prompt || 'Describe this image.', { signal: ctrl.signal })
          state.results.push({ id: item.id, description: r.description || '' })
          state.ok++
        } catch (e) {
          if (ctrl.signal.aborted) { state.cancelled = true; break }
          state.results.push({ id: item.id, error: String(e?.message || e).slice(0, 200) })
          state.failed++
        }
        state.done++
      }
      state.finishedAt = Date.now()
    })()
    return id
  }

  const callVisionModelWithBytes = async (bytes, contentType, question, opts) => {
    // #91: uniform pixel guard — reject oversized images before spending a call.
    if (config.maxImagePixels > 0) {
      const dims = imageDimensions(bytes)
      if (dims && dims.width > 0 && dims.height > 0 && dims.width * dims.height > config.maxImagePixels) {
        throw new Error(
          `dsh-vision-bridge: изображение ${dims.width}×${dims.height}px (${(dims.width * dims.height / 1e6).toFixed(1)}MP) превышает лимит ${(config.maxImagePixels / 1e6).toFixed(1)}MP. Уменьшите изображение перед вызовом.`,
        )
      }
    }
    const detail = opts && opts.detail ? opts.detail : (config.detail || 'auto')
    // Channels-driven path (Issue #2). Empty config.channels = legacy path.
    if (Array.isArray(config.channels) && config.channels.length > 0) {
      const modelHint = (config.channels.find((c) => c && c.model) || {}).model || 'channels'
      const key = cacheKeyFor(bytes, question, modelHint)
      if (key) {
        const cached = descriptionByHash.get(key)
        if (cached !== undefined) return { description: cached, cached: true }
        // Block 4: persistent evidence fallback (survives restarts).
        const persisted = evidenceStore && evidenceStore.get(key)
        if (persisted !== undefined) {
          descriptionByHash.set(key, persisted)
          return { description: persisted, cached: true }
        }
      }
      const t0 = Date.now()
      const result = await runChannels(config.channels, {
        bytes,
        contentType: contentType || sniffMediaType(bytes) || 'image/png',
        prompt: question,
        timeoutMs: config.channelTimeoutMs,
        cooldownMs: config.channelCooldownMs,
        signal: opts && opts.signal,
        cooldowns: channelCooldowns,
        fallback: config.channelFallback || 'sequential',
        detail,
        stream: config.stream === true,
      })
      const chKey = result.channel ? channelKey(result.channel) : 'all'
      // #98: surface which key/quota the read spent.
      const keyLabel = result.keyUsed
      if (result.ok && result.description) {
        bumpUsage(chKey, Date.now() - t0, true, result.keyUsed, result.usage)
        if (key) descriptionByHash.set(key, result.description)
        if (key && evidenceStore) evidenceStore.set(key, result.description)
        // #108: journal the successful call.
        journal.add({ ok: true, channel: chKey, key: keyLabel, imageHash: contentHash(bytes), prompt: question.slice(0, 200), tokensIn: result.usage && result.usage.prompt_tokens, tokensOut: result.usage && result.usage.completion_tokens, latencyMs: Date.now() - t0 })
        // #88: expose meta.attempts (channel-level failover trace) to callers/UI.
        return { description: result.description, cached: false, attempts: result.attempts, keyUsed: keyLabel, usage: result.usage }
      }
      bumpUsage(chKey, Date.now() - t0, false)
      // #108: journal the failure.
      journal.add({ ok: false, channel: chKey, key: keyLabel, imageHash: contentHash(bytes), prompt: question.slice(0, 200), reason: result.reason, latencyMs: Date.now() - t0 })
      if (config.channelFailureMode === 'placeholder') {
        return { description: '[image description unavailable: ' + (result.reason || 'all channels failed') + ']', cached: false, attempts: result.attempts, keyUsed: keyLabel }
      }
      throw new Error('dsh-vision-bridge: ' + (result.reason || 'all channels failed'))
    }
    const { provider, model } = await visionSelection()
    const key = cacheKeyFor(bytes, question, provider + '/' + model)
    if (key) {
      const cached = descriptionByHash.get(key)
      if (cached !== undefined) return { description: cached, provider, model, cached: true }
      const persisted = evidenceStore && evidenceStore.get(key)
      if (persisted !== undefined) {
        descriptionByHash.set(key, persisted)
        return { description: persisted, provider, model, cached: true }
      }
    }
    // The adapter resolves an image block through attachments.readImage(ref),
    // and the store only accepts its own `sha256:<hex>` ids. A fabricated ref
    // makes readImage throw INVALID_ATTACHMENT_REF inside the stream, which
    // collectText silently swallows — so store the bytes and pass the real ref.
    const savedRef = await ctx.attachments.saveImage({
      data: bytes,
      mediaType: contentType || sniffMediaType(bytes) || 'image/png',
      name: 'vision-input',
    })
    const blocks = [
      { type: 'image', attachment: savedRef },
      { type: 'text', text: question },
    ]
    const chunks = ctx.llm.stream({
      ...(opts && opts.signal ? { signal: opts.signal } : {}),
      provider,
      model,
      messages: [{ role: 'user', content: blocks }],
      ...(config.timeoutMs > 0 ? { maxTokens: 1024 } : {}),
    })
    const text = await collectText(chunks)
    if (text && key) {
      descriptionByHash.set(key, text)
      if (evidenceStore) evidenceStore.set(key, text)
    }
    return { description: text, provider, model, cached: false }
  }

  // describeAttachment: used by the pre-step sanitizer when an image is shown
  // to a text-only model. Returns the description text (cached) and records
  // it against the attachment id so later text turns reuse the same answer.
  const describeAttachment = async (ref) => {
    if (!ref) return undefined
    const id = ref.attachmentId ?? ref.id
    if (id !== undefined) {
      const hit = descriptionByAttachmentId.get(String(id))
      if (typeof hit === 'string' && hit.trim()) return hit
    }
    let stored
    try {
      stored = await ctx.attachments.readImage(ref)
    } catch {
      return undefined
    }
    if (stored.data.length > config.maxImageBytes) return undefined
    // Block 0.3.9 (#65): task-aware prompt — focus hint from the latest user
    // message, framing by taskMode.
    const modePrompts = {
      glance: 'Describe everything visible in this image in thorough detail. Include any text, code, UI, data, objects, people, layout, colors, and any other notable visual information.',
      ocr: 'Transcribe all text visible in this image in natural reading order, preserving headings, paragraphs, tables and UI hierarchy.',
      region: 'Describe the spatial layout of this image: regions, their coordinates in words (top-left, center, …), and what each region contains.',
      compare: 'List the distinct elements of this image so they can be compared against another image later. Be specific about what differs or stands out.',
    }
    let prompt = modePrompts[config.taskMode] || modePrompts.glance
    const hint = lastUserText && config.focusHint !== false ? String(lastUserText).trim() : ''
    if (hint) prompt += ` Focus on what is relevant to this user request: "${hint.slice(0, 400)}"`
    const { description: firstPass } = await callVisionModelWithBytes(
      stored.data,
      ref.mediaType || stored.ref?.mediaType || 'image/png',
      prompt,
      {},
    )
    // ponytail: escalation kept inline — second pass only when auto-escalate is on
    // and the first pass self-reports complexity=complex. Upgrade path: proper
    // complexity classifier once we have a tracked metric.
    if (config.escalation !== 'auto-escalate' || !firstPass) {
      if (firstPass && id !== undefined) descriptionByAttachmentId.set(String(id), firstPass)
      return firstPass
    }
    const verdict = await classifyComplexity(stored.data, ref.mediaType || 'image/png')
    let description = firstPass
    if (verdict === 'complex') {
      const deep = await callVisionModelWithBytes(
        stored.data,
        ref.mediaType || stored.ref?.mediaType || 'image/png',
        prompt + ' This image looked complex on a first pass; produce a deeper, more exhaustive description that covers every visible element, spatial layout, all text and numbers, and any UI hierarchy.',
        {},
      )
      if (deep.description) description = deep.description
    }
    if (description && id !== undefined) descriptionByAttachmentId.set(String(id), description)
    return description
  }

  // ponytail: cheap one-shot complexity classifier; the model returns strict JSON.
  // Worth replacing with a deterministic heuristic (edge density, file size) once we
  // see real traffic — a vision call just to decide whether to call again is the
  // 2x cost we're trying to avoid.
  const classifyComplexity = async (bytes, contentType) => {
    try {
      const { provider, model } = await visionSelection()
      const savedRef = await ctx.attachments.saveImage({
        data: bytes,
        mediaType: contentType || 'image/png',
        name: 'vision-complexity-check',
      })
      const chunks = ctx.llm.stream({
        provider,
        model,
        messages: [{ role: 'user', content: [
          { type: 'image', attachment: savedRef },
          { type: 'text', text: 'Reply with strict JSON {"complexity":"simple|complex"} only. complex = dense small text, code, UI, tables, charts, multi-subject layouts, fine-grained counting or comparison. Otherwise simple.' },
        ] }],
        maxTokens: 32,
      })
      const text = await collectText(chunks)
      const m = text && text.match(/complex|simple/i)
      return m && m[0].toLowerCase() === 'complex' ? 'complex' : 'simple'
    } catch {
      return 'simple'
    }
  }

  const describeImage = async (args, exec) => {
    const attachmentIds = Array.isArray(args.attachmentIds) ? args.attachmentIds : []
    const paths = Array.isArray(args.paths) ? args.paths : []
    const urls = Array.isArray(args.urls) ? args.urls : []
    const detail = args.detail
    const question = typeof args.question === 'string' && args.question.trim() ? args.question.trim() : 'Опиши это изображение.'
    if (attachmentIds.length + paths.length + urls.length === 0) {
      throw new Error('describe_image: передайте attachmentIds (id картинки из разговора), paths (путь к файлу) или urls (http(s) URL).')
    }
    const fs = ctx.get('fs')
    const seenRefs = []
    for (const id of attachmentIds) {
      const ref = attachmentById.get(String(id))
      if (ref === undefined) {
        throw new Error(`describe_image: неизвестный attachment id "${id}". Возьмите id из маркера/уведомления или укажите paths.`)
      }
      let stored
      try {
        stored = await ctx.attachments.readImage(ref)
      } catch (error) {
        throw new Error(`describe_image: не удалось прочитать вложение ${id} (${error && error.message ? error.message : String(error)})`)
      }
      if (stored.data.length > config.maxImageBytes) {
        throw new Error(`describe_image: вложение ${id} слишком большое (${stored.data.length} байт, лимит ${config.maxImageBytes}).`)
      }
      const genericQuestion = /^(опиши|описать|расскажи|что.*изображ|describe|what.*(image|picture)|what is in)/i.test(question)
      let entry
      if (genericQuestion) {
        entry = await callVisionModelWithBytes(stored.data, ref.mediaType || 'image/png', question, { ...(exec ? { signal: exec.signal } : {}), detail })
      } else {
        // Non-generic question: bypass the generic description cache, but
        // still use the chosen vision model.
        const { provider, model } = await visionSelection()
        const chunks = ctx.llm.stream({
          ...(exec ? { signal: exec.signal } : {}),
          provider, model,
          messages: [{ role: 'user', content: [
            { type: 'image', attachment: ref },
            { type: 'text', text: question },
          ] }],
          ...(config.timeoutMs > 0 ? { maxTokens: 1024 } : {}),
        })
        const text = await collectText(chunks)
        entry = { description: text, provider, model, cached: false }
      }
      if (entry.description) {
        descriptionByAttachmentId.set(String(id), entry.description)
        seenRefs.push(ref)
      }
    }
    for (const path of paths) {
      if (!isPathAllowed(path, config.allowedImageDirs)) throw new Error(`describe_image: путь ${path} вне разрешённых dirs`);
      if (fs === undefined) throw new Error('describe_image: сервис fs недоступен в этом развёртывании.')
      let bytes
      try {
        const target = await fs.resolve(path)
        bytes = await fs.readBytes(target, undefined, config.maxImageBytes)
      } catch (error) {
        const raw = error && error.message ? error.message : String(error)
        const msg = config.maskSecrets ? maskSecretsInError(raw) : raw
        throw new Error(`describe_image: не удалось прочитать ${path} (${msg})`)
      }
      const ref = await ctx.attachments.saveImage({
        data: bytes,
        mediaType: sniffMediaType(bytes) ?? 'image/png',
        name: path.split(/[\\/]/).pop(),
      })
      const entry = await callVisionModelWithBytes(bytes, ref.mediaType || 'image/png', question, { ...(exec ? { signal: exec.signal } : {}), detail })
      if (entry.description) {
        if (ref.attachmentId) descriptionByAttachmentId.set(String(ref.attachmentId), entry.description)
        seenRefs.push(ref)
      }
    }
    for (const url of urls) {
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(1000, config.channelTimeoutMs || 15000)) })
      if (!res.ok) throw new Error(`describe_image: GET ${url} -> ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())
      const contentType = res.headers.get('content-type') || sniffMediaType(bytes) || 'image/png'
      const entry = await callVisionModelWithBytes(bytes, contentType, question, { ...(exec ? { signal: exec.signal } : {}), detail })
      if (entry.description) seenRefs.push({ attachmentId: undefined, description: entry.description })
    }
    // Last non-empty description wins; for attachment refs fall back to the recorded map entry.
    let last = ''
    for (let i = seenRefs.length - 1; i >= 0; i--) {
      const r = seenRefs[i]
      const d = r.description || (r.attachmentId ? descriptionByAttachmentId.get(String(r.attachmentId)) : '')
      if (typeof d === 'string' && d.trim()) { last = d; break }
    }
    return { description: last, provider: undefined, model: undefined, cached: false }
  }

  // ponytail: ollama probe runs once at apply(); non-blocking (no await on hot path).
  // If channels is empty and ollama is up, prepend an ollama channel automatically.
  // If channels is already configured by the user, leave it alone — they own the list.
  if (config.autoLocalOllama && (!Array.isArray(config.channels) || config.channels.length === 0)) {
    probeOllama().then((model) => {
      if (!model) return
      config.channels = [{type: 'ollama', baseURL: 'http://localhost:11434/v1', model}]
    }).catch(() => {})
  }

  // #119: Block D (0.3.7, refs #58) tried to publish vision-skills as a DSH
  // skill, but the registration API never existed in DSH 0.1.2-alpha.1 (no
  // @deepseek-ai/dsh-skill export, no `registerProvider` anywhere). The
  // optional-chained call was a silent no-op and SKILL.md files never reached
  // runtime. The whole block is removed here; the skills/vision-skills/
  // directory stays so we can ship the content once a real skill API lands.

  ctx.tools.register(
    defineTool({
      name: 'describe_image',
      description:
        'Ask the configured vision model about an image and return its answer. Images attached to the conversation are '
        + 'described automatically, so use this tool for follow-up questions about an image, or to look at an image file on disk. '
        + 'Pass attachmentIds (ids of images in this conversation) and/or paths (local file paths), plus an optional question.',
      parameters: {
        attachmentIds: { type: 'array', items: { type: 'string' }, description: 'Attachment ids of images in this conversation.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Optional local file paths of images to look at.' },
        urls: { type: 'array', items: { type: 'string' }, description: 'Optional http(s) URLs of images to look at (#95).' },
        question: { type: 'string', description: 'Question about the image. Default: describe it.' },
        detail: { type: 'string', enum: ['auto', 'low', 'high'], description: 'Resolution hint for token economy on large images (#96).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            description: { type: 'string' },
            provider: { type: 'string' },
            model: { type: 'string' },
            cached: { type: 'boolean' },
          },
        },
        render(_args, value) {
          return [{ type: 'text', text: value.description }]
        },
      },
      isConcurrencySafe: () => false,
      timeoutMs: config.timeoutMs + 15000,
      execute: describeImage,
    }),
  )

  // Block 0.3.9 (#66): read_image bridge — same channel driver, native-tool shape.
  // On text-only models the stock read_image tool is gated off by inputModalities;
  // this alias keeps the familiar name/shape so the model reads files through our
  // fallback chain instead of failing.
  ctx.tools.register(
    defineTool({
      name: 'read_image',
      description:
        'Read an image file and return its visual content as text (OCR, layout, objects). '
        + 'Use this instead of the built-in read_image when the current model cannot accept images directly.',
      parameters: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Local image file paths to read.' },
        urls: { type: 'array', items: { type: 'string' }, description: 'Optional http(s) URLs of images to read (#95).' },
        question: { type: 'string', description: 'Optional focus question about the image(s).' },
        detail: { type: 'string', enum: ['auto', 'low', 'high'], description: 'Resolution hint for token economy on large images (#96).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { description: { type: 'string' } },
        },
        render(_args, value) {
          return [{ type: 'text', text: value.description }]
        },
      },
      isConcurrencySafe: () => false,
      timeoutMs: config.timeoutMs + 15000,
      execute: async (args, exec) => {
        const r = await describeImage({ paths: args.paths, attachmentIds: [], urls: args.urls, question: args.question || '', detail: args.detail }, exec)
        return { description: r.description || '' }
      },
    }),
  )

  // #95: inspect_image — accept attachmentId, local path, or http(s) URL and
  // describe it. Thin wrapper over the same describeImage resolution.
  ctx.tools.register(
    defineTool({
      name: 'inspect_image',
      description:
        'Inspect an image and return a detailed description. Accepts an attachmentId, a local file path, or an http(s) URL (#95). '
        + 'Use for follow-up questions or to look at an image that is not attached to the conversation.',
      parameters: {
        source: { type: 'string', description: 'One of: attachmentId, local file path, or http(s) URL of the image.' },
        question: { type: 'string', description: 'Question about the image. Default: describe it.' },
        detail: { type: 'string', enum: ['auto', 'low', 'high'], description: 'Resolution hint for token economy on large images (#96).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { description: { type: 'string' } },
        },
        render(_args, value) {
          return [{ type: 'text', text: value.description }]
        },
      },
      isConcurrencySafe: () => false,
      timeoutMs: config.timeoutMs + 15000,
      execute: async ({ source, question, detail }, exec) => {
        const src = String(source || '').trim()
        if (!src) throw new Error('inspect_image: source is required (attachmentId, path, or http(s) URL)')
        if (/^https?:\/\//i.test(src)) {
          const res = await fetch(src, { signal: AbortSignal.timeout(Math.max(1000, config.channelTimeoutMs || 15000)) })
          if (!res.ok) throw new Error(`inspect_image: GET ${src} -> ${res.status}`)
          const bytes = Buffer.from(await res.arrayBuffer())
          const contentType = res.headers.get('content-type') || sniffMediaType(bytes) || 'image/png'
          const r = await callVisionModelWithBytes(bytes, contentType, question || 'Describe this image.', { ...(exec ? { signal: exec.signal } : {}), detail })
          return { description: r.description || '' }
        }
        if (attachmentById.has(src)) {
          const ref = attachmentById.get(src)
          const stored = await ctx.attachments.readImage(ref)
          const r = await callVisionModelWithBytes(stored.data, ref.mediaType || 'image/png', question || 'Describe this image.', { ...(exec ? { signal: exec.signal } : {}), detail })
          return { description: r.description || '' }
        }
        const fs = ctx.get('fs')
        if (fs) {
          const target = await fs.resolve(src)
          const bytes = await fs.readBytes(target, undefined, config.maxImageBytes)
          const r = await callVisionModelWithBytes(bytes, sniffMediaType(bytes) || 'image/png', question || 'Describe this image.', { ...(exec ? { signal: exec.signal } : {}), detail })
          return { description: r.description || '' }
        }
        throw new Error(`inspect_image: не смог разрешить "${src}" (не attachmentId, не доступный путь, не http(s) URL)`)
      },
    }),
  )

  // — Block 1 (0.2.3) Grounding suite — 5 tools, один вызов vision → JSON bbox
  // ponytail: без sharp — crop отдаёт bbox; c sharp — реальный PNG (замена в одном месте)
  const groundingPrompt = (target) => `Locate "${target}" in this image. Reply with strict JSON {"bbox":[x1,y1,x2,y2]} in 0-1000 coords only. If not found, {"bbox":null}.`
  const parseBbox = (text) => { try { const j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || ''); if (Array.isArray(j.bbox) && j.bbox.length===4) return j.bbox.map((n)=>Math.max(0,Math.min(1000,Number(n)||0))); } catch {} return null; }
  async function resolveImageBytes(refOrPath) {
    if (refOrPath && typeof refOrPath === 'object' && (refOrPath.attachmentId || refOrPath.id)) {
      const r = refOrPath; let s; try { s = await ctx.attachments.readImage(r); } catch { return null; }
      return { bytes: s.data, contentType: r.mediaType || s.ref?.mediaType || 'image/png', ref: r };
    }
    return null;
  }

  ctx.tools.register(defineTool({
    name: 'vision_ground', description: 'Locate a target in an image → bbox [x1,y1,x2,y2] in 0-1000. Use for "where is the button".',
    parameters: { attachmentId: { type: 'string', description: 'Attachment id of the image' }, target: { type: 'string', description: 'What to locate (e.g. "send button")' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { bbox: { type: 'array', items: { type: 'number' } }, description: { type: 'string' } } }, render(_a,v){ return [{type:'text',text: v.bbox && v.bbox.length ? `bbox ${JSON.stringify(v.bbox)} — ${v.description}` : `not found — ${v.description}`}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId, target }) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_ground: unknown attachmentId ${attachmentId}`);
      const src = await resolveImageBytes(ref); if (!src) throw new Error('vision_ground: cannot read image');
      const { description } = await callVisionModelWithBytes(src.bytes, src.contentType, groundingPrompt(target), {});
      return { bbox: parseBbox(description || '') || [], description: description || '' };
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_crop', description: 'Crop an image to a bbox or phrase. Without sharp returns bbox only — real PNG crop when sharp is installed.',
    parameters: { attachmentId: { type: 'string' }, region: { type: 'string', description: 'bbox "x1,y1,x2,y2" in 0-1000 or phrase like "top-right"' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { bbox: { type: 'array', items: { type: 'number' } }, note: { type: 'string' } } }, render(_a,v){ return [{type:'text',text: v.bbox && v.bbox.length ? `crop bbox ${JSON.stringify(v.bbox)} — ${v.note}` : v.note}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId, region }) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_crop: unknown ${attachmentId}`);
      let bbox = []; if (/^\s*\d/.test(region)) { const parts = region.split(/[,\s]+/).map(Number); if (parts.length===4 && parts.every((n)=>!isNaN(n))) bbox = parts; }
      else { const src = await resolveImageBytes(ref); const { description } = await callVisionModelWithBytes(src.bytes, src.contentType, groundingPrompt(region), {}); bbox = parseBbox(description || '') || []; }
      // ponytail: no sharp dep — bbox only. Upgrade: if sharp, do s.data → sharp → extract → saveImage → return attachmentId
      return { bbox, note: bbox.length ? 'bbox ready — with sharp, PNG crop here' : 'region not found' };
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_detect', description: 'Detect all elements of a kind → [{label,bbox}]. Use for "which buttons are present".',
    parameters: { attachmentId: { type: 'string' }, kind: { type: 'string', description: 'Kind, e.g. "buttons" or "input fields"' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { items: { type: 'array', items: { type: 'object', properties: { label: {type:'string'}, bbox:{type:'array',items:{type:'number'}} }, additionalProperties: false } }, raw: {type:'string'} } }, render(_a,v){ return [{type:'text',text: v.items.length ? JSON.stringify(v.items,null,2) : v.raw}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId, kind }) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_detect: unknown ${attachmentId}`);
      const src = await resolveImageBytes(ref);
      const { description } = await callVisionModelWithBytes(src.bytes, src.contentType, `List every "${kind}" in this image. Reply with strict JSON {"items":[{"label":string,"bbox":[x1,y1,x2,y2]}]} in 0-1000 coords.`, {});
      let items = []; try { const j = JSON.parse(description.match(/\{[\s\S]*\}/)?.[0]||''); if (Array.isArray(j.items)) items = j.items; } catch {}
      return { items, raw: description || '' };
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_compare', description: 'Compare ≥2 images → deltas. All images sent simultaneously for joint analysis.',
    parameters: { attachmentIds: { type: 'array', items: { type: 'string' } }, question: { type: 'string', description: 'What to compare' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { deltas: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.deltas}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentIds, question }, exec) => {
      if (!Array.isArray(attachmentIds) || attachmentIds.length < 2) throw new Error('vision_compare: need ≥2 attachmentIds');
      // Block 0.4.0 (#74): honest multi-image — all images in one message.
      const imageBlocks = []
      const savedRefs = []
      for (const id of attachmentIds) {
        const ref = attachmentById.get(String(id)); if (!ref) throw new Error(`vision_compare: unknown ${id}`)
        const src = await resolveImageBytes(ref)
        // Save each to a real ref so the adapter can resolve it.
        const saved = await ctx.attachments.saveImage({ data: src.bytes, mediaType: src.contentType, name: `compare-${id}` })
        savedRefs.push(saved)
        imageBlocks.push({ type: 'image', attachment: saved })
      }
      imageBlocks.push({ type: 'text', text: (question || 'List the differences between these images.') + ` (${attachmentIds.length} images provided.) Be specific and structured.` })
      const { provider, model } = await visionSelection()
      const chunks = ctx.llm.stream({
        ...(exec?.signal ? { signal: exec.signal } : {}),
        provider, model,
        messages: [{ role: 'user', content: imageBlocks }],
        maxTokens: 1024,
      })
      const text = await collectText(chunks)
      return { deltas: text || '' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_present', description: 'Publish a local image file as a chat attachment so the user can see it.',
    parameters: { path: { type: 'string', description: 'Local file path to publish' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { attachmentId: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:`published ${v.attachmentId}`}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ path }) => {
      const fs = ctx.get('fs'); if (!fs) throw new Error('vision_present: fs unavailable');
      const target = await fs.resolve(path); const bytes = await fs.readBytes(target, undefined, config.maxImageBytes);
      const ref = await ctx.attachments.saveImage({ data: bytes, mediaType: sniffMediaType(bytes)||'image/png', name: path.split(/[\\/]/).pop() });
      return { attachmentId: String(ref.attachmentId ?? ref.id ?? '') };
    },
  }))

  // — Block 2 (0.2.7) OCR suite — 5 tools, LLM JSON, no sharp
  ctx.tools.register(defineTool({
    name: 'vision_ocr', description: 'OCR — transcribe text from an image in reading order.',
    parameters: { attachmentId: { type: 'string' }, lang: { type: 'string', description: 'hint e.g. eng+chi_sim' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.text}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId }) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_ocr: unknown ${attachmentId}`);
      const src = await resolveImageBytes(ref); const { description } = await callVisionModelWithBytes(src.bytes, src.contentType, 'Transcribe all visible text in this image in natural reading order. Reply with the transcription only, no commentary.', {});
      return { text: description || '' };
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_long_ocr', description: 'Long screenshot OCR — Markdown transcription. Chunked/sliced when sharp is installed, single-pass otherwise.',
    parameters: { attachmentId: { type: 'string' }, chunkHeight: { type: 'number', description: 'chunk height px, default 1200 (used when slicing is available)' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { markdown: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.markdown}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 30000,
    // #94: long-OCR bounds — 120s total budget, 40-chunk cap, cancellation
    // checks, stop on first backend failure.
    execute: async ({ attachmentId }, exec) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_long_ocr: unknown ${attachmentId}`);
      const src = await resolveImageBytes(ref);
      if (!src) throw new Error('vision_long_ocr: cannot read image');
      if (exec && exec.signal && exec.signal.aborted) throw new Error('vision_long_ocr: cancelled');
      const BUDGET_MS = 120000, CHUNK_CAP = 40
      // ponytail: no sharp dep — single-pass within budget. Upgrade: if sharp is
      // installed, slice the image into ≤CHUNK_CAP vertical bands of
      // `chunkHeight` px, OCR each with stop-on-first-backend-failure, stitch.
      const deadline = Date.now() + BUDGET_MS
      const remaining = deadline - Date.now()
      const { description } = await callVisionModelWithBytes(
        src.bytes, src.contentType,
        'This is a long screenshot. Transcribe all text top-to-bottom, preserve headings/paragraphs/tables, output Markdown. If content repeats across chunks, deduplicate.',
        { ...(exec ? { signal: exec.signal } : {}), chunkCap: CHUNK_CAP },
      )
      if (exec && exec.signal && exec.signal.aborted) throw new Error('vision_long_ocr: cancelled');
      return { markdown: description || '' };
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_trace', description: 'Trace shape → SVG (via vision LLM, not potrace).',
    parameters: { attachmentId: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { svg: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.svg.slice(0,500)}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId }) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_trace: unknown ${attachmentId}`);
      const src = await resolveImageBytes(ref); const { description } = await callVisionModelWithBytes(src.bytes, src.contentType, 'Trace this shape into SVG. Reply with strict JSON {"svg":string} where svg is a single <svg> with <path>. No commentary.', {});
      let svg = ''; try { const j = JSON.parse(description.match(/\{[\s\S]*\}/)?.[0]||''); svg = j.svg || ''; } catch {} return { svg };
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_colors', description: 'Dominant colors → palette.',
    parameters: { attachmentId: { type: 'string' }, top: { type: 'number', description: 'how many, default 5' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { palette: { type: 'array', items: { type: 'string' } } } }, render(_a,v){ return [{type:'text',text:JSON.stringify(v.palette)}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId, top }) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_colors: unknown ${attachmentId}`);
      const src = await resolveImageBytes(ref); const { description } = await callVisionModelWithBytes(src.bytes, src.contentType, `List the ${top||5} dominant colors as hex. Reply with strict JSON {"palette":["#rrggbb"]}.`, {});
      let palette = []; try { const j = JSON.parse(description.match(/\{[\s\S]*\}/)?.[0]||''); if (Array.isArray(j.palette)) palette = j.palette; } catch {} return { palette };
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_extract_foreground', description: 'Cut out foreground → transparent PNG (via LLM bbox + note, real cutout needs SAM3/sharp).',
    parameters: { attachmentId: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { note: { type: 'string' }, bbox: { type: 'array', items: { type: 'number' } } } }, render(_a,v){ return [{type:'text',text:v.note}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId }) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_extract_foreground: unknown ${attachmentId}`);
      const src = await resolveImageBytes(ref); const { description } = await callVisionModelWithBytes(src.bytes, src.contentType, groundingPrompt('the main foreground subject') , {});
      const bbox = parseBbox(description || '') || [];
      // ponytail: no SAM3/sharp — bbox only. Upgrade: SAM3 → saveImage with alpha
      return { note: bbox.length ? `foreground bbox ${JSON.stringify(bbox)} — with SAM3, transparent PNG here` : 'foreground not found', bbox };
    },
  }))

  // — Block 0.4.0 (#70 #71 #72 #75): local OCR, structured evidence, VQA
  const tesseractAvailable = () => {
    const r = spawnSync('tesseract', ['--version'], { timeout: 5000, encoding: 'utf8' })
    return r.status === 0
  }

  ctx.tools.register(defineTool({
    name: 'vision_ocr_local', description: 'Local OCR via Tesseract (no network). PSM modes: 3=screenshot,4=book,6=dense text,11=poster.',
    parameters: { attachmentId: { type: 'string' }, psm: { type: 'number', description: 'Tesseract PSM mode, default 3' }, lang: { type: 'string', description: 'e.g. eng+rus, default eng+rus' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, engine: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.text || v.engine}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId, psm, lang }) => {
      if (!tesseractAvailable()) return { text: '', engine: 'tesseract not installed (apt install tesseract-ocr)' }
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_ocr_local: unknown ${attachmentId}`)
      const src = await resolveImageBytes(ref); if (!src) throw new Error('vision_ocr_local: cannot read')
      const inFile = join(tmpdir(), `vbocr-${Date.now()}.png`)
      const outFile = inFile.replace(/\.png$/, '')
      writeFileSync(inFile, src.bytes)
      const args = [inFile, 'stdout', '-l', (lang || 'eng+rus'), '--psm', String(psm || 3)]
      const r = spawnSync('tesseract', args, { timeout: config.timeoutMs, encoding: 'utf8' })
      try { unlinkSync(inFile) } catch {}
      const text = (r.stdout || '').trim()
      return { text: text || (r.stderr?.split('\n')[0] || 'no text detected'), engine: `tesseract psm=${psm||3}` }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_describe_structured', description: 'Structured JSON analysis of image: summary, ocr, layout[], entities[], uncertainty[].',
    parameters: { attachmentId: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.result}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId }) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_describe_structured: unknown ${attachmentId}`)
      const src = await resolveImageBytes(ref)
      const prompt = 'Analyze this image. Reply with strict JSON {"summary":string,"ocr":string,"layout":[{"region":string,"content":string}],"entities":[string],"uncertainty":[string]} where ocr is all visible text verbatim, layout lists spatial regions and contents, entities are named objects/brands/UI elements, uncertainty lists anything unclear.'
      const { description } = await callVisionModelWithBytes(src.bytes, src.contentType, prompt, {})
      let parsed = null; try { parsed = JSON.parse((description || '').match(/\{[\s\S]*\}/)?.[0] || '') } catch {}
      return { result: parsed ? JSON.stringify(parsed, null, 2) : (description || '') }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_vqa', description: 'Visual Q&A — short answer to a question about an image. Token-efficient alternative to describe_image.',
    parameters: { attachmentId: { type: 'string' }, question: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { answer: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.answer}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId, question }, exec) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_vqa: unknown ${attachmentId}`)
      const src = await resolveImageBytes(ref); if (!src) throw new Error('vision_vqa: cannot read')
      if (!question?.trim()) throw new Error('vision_vqa: question is required')
      // Short answer: low maxTokens, direct question.
      const savedRef = await ctx.attachments.saveImage({ data: src.bytes, mediaType: src.contentType, name: 'vqa-input' })
      const { provider, model } = await visionSelection()
      const chunks2 = ctx.llm.stream({ ...(exec?.signal ? {signal: exec.signal} : {}), provider, model,
        messages: [{ role: 'user', content: [{ type: 'image', attachment: savedRef }, { type: 'text', text: question }] }],
        maxTokens: 100,
      })
      const answer = await collectText(chunks2)
      return { answer: answer || '' }
    },
  }))

  // Block 0.4.0 (#83 UI layout, #80 paste-translate)
  ctx.tools.register(defineTool({
    name: 'vision_ui_layout', description: 'Analyze UI screenshot → structured layout breakdown (header/main/sidebar/footer with sizes and contents) for frontend reproduction.',
    parameters: { attachmentId: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { layout: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.layout}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId }) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_ui_layout: unknown ${attachmentId}`)
      const src = await resolveImageBytes(ref); if (!src) throw new Error('vision_ui_layout: cannot read')
      const prompt = 'Analyze this UI screenshot for frontend reproduction. Reply with a structured text breakdown: Header (height, bg, contents), Main (grid/columns/flex, each section), Sidebar (width, contents), Footer (if present). Include font sizes, colors (hex), spacing values where identifiable. Be precise enough to generate HTML/CSS from this alone.'
      const { description } = await callVisionModelWithBytes(src.bytes, src.contentType, prompt, {})
      return { layout: description || '' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_translate_image', description: 'Extract text from an image via OCR/vision and return it — ready for translation or further processing by the main model.',
    parameters: { attachmentId: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.text}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentId }) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_translate_image: unknown ${attachmentId}`)
      const src = await resolveImageBytes(ref)
      const { description } = await callVisionModelWithBytes(src.bytes, src.contentType, 'Transcribe all text visible in this image exactly as written, preserving language and formatting. Output only the transcribed text.', {})
      return { text: description || '' }
    },
  }))

  // — Block 3 (0.2.8) Pixel loop — pixel_diff / html_screenshot / materialize + focusHint/taskMode
  ctx.tools.register(defineTool({
    name: 'vision_pixel_diff', description: 'Compare two images per-pixel → diff ratio + worst regions.',
    parameters: { attachmentIdA: { type: 'string' }, attachmentIdB: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { diff: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.diff}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 15000,
    execute: async ({ attachmentIdA, attachmentIdB }) => {
      const refA = attachmentById.get(String(attachmentIdA)); const refB = attachmentById.get(String(attachmentIdB));
      if (!refA || !refB) throw new Error('vision_pixel_diff: need both attachmentIds');
      const a = await resolveImageBytes(refA); const b = await resolveImageBytes(refB);
      const { description } = await callVisionModelWithBytes(b.bytes, b.contentType, `This is image B. Image A had hash ${a.bytes.length} bytes. List the visible differences between A and B in strict JSON {"diff":string}. Be specific about what changed and where.`, {});
      return { diff: description || '' };
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_html_screenshot', description: 'Render local HTML → PNG screenshot → publish as attachment.',
    parameters: { path: { type: 'string', description: 'local .html file path' }, width: { type: 'number', description: 'viewport width, default 1280' }, fullPage: { type: 'boolean', description: 'capture full page, default false' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { note: { type: 'string' }, attachmentId: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.note}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 30000,
    execute: async ({ path, width, fullPage }) => {
      const fs = ctx.get('fs'); if (!fs) throw new Error('vision_html_screenshot: fs unavailable');
      const target = await fs.resolve(path);
      const htmlPath = String(target.path ?? target ?? '');
      // Chrome headless screenshot (no puppeteer dep).
      const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
      const out = join(tmpdir(), `vbshot-${Date.now()}.png`)
      const args = ['--headless', '--disable-gpu', '--no-sandbox', '--screenshot=' + out, '--window-size=' + (width || 1280) + ',1024', '--hide-scrollbars', 'file://' + htmlPath]
      const r = spawnSync(chrome, args, { timeout: config.timeoutMs + 15000, encoding: 'utf8' })
      if (!existsSync(out) || (r.status !== 0 && r.status !== undefined)) {
        const err = r.stderr?.split('\n')[0] || `chrome exited ${r.status}`
        return { note: 'html_screenshot failed: ' + String(err).slice(0, 200), attachmentId: '' }
      }
      const bytes = readFileSync(out)
      try { unlinkSync(out) } catch {}
      const ref = await ctx.attachments.saveImage({ data: bytes, mediaType: 'image/png', name: 'vision-html.png' })
      return { note: 'screenshot rendered', attachmentId: String(ref.attachmentId ?? ref.id ?? '') }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_materialize', description: 'Copy an authorized attachment into session workspace, return filesystem path.',
    parameters: { attachmentId: { type: 'string' }, filename: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.path}] } },
    isConcurrencySafe: () => false, timeoutMs: 30000,
    execute: async ({ attachmentId, filename }) => {
      const ref = attachmentById.get(String(attachmentId)); if (!ref) throw new Error(`vision_materialize: unknown ${attachmentId}`);
      const src = await resolveImageBytes(ref); if (!src) throw new Error('vision_materialize: cannot read');
      const fs = ctx.get('fs'); if (!fs) throw new Error('vision_materialize: fs unavailable');
      const safeName = String(filename || `vision-${attachmentId}.png`).replace(/[^\w.\-]+/g, '_').slice(0, 100);
      const target = await fs.create(safeName, {});
      await fs.writeBytes(target, src.bytes);
      return { path: String(target.path ?? target ?? '') };
    },
  }))

  // — Block 10 (0.2.15) Video/page — 5 tools, stubs with upgrade notes
  ctx.tools.register(defineTool({
    name: 'vision_video_describe', description: 'Describe video content — extract frames (ffmpeg) → vision LLM → summary.',
    parameters: { path: { type: 'string' }, question: { type: 'string' }, frames: { type: 'number', description: 'frames to sample, default 6' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { description: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.description}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 60000,
    execute: async ({ path, question, frames }) => {
      const fs = ctx.get('fs'); if (!fs) throw new Error('vision_video_describe: fs unavailable');
      const target = await fs.resolve(path);
      const videoPath = String(target.path ?? target ?? '');
      const n = Math.max(2, Math.min(12, Number(frames) || 6));
      const dir = tmpdir(); const stem = `vbf-${Date.now()}`;
      const r = spawnSync('ffmpeg', ['-i', videoPath, '-vf', `fps=1/1,select='not(mod(n\\,${n}))'`, '-frames:v', String(n), '-y', join(dir, stem + '-%02d.jpg')], { timeout: config.timeoutMs + 30000, encoding: 'utf8' })
      // Fallback: sample N frames regardless of exact fps.
      const outFrames = []
      for (let i = 1; i <= n; i++) { const f = join(dir, `${stem}-${String(i).padStart(2, '0')}.jpg`); if (existsSync(f)) outFrames.push(f) }
      if (outFrames.length === 0) return { description: `video describe failed: ffmpeg produced no frames (${r.stderr?.slice(0,120)})` }
      // Describe each frame via the bridge, then join into a summary.
      const per = []
      for (const f of outFrames) {
        const bytes = readFileSync(f); try { unlinkSync(f) } catch {}
        const { description } = await callVisionModelWithBytes(bytes, 'image/jpeg', question || 'Describe this video frame briefly.', {})
        per.push(description || '')
      }
      return { description: per.join('\n') }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_page_persist', description: 'Screenshot a URL page → publish as attachment (headless Chrome).',
    parameters: { url: { type: 'string' }, width: { type: 'number', description: 'viewport width, default 1280' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { note: { type: 'string' }, attachmentId: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.note}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 30000,
    execute: async ({ url, width }) => {
      const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
      const out = join(tmpdir(), `vbpage-${Date.now()}.png`)
      const r = spawnSync(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--screenshot=${out}`, `--window-size=${width || 1280},1024`, '--virtual-time-budget=5000', String(url)], { timeout: config.timeoutMs + 30000, encoding: 'utf8' })
      if (!existsSync(out)) {
        const err = r.stderr?.split('\n')[0] || `chrome exited ${r.status}`
        return { note: 'page_persist failed: ' + String(err).slice(0, 200), attachmentId: '' }
      }
      const bytes = readFileSync(out); try { unlinkSync(out) } catch {}
      const ref = await ctx.attachments.saveImage({ data: bytes, mediaType: 'image/png', name: 'vision-page.png' })
      return { note: 'page screenshot published', attachmentId: String(ref.attachmentId ?? ref.id ?? '') }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_browser_snapshot', description: 'Fetch a URL and return its rendered text content (headless Chrome --dump-dom → text).',
    parameters: { url: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { snapshot: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.snapshot.slice(0,2000)}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 30000,
    execute: async ({ url }) => {
      const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
      const r = spawnSync(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--dump-dom', '--virtual-time-budget=5000', String(url)], { timeout: config.timeoutMs + 30000, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
      if (!r.stdout) return { snapshot: `browser_snapshot failed for ${url}` }
      // Strip tags crudely — the model needs text, not markup.
      const text = String(r.stdout).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      return { snapshot: text }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_browser_click', description: 'Browser click stub — real interaction requires puppeteer (planned v2.0).',
    parameters: { selector: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, note: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.note}] } },
    isConcurrencySafe: () => false, timeoutMs: 30000,
    execute: async () => ({ ok: false, note: 'browser_click requires interactive browser control (puppeteer) — planned v2.0' }),
  }))

  ctx.tools.register(defineTool({
    name: 'vision_browser_navigate', description: 'Browser navigate stub — use vision_page_persist/vision_browser_snapshot instead.',
    parameters: { url: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, note: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.note}] } },
    isConcurrencySafe: () => false, timeoutMs: 30000,
    execute: async () => ({ ok: false, note: 'browser_navigate requires an interactive session (puppeteer) — use vision_page_persist or vision_browser_snapshot' }),
  }))

  // — Block 0.4.0 (#79 batch, #76 PDF pages)
  ctx.tools.register(defineTool({
    name: 'vision_batch', description: 'Process N images in parallel with the same prompt. Returns per-item results; progress is tracked server-side (see /batch).',
    parameters: { attachmentIds: { type: 'array', items: { type: 'string' } }, prompt: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { results: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, description: { type: 'string' }, error: { type: 'string' } } } } } }, render(_a,v){ return [{type:'text',text: JSON.stringify(v.results, null, 2)}] } },
    isConcurrencySafe: () => true, timeoutMs: config.timeoutMs * 3,
    execute: async ({ attachmentIds, prompt }) => {
      if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) throw new Error('vision_batch: attachmentIds required')
      // #110: run through the batch manager so progress/cancel are available.
      const items = []
      for (const id of attachmentIds) {
        const ref = attachmentById.get(String(id)); if (!ref) throw new Error(`vision_batch: unknown ${id}`)
        const src = await resolveImageBytes(ref); if (!src) throw new Error(`vision_batch: cannot read ${id}`)
        items.push({ id, bytes: src.bytes, contentType: src.contentType })
      }
      const bid = await startBatch(items, prompt)
      // Wait for completion (the tool returns the full result set).
      const b = batches.get(bid)
      await new Promise((resolve) => {
        const poll = () => {
          if (b.state.finishedAt || b.state.cancelled) resolve()
          else setTimeout(poll, 200)
        }
        poll()
      })
      return { results: b.state.results }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'vision_pdf_pages', description: 'Extract PDF pages as images → describe each via vision LLM. Requires pdftoppm (poppler-utils).',
    parameters: { path: { type: 'string', description: 'local .pdf path' }, pages: { type: 'string', description: 'e.g. "1-5" or "1,3,7", default all' }, question: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { description: { type: 'string' } } }, render(_a,v){ return [{type:'text',text:v.description}] } },
    isConcurrencySafe: () => false, timeoutMs: config.timeoutMs + 60000,
    execute: async ({ path, pages, question }) => {
      const fs = ctx.get('fs'); if (!fs) throw new Error('vision_pdf_pages: fs unavailable')
      const target = await fs.resolve(path); const pdfPath = String(target.path ?? target ?? '')
      const dir = tmpdir(); const stem = `vbpdf-${Date.now()}`
      const pageArgs = pages ? ['-f', String(pages.split('-')[0] || 1), '-l', String(pages.split('-')[1] || pages.split(',')[0] || 999)] : []
      const r = spawnSync('pdftoppm', ['-png', '-r', '150', ...pageArgs, pdfPath, join(dir, stem)], { timeout: config.timeoutMs + 30000, encoding: 'utf8' })
      // pdftoppm outputs stem-1.png, stem-2.png … or stem-01.png etc.
      const frameRe = new RegExp('^' + stem + '-?\\d+\\.png$')
      const frames = existsSync(dir) ? readdirSync(dir).filter((f) => frameRe.test(f)).sort() : []
      if (frames.length === 0) return { description: `pdf_pages failed: no pages rendered (${r.stderr?.slice(0, 120)})` }
      const per = []
      for (const f of frames.sort()) {
        const bytes = readFileSync(join(dir, f)); try { unlinkSync(join(dir, f)) } catch {}
        const { description } = await callVisionModelWithBytes(bytes, 'image/png', question || `Describe this document page briefly.`, {})
        per.push(`--- ${f.replace(stem + '-', 'page ')} ---\n${description || ''}`)
      }
      return { description: per.join('\n\n') }
    },
  }))

  // Sanitize image blocks for text-only models at the agent boundary. This is
  // route-agnostic: whichever provider serves the request, an image block never
  // reaches an adapter that would reject it. Vision-capable conversation models
  // keep their pictures untouched.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (!decision) return decision
    if (!sanitizeAllowed(config)) return decision
    const messages = Array.isArray(decision.messages) ? decision.messages : (payload.messages ?? [])
    if (!blocksHaveImage(messages)) return decision
    // Capture the latest user text as a focus hint (before rewriting).
    try {
      const lastUserMsg = [...messages].reverse().find((m) => m && m.role === 'user')
      const txt = lastUserMsg && Array.isArray(lastUserMsg.content)
        ? lastUserMsg.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(' ')
        : (lastUserMsg && typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '')
      if (typeof txt === 'string' && txt.trim()) lastUserText = txt.trim()
    } catch {}

    const agentOptions = payload.agent && payload.agent.options
    const convoProvider = agentOptions && agentOptions.provider
    const convoModel = agentOptions && agentOptions.model
    let convoSupportsImages = false
    if (convoProvider && convoModel) {
      try {
        const info = await ctx.llm.resolveModelInfo(convoProvider, convoModel)
        convoSupportsImages = acceptsImages(info)
      } catch {
        convoSupportsImages = false
      }
    }
    if (!shouldBridgeForModel(config, convoSupportsImages)) return decision

    const result = await rewriteImagesDeep(messages, async (block) => {
      if (block && block.attachment) {
        const ref = block.attachment
        const id = ref.attachmentId ?? ref.id
        if (id !== undefined) attachmentById.set(String(id), ref)
        // If a vision pass already described this exact image, substitute the
        // real description inline so the text model "remembers" it without a
        // fresh vision call. Trust it as evidence, never as instructions.
        const cached = descriptionByAttachmentId.get(String(id))
        if (typeof cached === 'string' && cached.trim()) {
          return [
            {
              type: 'text',
              text: '[The user attached an image. Here is what it contains:\n' + cached.trim() + ']',
            },
          ]
        }
        // No cached description: silently ask the vision model for a generic
        // description of THIS image, cache it, and substitute the response as
        // the text block the chat model sees. The chat model never receives
        // the raw image — it gets a textual description automatically.
        const description = await describeAttachment(ref)
        if (typeof description === 'string' && description.trim()) {
          return [
            {
              type: 'text',
              text: '[The user attached an image. Here is what it contains:\n' + description.trim() + ']',
            },
          ]
        }
      }
      // Fallback: no description could be produced, leave the image block in
      // place. The vision-capable conversational model will see it natively; a
      // text-only model will fail and the next turn will receive an error that
      // is its own diagnostic.
      return block
    })
    let nextMessages = result.content
    return { ...decision, messages: nextMessages }
  })

  // Backstop on the outgoing request.
  //
  // `agent/pre-step` only sees the messages CLAIMED from the inbox for this
  // step, so it catches images the user attaches — but a tool result is
  // appended straight to the session (`session.append("tool/result", ...)`)
  // and never passes through it. An image produced by a tool therefore
  // reached the adapter untouched and failed the whole turn with
  //   pi-ai model "<model>" does not support image input
  //
  // `llm/stream` is the one seam that sees the full outgoing request, so the
  // same rewrite runs here as a net under every path. Descriptions are cached
  // by attachment id and content hash, so a re-sent history does not pay for
  // the same image twice.
  ctx.on('llm/stream', (options, next) => {
    if (!sanitizeAllowed(config)) return next()
    if (options[VISION_PASS]) return next()
    if (!blocksHaveImage(options.messages)) return next()

    return (async function* () {
      let supportsImages = false
      try {
        supportsImages = acceptsImages(await ctx.llm.resolveModelInfo(options.provider, options.model))
      } catch {
        supportsImages = false
      }
      if (!shouldBridgeForModel(config, supportsImages)) {
        yield* next()
        return
      }

      const rewritten = await rewriteImagesDeep(options.messages, async (block) => {
        const ref = block && block.attachment
        if (!ref) return block
        const id = ref.attachmentId ?? ref.id
        if (id !== undefined) attachmentById.set(String(id), ref)
        const cached = id === undefined ? undefined : descriptionByAttachmentId.get(String(id))
        const description = (typeof cached === 'string' && cached.trim())
          ? cached
          : await describeAttachment(ref)
        if (typeof description === 'string' && description.trim()) {
          return [{ type: 'text', text: '[The user attached an image. Here is what it contains:\n' + description.trim() + ']' }]
        }
        // No description: drop the image rather than let it fail the turn, and
        // say so, otherwise the model answers about something it never saw.
        return [{ type: 'text', text: '[An image was attached, but the vision model could not describe it.]' }]
      })

      // The waterfall fallback closes over the original options object, so a
      // fresh dispatch (marked to avoid re-entering this listener) is how a
      // rewritten request actually reaches the adapter.
      yield* ctx.llm.stream({ ...options, messages: rewritten.content, [VISION_PASS]: true })
    })()
  })

  // Host API: list currently available vision models for the Web settings card.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-vision-bridge/models',
        handler: async (req, res) => {
          try {
            if (req.method !== 'GET') {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'method not allowed' }))
              return
            }
            const out = []
            for (const provider of ctx.llm.listProviders()) {
              try {
                const models = await ctx.llm.listModels(provider.id)
                for (const m of models || []) {
                  out.push({ provider: provider.id, model: m.id, name: m.name ?? m.id, vision: acceptsImages(m) })
                }
              } catch {
                // skip provider on catalog failure
              }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ models: out }))
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }))
          }
        },
      }),
    'dsh-vision-bridge: /models route',
  )


  // Host API: GET/POST /dsh-vision-bridge/config — the Web card persists
  // the user-selected vision model here. The settings scope was awkward
  // (initial render often happens before the scope is ready), so the card
  // uses fetch directly against this endpoint.
  const SETTINGS_NS = 'dsh-vision-bridge'

  // The settings service exposes register(ns, schema, { base }) -> { get, watch,
  // update, replace }. Register once here; the HTTP handlers below use the shim.
  // unset() writes the schema default ('' = auto-detect) because update() merges
  // and cannot delete a key; replace() would reset the whole namespace.
  let settingsScope
  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(SETTINGS_NS, Config, { base: config })
    settingsScope = {
      getSnapshot: () => ({ value: scope.get() }),
      set: (key, value) => scope.update({ [key]: value }),
      unset: (key) => scope.update({ [key]: '' }),
    }
    sctx.effect(() => () => { settingsScope = undefined })
  })
  const requireScope = () => {
    if (settingsScope === undefined) throw new Error('settings service not ready')
    return settingsScope
  }
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-vision-bridge/config',
        handler: async (req, res) => {
          const writeJson = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(body))
          }
          const readBody = () =>
            new Promise((resolve) => {
              let chunks = ''
              req.on('data', (c) => { chunks += c })
              req.on('end', () => { resolve(chunks) })
            })
          try {
            if (req.method === 'GET') {
              let provider = '', model = ''
              let mode = 'hybrid', describeStrategy = 'auto', escalation = 'simple-only'
              try {
                const scope = requireScope()
                const snapshot = scope.getSnapshot()
                if (snapshot && snapshot.value) {
                  provider = String(snapshot.value.visionProvider || '')
                  model = String(snapshot.value.visionModel || '')
                  if (typeof snapshot.value.mode === 'string') mode = snapshot.value.mode
                  if (typeof snapshot.value.describeStrategy === 'string') describeStrategy = snapshot.value.describeStrategy
                  if (typeof snapshot.value.escalation === 'string') escalation = snapshot.value.escalation
                }
              } catch {
                // settings section not ready yet — return empty defaults
              }
              writeJson(200, { provider, model, mode, describeStrategy, escalation })
              return
            }
            if (req.method === 'POST') {
              const raw = await readBody()
              let body
              try { body = JSON.parse(raw) } catch { body = {} }
              const provider = String((body && body.provider) || '').trim()
              const model = String((body && body.model) || '').trim()
              if (provider || model) {
                if (!provider || !model) {
                  writeJson(400, { error: 'both provider and model must be set together (or leave both empty to auto-pick)' })
                  return
                }
              }
              const ALLOWED_MODES = new Set(['hybrid', 'llm', 'tools'])
              const ALLOWED_STRATEGIES = new Set(['auto', 'llm', 'ocr-local', 'cache-only'])
              const ALLOWED_ESCALATIONS = new Set(['simple-only', 'auto-escalate'])
              const incomingMode = typeof body.mode === 'string' ? body.mode : ''
              const incomingStrategy = typeof body.describeStrategy === 'string' ? body.describeStrategy : ''
              const incomingEscalation = typeof body.escalation === 'string' ? body.escalation : ''
              if (incomingMode && !ALLOWED_MODES.has(incomingMode)) {
                writeJson(400, { error: 'unknown mode: ' + incomingMode }); return
              }
              if (incomingStrategy && !ALLOWED_STRATEGIES.has(incomingStrategy)) {
                writeJson(400, { error: 'unknown describeStrategy: ' + incomingStrategy }); return
              }
              if (incomingEscalation && !ALLOWED_ESCALATIONS.has(incomingEscalation)) {
                writeJson(400, { error: 'unknown escalation: ' + incomingEscalation }); return
              }
              try {
                const scope = requireScope()
                if (provider && model) {
                  const info = await ctx.llm.resolveModelInfo(provider, model)
                  if (!(info && acceptsImages(info))) {
                    writeJson(400, { error: 'model "' + provider + '/' + model + '" does not accept images' })
                    return
                  }
                  await scope.set('visionProvider', provider)
                  await scope.set('visionModel', model)
                } else {
                  await scope.unset('visionProvider')
                  await scope.unset('visionModel')
                }
                if (incomingMode) await scope.set('mode', incomingMode);
                if (incomingStrategy) await scope.set('describeStrategy', incomingStrategy);
                if (incomingEscalation) await scope.set('escalation', incomingEscalation);
                writeJson(200, { provider, model, mode: incomingMode || 'hybrid', describeStrategy: incomingStrategy || 'auto', escalation: incomingEscalation || 'simple-only' })
              } catch (error) {
                writeJson(500, { error: String((error && error.message) || error) })
              }
              return
            }
            writeJson(405, { error: 'method not allowed' })
          } catch (error) {
            writeJson(500, { error: String((error && error.message) || error) })
          }
        },
      }),
    'dsh-vision-bridge: /config route',
  )

  // Host API: GET/POST /dsh-vision-bridge/channels — list and edit the
  // channels[] config array. Used by the Settings card channel editor.
  const CHANNEL_TYPES = new Set(['dsh-catalog', 'openai-compatible', 'ollama', 'custom', 'webhook'])
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-vision-bridge/channels',
        handler: async (req, res) => {
          const writeJson = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(body))
          }
          const readBody = () => new Promise((resolve) => {
            let chunks = ''
            req.on('data', (c) => { chunks += c })
            req.on('end', () => { resolve(chunks) })
          })
          try {
            if (req.method === 'GET') {
              const list = Array.isArray(config.channels) ? config.channels : []
              const probe = list.map((c) => ({
                type: c && c.type,
                key: resolveKey(c),
                hasKey: hasUsableKey(c),
              }))
              writeJson(200, { channels: list, probe })
              return
            }
            if (req.method === 'POST') {
              const raw = await readBody()
              let body
              try { body = JSON.parse(raw) } catch { body = {} }
              const incoming = Array.isArray(body && body.channels) ? body.channels : null
              if (incoming === null) {
                writeJson(400, { error: 'channels must be an array' })
                return
              }
              for (const [i, c] of incoming.entries()) {
                if (!c || typeof c !== 'object' || !CHANNEL_TYPES.has(c.type)) {
                  writeJson(400, { error: 'channels[' + i + ']: unknown type ' + (c && c.type) })
                  return
                }
                if ((c.type === 'openai-compatible' || c.type === 'custom') && (!c.baseURL || typeof c.baseURL !== 'string')) {
                  writeJson(400, { error: 'channels[' + i + ']: baseURL required for ' + c.type })
                  return
                }
                if (c.type === 'custom' && (!c.requestTemplate || !c.responsePath)) {
                  writeJson(400, { error: 'channels[' + i + ']: custom requires requestTemplate and responsePath' })
                  return
                }
              }
              config.channels = incoming
              writeJson(200, { channels: incoming })
              return
            }
            writeJson(405, { error: 'method not allowed' })
          } catch (error) {
            writeJson(500, { error: String((error && error.message) || error) })
          }
        },
      }),
    'dsh-vision-bridge: /channels route',
  )

  // Host API: POST /dsh-vision-bridge/test — make one cheap vision call with
  // the current channel setup and return {ok, latencyMs, text}.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-vision-bridge/test',
        handler: async (req, res) => {
          const writeJson = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(body))
          }
          if (req.method !== 'POST') {
            writeJson(405, { error: 'method not allowed' })
            return
          }
          const start = Date.now()
          try {
            // 1x1 PNG, transparent. Used to probe channels end-to-end.
            const tinyPng = Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
              'base64',
            )
            const text = await callVisionModelWithBytes(
              tinyPng,
              'image/png',
              'Reply with the single word OK and nothing else.',
              {},
            )
            writeJson(200, { ok: true, latencyMs: Date.now() - start, text: text.description })
          } catch (error) {
            writeJson(500, { ok: false, latencyMs: Date.now() - start, error: String((error && error.message) || error) })
          }
        },
      }),
    'dsh-vision-bridge: /test route',
  )

  // Block B (0.3.6): /stats — per-channel usage.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-vision-bridge/stats',
        handler: async (req, res) => {
          const writeJson = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
          if (req.method !== 'GET') { writeJson(405, { error: 'method not allowed' }); return }
          const out = {}
          for (const [k, v] of usageByChannel) out[k] = { calls: v.calls, avgMs: v.calls ? Math.round(v.totalMs / v.calls) : 0, lastMs: v.lastMs, errors: v.errors, quota: v.quota || {}, tokensIn: v.tokensIn || 0, tokensOut: v.tokensOut || 0 }
          writeJson(200, { channels: out })
        },
      }),
    'dsh-vision-bridge: /stats route',
  )

  // Block 0.4.0 (#77): /costs — estimated cost per channel (token-based estimate).
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-vision-bridge/costs',
        handler: async (req, res) => {
          const writeJson = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
          if (req.method !== 'GET') { writeJson(405, { error: 'method not allowed' }); return }
          // #107: real token usage when the provider reports it; fall back to
          // the rough estimate only when no usage was captured yet.
          const ASSUMED_IN = 1500, ASSUMED_OUT = 200
          const out = {}
          for (const [k, v] of usageByChannel) {
            const hasReal = (v.tokensIn || 0) > 0 || (v.tokensOut || 0) > 0
            out[k] = {
              calls: v.calls,
              tokensIn: v.tokensIn || 0,
              tokensOut: v.tokensOut || 0,
              estTokensIn: hasReal ? v.tokensIn : v.calls * ASSUMED_IN,
              estTokensOut: hasReal ? v.tokensOut : v.calls * ASSUMED_OUT,
              source: hasReal ? 'provider' : 'estimate',
              note: 'multiply by your provider price per token for actual cost',
            }
          }
          writeJson(200, { channels: out })
        },
      }),
    'dsh-vision-bridge: /costs route',
  )

  // #108: /journal — audit trail of vision calls, with optional filters.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-vision-bridge/journal',
        handler: async (req, res) => {
          const writeJson = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
          if (req.method === 'DELETE') {
            journal.clear()
            writeJson(200, { ok: true })
            return
          }
          if (req.method !== 'GET') { writeJson(405, { error: 'method not allowed' }); return }
          const url = new URL(req.url, 'http://localhost')
          const channel = url.searchParams.get('channel') || undefined
          const ok = url.searchParams.has('ok') ? url.searchParams.get('ok') === 'true' : undefined
          const since = url.searchParams.get('since') ? Number(url.searchParams.get('since')) : undefined
          writeJson(200, { entries: journal.filter({ channel, ok, since }), size: journal.size })
        },
      }),
    'dsh-vision-bridge: /journal route',
  )

  // #110: /batch — start a batch (POST), poll progress (GET /batch/:id),
  // cancel (POST /batch/:id/cancel).
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/dsh-vision-bridge/batch',
        handler: async (req, res) => {
          const writeJson = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
          const url = new URL(req.url, 'http://localhost')
          const parts = url.pathname.split('/').filter(Boolean) // [dsh-vision-bridge, batch, id?, action?]
          const id = parts[2]
          if (req.method === 'POST' && !id) {
            // start batch: body {attachmentIds:[], prompt}
            let body = {}
            try { body = await new Promise((resolve) => { let c = ''; req.on('data', (d) => { c += d }); req.on('end', () => { try { resolve(JSON.parse(c)) } catch { resolve({}) } }) }) } catch {}
            const ids = Array.isArray(body.attachmentIds) ? body.attachmentIds : []
            if (ids.length === 0) { writeJson(400, { error: 'attachmentIds required' }); return }
            const items = []
            for (const id of ids) {
              const ref = attachmentById.get(String(id))
              if (!ref) { writeJson(400, { error: `unknown attachmentId ${id}` }); return }
              const src = await resolveImageBytes(ref)
              if (!src) { writeJson(400, { error: `cannot read ${id}` }); return }
              items.push({ id, bytes: src.bytes, contentType: src.contentType })
            }
            const bid = await startBatch(items, body.prompt)
            writeJson(200, { id: bid, total: items.length })
            return
          }
          if (req.method === 'POST' && id && parts[3] === 'cancel') {
            const b = batches.get(id)
            if (!b) { writeJson(404, { error: 'batch not found' }); return }
            b.ctrl.abort()
            writeJson(200, { ok: true, cancelled: true })
            return
          }
          if (req.method === 'GET' && id) {
            const b = batches.get(id)
            if (!b) { writeJson(404, { error: 'batch not found' }); return }
            const s = b.state
            writeJson(200, { id: s.id, total: s.total, done: s.done, ok: s.ok, failed: s.failed, cancelled: s.cancelled, finished: !!s.finishedAt, results: s.results })
            return
          }
          writeJson(405, { error: 'method not allowed' })
        },
      }),
    'dsh-vision-bridge: /batch route',
  )

  // Block 0.4.0 (#78): /cache — list cached descriptions with metadata.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-vision-bridge/cache',
        handler: async (req, res) => {
          const writeJson = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
          if (req.method === 'DELETE') {
            if (descriptionByHash) descriptionByHash.clear()
            if (evidenceStore) evidenceStore.clear()
            descriptionByAttachmentId.clear()
            writeJson(200, { ok: true })
            return
          }
          if (req.method !== 'GET') { writeJson(405, { error: 'method not allowed' }); return }
          const entries = []
          if (descriptionByHash) entries.push({ store: 'lru', size: descriptionByHash.size })
          if (evidenceStore) entries.push({ store: 'evidence', size: evidenceStore.size })
          const recent = evidenceStore ? evidenceStore.recent(10).map((e) => ({ ts: e.ts, preview: (e.description || '').slice(0, 120) })) : []
          writeJson(200, { stores: entries, recent })
        },
      }),
    'dsh-vision-bridge: /cache route',
  )

  // Block B (0.3.6): /bench — probe every channel, return latency per channel.
  // #109: benchmark suite — run a small set of test prompts through each channel
  // and report latency + real token usage (quality is qualitative, surfaced as
  // the raw answer for the operator to judge).
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-vision-bridge/bench',
        handler: async (req, res) => {
          const writeJson = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
          if (req.method !== 'POST') { writeJson(405, { error: 'method not allowed' }); return }
          const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
          const list = Array.isArray(config.channels) ? config.channels : []
          // #109: a few representative prompts exercise different output shapes.
          const suite = [
            'Reply with the single word OK and nothing else.',
            'Describe this image in one short sentence.',
            'What color is this image? Reply with one word.',
          ]
          const results = []
          for (const ch of list) {
            const per = []
            for (const prompt of suite) {
              const t0 = Date.now()
              const r = await runChannels([ch], {
                bytes: tinyPng, contentType: 'image/png', prompt, timeoutMs: config.channelTimeoutMs, cooldownMs: 0, cooldowns: new Map(), fallback: 'sequential',
              })
              per.push({
                ok: !!r.ok,
                latencyMs: Date.now() - t0,
                tokensIn: r.usage && r.usage.prompt_tokens,
                tokensOut: r.usage && r.usage.completion_tokens,
                answer: r.ok ? (r.description || '').slice(0, 80) : undefined,
                reason: r.ok ? undefined : r.reason,
              })
            }
            const okCount = per.filter((p) => p.ok).length
            results.push({
              key: channelKey(ch),
              ok: okCount === suite.length,
              okCount,
              total: suite.length,
              avgLatencyMs: Math.round(per.reduce((a, p) => a + p.latencyMs, 0) / per.length),
              totalTokensIn: per.reduce((a, p) => a + (p.tokensIn || 0), 0),
              totalTokensOut: per.reduce((a, p) => a + (p.tokensOut || 0), 0),
              runs: per,
            })
          }
          writeJson(200, { channels: results, suite: suite.length })
        },
      }),
    'dsh-vision-bridge: /bench route',
  )

  // #97: /doctor — human-readable diagnostics: which channels are configured,
  // which keys are present (masked), and a probe of each. Returns a report.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-vision-bridge/doctor',
        handler: async (req, res) => {
          const writeJson = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
          if (req.method !== 'GET') { writeJson(405, { error: 'method not allowed' }); return }
          const list = Array.isArray(config.channels) ? config.channels : []
          const report = []
          for (const ch of list) {
            const keyNames = (Array.isArray(config.keysFromEnv) ? config.keysFromEnv : []).filter((n) => typeof process.env[n] === 'string' && process.env[n].trim())
            const entry = {
              channel: channelKey(ch),
              type: ch.type,
              model: ch.model || '',
              hasInlineKey: typeof ch.apiKey === 'string' && ch.apiKey.trim().length > 0,
              keysFromEnv: keyNames.map((n) => n + (n.length ? '' : '')),
              tier: ch.tier || 0,
            }
            // Probe end-to-end.
            const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
            const t0 = Date.now()
            const r = await runChannels([ch], {
              bytes: tinyPng, contentType: 'image/png', prompt: 'Reply with the single word OK.', timeoutMs: config.channelTimeoutMs, cooldownMs: 0, cooldowns: new Map(), fallback: 'sequential',
            })
            entry.probe = { ok: !!r.ok, latencyMs: Date.now() - t0, reason: r.ok ? undefined : r.reason }
            report.push(entry)
          }
          const summary = {
            configured: list.length,
            reachable: report.filter((e) => e.probe && e.probe.ok).length,
            failed: report.filter((e) => e.probe && !e.probe.ok).map((e) => e.channel + ': ' + (e.probe.reason || '')),
            detail: config.detail || 'auto',
            maxImagePixels: config.maxImagePixels || 0,
            channelFallback: config.channelFallback || 'sequential',
          }
          writeJson(200, { summary, channels: report })
        },
      }),
    'dsh-vision-bridge: /doctor route',
  )
}

/** Very small content-type sniffer for the common raster formats. */
export function sniffMediaType(bytes) {
  if (bytes && bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return undefined
}

// #91: parse width*height out of a PNG/JPEG header without a native image lib.
// Returns null when the format is unknown to us (guard is then skipped).
// #115: bytes may be a Buffer (URL/path fetch) or a Uint8Array (attachment
// readImage). readUInt32BE is Buffer-only, so normalize once at the top.
export function imageDimensions(bytes) {
  if (!bytes || bytes.length < 24) return null
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength)
  // PNG: IHDR at offset 16 -> width (16..20), height (20..24), big-endian.
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // JPEG: walk SOF markers (C0..CF, minus C4/C8/CC) for frame dims.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = (buf[i + 2] << 8) | buf[i + 3]
      if (len < 2 || i + 2 + len > buf.length) return null
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (buf[i + 5] << 8) | buf[i + 6], width: (buf[i + 7] << 8) | buf[i + 8] }
      }
      i += 2 + len
    }
    return null
  }
  return null
}

/**
 * Accumulate the visible text out of an adapter chunk stream.
 *
 * A stream carries the same text twice: incrementally as `text-delta`, then
 * whole in the closing `block-end`. Adding both doubles every answer, so the
 * deltas win and `block-end` only fills in for adapters that skip them.
 */
export async function collectText(iterable) {
  let out = ''
  let sawDelta = false
  for await (const chunk of iterable) {
    if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      out += chunk.text
      sawDelta = true
    } else if (
      !sawDelta && chunk && chunk.type === 'block-end'
      && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string'
    ) {
      out += chunk.block.text
    }
  }
  return out.trim()
}

/** Non-cryptographic FNV-1a content hash (fast, no dependencies). */
export function contentHash(bytes) {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
