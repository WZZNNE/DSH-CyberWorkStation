/**
 * dsh-media-lab host plugin — extra media APIs for the harness: image generation, video
 * generation, text-to-speech and transcription, each configured once in dsh Settings and exposed
 * to the model as a tool.
 *
 * The wire shapes live in `adapters.js` (pure, documented, tested offline); this file owns the
 * side effects: the hot-reloaded config file, credential lookups, saving results under
 * `$DSH_HOME/media`, serving them back to the web UI, and the tool definitions.
 *
 * Because the core has no image content block (see the drop-image-content-block Agent Note), a
 * finished file is announced in the tool result as a `[[dsh-media:<id>]]` marker plus its path;
 * the browser half swaps the marker for a real <img>/<video>/<audio> element pointing at
 * `/dsh-media-lab/file/<id>`.
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, watchFile, unwatchFile, writeFileSync, createReadStream } from 'node:fs'
import { pipeline } from 'node:stream'
import { extname, join, isAbsolute, resolve as resolvePath } from 'node:path'
import { randomBytes } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { IMAGE_RESOLUTION_TIERS, KINDS, adapterFor, extFor, runTask } from './adapters.js'
import { DEFAULT_CONFIG, KEY_ENVS, describeProviders, keyEnvFor, normalizeConfig, validateConfig } from './config.js'
import { scoutModels } from './model-scout.js'

export const name = 'media-lab'
export const inject = ['tools', 'systemPrompt', 'webServer']

const DSH_HOME = resolveDshHome()
const CONFIG_FILE = join(DSH_HOME, 'media-lab.json')
const MEDIA_DIR = join(DSH_HOME, 'media')
const MAX_BODY = 256 * 1024
// /generate alone: room for reference images, which ride in the body as data: URLs. One reference
// may not be the whole body — the tier a pet's canon drawing needs is ~1.5 MB at 1024².
const GENERATE_MAX_BODY = 6 * 1024 * 1024
const REFERENCE_MAX_CHARS = 4 * 1024 * 1024
const RESOLUTION_TIERS = new Set(IMAGE_RESOLUTION_TIERS)
const ID = /^[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{6}$/
const KIND_PREFIX = { image: 'img', video: 'vid', tts: 'aud', stt: 'txt' }
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'mp4', 'ogg', 'oga', 'opus', 'webm', 'flac', 'aac', 'mpga', 'mpeg'])
const CONTENT_TYPE = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/opus', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac', pcm: 'audio/pcm',
}

/** `img-20260830-120102-a1b2c3` — sortable, unambiguous, and safe as a filename. */
function newId(kind) {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${KIND_PREFIX[kind] ?? 'med'}-${stamp}-${randomBytes(3).toString('hex')}`
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  let config = normalizeConfig(null)
  let promptDisposer = null
  const toolDisposers = new Map()

  const credentials = () => ctx.get('credentials')
  let credentialRef = v => v
  // Awaited before the first lookup: a /generate in the first tick would otherwise resolve the
  // credential with the bare env name instead of a ref.
  const credentialRefReady = import('@deepseek-ai/dsh-credentials')
    .then(m => { credentialRef = m.credentialRef })
    .catch(() => { /* keep identity */ })

  /**
   * The providers the harness itself is configured with (its Models page), offered here under
   * the DSH heading so a media section can borrow a host and its key as one unit.
   */
  function harnessProviders() {
    const settings = ctx.get('settings')
    if (!settings || typeof settings.get !== 'function') return []
    const dir = ctx.get('llm')?.listConfigurableProviders?.()
    const namespaces = Array.isArray(dir) && dir.length > 0
      ? [...new Set(dir.map(d => d.settingsNs).filter(ns => typeof ns === 'string' && ns.length > 0))]
      : ['llm-pi-ai']
    const out = []
    for (const ns of namespaces) {
      const providers = settings.get(ns)?.providers
      if (!providers || typeof providers !== 'object') continue
      const text = v => (typeof v === 'string' ? v : '')
      for (const [route, cfg] of Object.entries(providers)) {
        if (!cfg || typeof cfg !== 'object') continue
        // First namespace wins: a duplicate route in a second namespace would make find-by-route
        // ambiguous everywhere this list is consulted.
        if (out.some(existing => existing.route === route)) continue
        out.push({ route, baseURL: text(cfg.baseURL), keyEnv: text(cfg.apiKeyEnv) })
      }
    }
    return out
  }
  /** Hosts implied by well-known route names, same convention the desktop pet uses. */
  const ROUTE_BASE = { openrouter: 'https://openrouter.ai/api', openai: 'https://api.openai.com', deepseek: 'https://api.deepseek.com', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com' }
  /** Ten minutes of model listings per host+kind, so the settings page can be reopened freely. */
  const modelCache = new Map()

  /**
   * The host a harness provider can be borrowed at, or '' when there is none we can name. Many
   * catalog routes configure only a credential (the host lives inside the harness's own client),
   * and a borrowed key must NEVER ride a host guessed from anywhere else — the adapters would
   * otherwise fall back to their own default host and send this provider's key to a foreign server.
   */
  function harnessHost(found) {
    return found.baseURL || ROUTE_BASE[found.route] || ''
  }

  /** The harness provider a section borrows, resolved fail-closed: host and key come back together. */
  function resolveHarness(routeName) {
    const found = harnessProviders().find(p => p.route === routeName)
    if (!found) throw new Error(`the harness provider "${routeName || '(none)'}" is not configured any more; pick another under 设置 → 多媒体 API`)
    const baseURL = harnessHost(found)
    if (!baseURL) throw new Error(`the harness provider "${found.route}" has no usable host for this plugin (no base URL is configured for it); only providers with a known host can be borrowed`)
    return { found, baseURL }
  }

  /** The section as the adapters should see it: a harness-sourced one gets its provider's host. */
  function effectiveSection(kind) {
    const section = config[kind]
    if (section.source !== 'harness') return section
    const { baseURL } = resolveHarness(section.harnessRoute)
    return { ...section, baseURL }
  }

  async function keyFor(kind) {
    await credentialRefReady
    const section = config[kind]
    // Harness-sourced: the provider's own credential, resolved next to the host it belongs to.
    const env = section.source === 'harness'
      ? harnessProviders().find(p => p.route === section.harnessRoute)?.keyEnv
      : keyEnvFor(kind, config)
    if (!env) return undefined
    try { return (await credentials()?.resolve?.(credentialRef(env)))?.value } catch { return undefined }
  }
  async function keyConfigured(env) {
    if (!env) return true
    try { return (await credentials()?.describe?.(credentialRef(env)))?.configured === true } catch { return false }
  }

  // ── config file (hot reloaded, same contract as the other suite plugins) ──
  // The file is normalised, not validated: `normalizeConfig` already drops anything unusable (an
  // unknown provider, a credential this plugin does not own), and the adapters refuse a bad URL at
  // request time. The POST route additionally reports problems so a person sees them.
  // Called on apply, on every config write, and by the file watcher — so `keepDays` applies even
  // when nothing new is generated. (`sweep` is otherwise only reached from `saveMedia`.)
  function loadConfig() {
    let raw = null
    try { raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) } catch { raw = null }
    config = normalizeConfig(raw)
    syncPrompt()
    syncTools()
    sweep()          // the retention window applies whether or not anything new was generated
    console.log(`[media-lab] ${KINDS.filter(k => config[k].enabled).map(k => `${k}=${config[k].provider}`).join(' ') || 'nothing enabled'}`)
  }

  function syncPrompt() {
    promptDisposer?.()
    promptDisposer = null
    if (config.tools.prompt === false) return   // the tools stay registered; the model just is not told about them up front
    const lines = []
    if (config.image.enabled && config.tools.image) lines.push('- generate_image:生成图片(会存到本地并在对话里显示缩略图)。用户要图/要头像/要素材时用它,提示词写英文更稳。')
    if (config.video.enabled && config.tools.video) lines.push('- generate_video:生成视频(异步,可能要等几十秒到几分钟)。')
    if (config.tts.enabled && config.tools.tts) lines.push('- text_to_speech:把文字念出来,返回可播放的音频文件。')
    if (config.stt.enabled && config.tools.stt) lines.push('- transcribe_audio:把本地音频文件转成文字。')
    if (lines.length === 0) return
    promptDisposer = ctx.systemPrompt.section({
      name: 'media-lab:tools',
      order: 132,
      text: ['本机接了额外的多媒体 API,你可以直接调用:', ...lines, '生成的文件都在本地,回答时把文件路径告诉用户;失败时如实说明是哪一步失败(配置/额度/网络),不要假装生成成功。'].join('\n'),
    })
  }

  // ── files ────────────────────────────────────────────────────────────────
  // A <video> issues one Range request per seek, and listing the directory each time is O(files)
  // per byte range. The listing only changes when this plugin writes or sweeps.
  let listing = null
  const forgetListing = () => { listing = null }
  function mediaPath(id) {
    if (!ID.test(String(id))) return null
    ensureDir()
    for (let attempt = 0; attempt < 2; attempt++) {
      if (listing === null) listing = readdirSync(MEDIA_DIR)
      for (const file of listing) {
        // `<id>.json` is the sidecar that records how the media was made: never the media itself.
        if (file.startsWith(id + '.') && !file.endsWith('.json')) return join(MEDIA_DIR, file)
      }
      // A miss on a warm listing may just be stale — another dsh sharing this DSH_HOME, or a
      // restored backup. Read the directory once more before answering "no such media".
      if (attempt === 0) forgetListing()
    }
    return null
  }
  const ensureDir = () => { if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true }) }

  /**
   * Read one audio file for transcription. The bytes leave the machine, so this is deliberately
   * narrow: an audio extension the adapters can send, a size cap, and the deployment's filesystem
   * seam (`ctx.fs`) when it has one, so sandboxed / remote backends and the `fs/*` events see the
   * read instead of being bypassed by a raw readFileSync.
   */
  /**
   * The first frame of an image-to-video job, as a URL the provider can fetch or embed. A `data:`
   * or `https:` URL is passed through; a local path is read through the same filesystem seam as
   * everything else and turned into a `data:` URL, because the provider cannot see this disk.
   */
  // Its own budget, not `maxFileMB`: that is the retention limit for generated OUTPUT (default
  // 96 MB). A first frame is request payload — held as bytes plus base64 plus the stringified
  // body, by up to four queued jobs at once — and a provider refuses a body that size anyway.
  const FIRST_FRAME_MAX = 10 * 1024 * 1024

  async function readFirstFrame(raw) {
    const value = raw.trim()
    if (value.length === 0) return undefined
    if (/^(data:image\/|https:\/\/)/i.test(value)) return value
    if (!isAbsolute(value)) throw new Error('the first frame needs an absolute path, a data: URL or an https: URL')
    const full = resolvePath(value)
    const ext = extname(full).slice(1).toLowerCase()
    const mime = CONTENT_TYPE[ext]
    if (!mime || !mime.startsWith('image/')) throw new Error(`the first frame must be an image, not ".${ext}"`)
    const limit = FIRST_FRAME_MAX
    const seam = ctx.get('fs')
    let bytes
    if (seam && typeof seam.resolve === 'function' && typeof seam.readBytes === 'function') {
      bytes = Buffer.from(await seam.readBytes(await seam.resolve(full), undefined, limit))
    } else {
      if (!existsSync(full)) throw new Error(`no such file: ${full}`)
      if (statSync(full).size > limit) throw new Error(`the first frame is over the 10 MB limit`)
      bytes = readFileSync(full)
    }
    if (bytes.length === 0) throw new Error(`${full} is empty`)
    if (bytes.length > limit) throw new Error(`the first frame is over the 10 MB limit`)
    return `data:${mime};base64,${bytes.toString('base64')}`
  }

  async function readAudio(full, signal) {
    const ext = extname(full).slice(1).toLowerCase()
    if (!AUDIO_EXT.has(ext)) throw new Error(`transcription takes an audio file (${[...AUDIO_EXT].join(', ')}), not ".${ext}"`)
    const limit = config.maxFileMB * 1024 * 1024
    // The core's filesystem seam is resolve() → readBytes(target, signal, maxBytes)
    // (core/packages/fs/fs/src/index.ts): going through it keeps a sandboxed or remote backend and
    // the fs/* events in the loop instead of reading the disk behind their backs.
    const seam = ctx.get('fs')
    if (seam && typeof seam.resolve === 'function' && typeof seam.readBytes === 'function') {
      const target = await seam.resolve(full)
      const bytes = Buffer.from(await seam.readBytes(target, signal, limit))
      // The cap is a hint to the seam, not a promise from it.
      if (bytes.length > limit) throw new Error(`the file is over the ${config.maxFileMB} MB limit`)
      if (bytes.length === 0) throw new Error(`${full} is empty`)
      return bytes
    }
    if (!existsSync(full)) throw new Error(`no such file: ${full}`)
    if (statSync(full).size > limit) throw new Error(`the file is over the ${config.maxFileMB} MB limit`)
    const bytes = readFileSync(full)
    // Again after the read: the check above is on the file as it was a moment ago.
    if (bytes.length > limit) throw new Error(`the file is over the ${config.maxFileMB} MB limit`)
    return bytes
  }

  // A generation holds its response body in memory for as long as the provider takes (up to 15
  // minutes for video). Running them one at a time per kind bounds that to one body per kind
  // rather than one per caller.
  const lane = new Map()
  const laneDepth = new Map()
  const MAX_IN_FLIGHT = 4      // one running plus three waiting
  function inLane(kind, run) {
    const inFlight = laneDepth.get(kind) ?? 0
    // Each caller waiting for a turn holds an open socket and a parsed body, and a video job can
    // take fifteen minutes: the queue is bounded, and the fifth caller is told to come back.
    if (inFlight >= MAX_IN_FLIGHT) throw Object.assign(new Error(`too many ${kind} jobs are already queued; try again shortly`), { status: 429 })
    laneDepth.set(kind, inFlight + 1)
    const release = () => laneDepth.set(kind, Math.max(0, (laneDepth.get(kind) ?? 1) - 1))
    const previous = lane.get(kind) ?? Promise.resolve()
    const mine = previous.catch(() => {}).then(run).finally(release)
    lane.set(kind, mine.catch(() => {}))
    return mine
  }

  function saveMedia(kind, base64, mime, meta) {
    ensureDir()
    // Buffer.from ignores whatever it cannot read, so "!!!!AAAAAAAA" decodes to 6 stray bytes and
    // would be written out as a "PNG": check the alphabet first, and the length after.
    const cleaned = String(base64 ?? '').replace(/\s+/g, '')
    const standard = /^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)
    const urlSafe = /^[A-Za-z0-9_-]+={0,2}$/.test(cleaned)
    // One alphabet or the other, never a mixture. Unpadded is legal (Go's RawStdEncoding, and most
    // base64url emitters), so the real test is a round trip: Buffer.from ignores what it cannot read,
    // and "!!!!AAAAAAAA" does not come back as itself.
    if (cleaned.length < 4 || cleaned.length % 4 === 1 || !(standard || urlSafe)) {
      throw new Error('the provider returned data that is not valid base64')
    }
    const bytes = Buffer.from(cleaned, 'base64')
    const again = bytes.toString('base64').replace(/=+$/, '')
    const asked = (urlSafe && !standard ? cleaned.replace(/-/g, '+').replace(/_/g, '/') : cleaned).replace(/=+$/, '')
    if (again !== asked) throw new Error('the provider returned data that is not valid base64')
    if (bytes.length === 0) throw new Error('the provider returned data that is not valid base64')
    const limit = config.maxFileMB * 1024 * 1024
    if (bytes.length > limit) throw new Error(`the result is ${(bytes.length / 1048576).toFixed(1)} MB, over the ${config.maxFileMB} MB limit`)
    const id = newId(kind)
    const ext = extFor(mime, kind)
    const file = join(MEDIA_DIR, `${id}.${ext}`)
    writeFileSync(file, bytes)
    writeFileSync(join(MEDIA_DIR, `${id}.json`), JSON.stringify({ id, kind, mime, bytes: bytes.length, at: new Date().toISOString(), ...meta }, null, 2))
    forgetListing()
    sweep()
    return { id, file, ext, bytes: bytes.length, url: `/dsh-media-lab/file/${id}` }
  }

  /** Drop files older than `keepDays` (0 keeps everything). */
  function sweep() {
    if (config.keepDays <= 0) return
    const cutoff = Date.now() - config.keepDays * 86400000
    try {
      for (const file of readdirSync(MEDIA_DIR)) {
        const full = join(MEDIA_DIR, file)
        try { if (statSync(full).mtimeMs < cutoff) unlinkSync(full) } catch { /* busy file: next sweep */ }
      }
    } catch { /* the directory may not exist yet */ }
    forgetListing()
  }

  /** Newest first: the id's timestamp (not its kind prefix) orders it, so only the newest are parsed. */
  function listMedia(limit = 60) {
    ensureDir()
    const stamp = name => name.slice(4)      // "img-20260830-120102-ab12cd.json" → the sortable part
    const names = readdirSync(MEDIA_DIR).filter(f => f.endsWith('.json') && ID.test(f.slice(0, -5)))
      .sort((a, b) => stamp(b).localeCompare(stamp(a)))
      .slice(0, limit)
    const out = []
    for (const file of names) {
      try { out.push(JSON.parse(readFileSync(join(MEDIA_DIR, file), 'utf8'))) } catch { /* skip a half-written sidecar */ }
    }
    return out
  }

  // ── one generation ───────────────────────────────────────────────────────
  async function generate(kind, task, signal) {
    if (!KINDS.includes(kind)) throw new Error(`unknown media kind "${kind}"`)
    if (!config[kind].enabled) throw new Error(`${kind} is not configured; open dsh 设置 → 多媒体 API and enable it`)
    const section = effectiveSection(kind)
    const key = await keyFor(kind)
    // Always time-bounded: a caller without a signal (the HTTP routes) still gets the kind's timeout
    // plus a margin, so a stalled provider cannot hold a request open indefinitely.
    // One at a time per kind: each generation holds a capped body in memory for as long as the
    // provider takes, and nothing about `/generate` limits how many callers there are. The timeout
    // is armed inside the lane — a queued job must not spend its budget waiting for its turn — and
    // so is `task.read()`, so a queued transcription is not already holding its file.
    // The per-job timeout is armed inside the lane (a queued job must not spend its budget
    // waiting), so the wait itself gets its own, longer bound.
    const queued = AbortSignal.timeout(Math.max(5000, Number(section.timeoutMs ?? 180000)) * 2 + 30000)
    const waitFailed = new Promise((_, reject) => {
      queued.addEventListener('abort', () => reject(Object.assign(new Error(`the ${kind} queue did not free up in time`), { status: 503 })), { once: true })
    })
    // Attached before anything can throw: `inLane` refuses a full lane synchronously, so the race
    // below is never built on that path and this promise would reject into nothing minutes later —
    // which takes the process down.
    waitFailed.catch(() => {})
    const result = await Promise.race([waitFailed, inLane(kind, async () => {
      if (typeof task.read === 'function') task = { ...task, file: await task.read(), read: undefined }
      const bounded = AbortSignal.timeout(Math.max(5000, Number(section.timeoutMs ?? 180000)) + 15000)
      // `queued` too: when the wait deadline fires the caller has its 503, and this job must not
      // go on to spend the provider's quota and save a result nobody will see.
      const merged = AbortSignal.any([bounded, queued, ...(signal ? [signal] : [])])
      return runTask({ kind, task, config: { ...section, maxFileMB: config.maxFileMB }, key, signal: merged })
    })])
    if (result.text !== undefined) return { kind, text: result.text }
    // Before saveMedia: an stt section configured to return bytes used to write an orphan .bin the
    // listing then showed for ever, and only then answer 502.
    if (kind === 'stt') throw new Error('the transcription provider returned audio, not text (check resultType / resultPath for a custom endpoint)')
    const saved = saveMedia(kind, result.base64, result.mime, {
      provider: section.provider,
      model: section.model || undefined,
      prompt: (task.prompt ?? task.text ?? '').slice(0, 500),
      sourceUrl: result.sourceUrl,
    })
    return { kind, ...saved, mime: result.mime, marker: `[[dsh-media:${saved.id}]]` }
  }

  // `transcribe_audio` is the one tool that reads a file off this machine and sends it somewhere
  // else, with the path chosen by the model. `kind: 'ask'` hands that to the deployment's approval
  // flow (core/packages/core/tools: the pre-execute waterfall, then `ctx.get('approval')`); a
  // deployment with no approval service treats it as its own policy decides.
  ctx.effect(() => ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'transcribe_audio') return next()
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    const path = String(exec.arguments?.path ?? '(no path)').slice(0, 200)
    const host = (() => { try { return new URL(effectiveSection('stt').baseURL || 'https://api.openai.com').host } catch { return 'the configured endpoint' } })()
    return { kind: 'ask', reason: `upload ${path} to ${host} for transcription` }
  }), 'media-lab: transcription is an upload')

  // ── tools ────────────────────────────────────────────────────────────────
  function syncTools() {
    for (const kind of KINDS) {
      const want = config[kind].enabled && config.tools[kind] === true
      const has = toolDisposers.has(kind)
      if (want === has) continue
      if (!want) { toolDisposers.get(kind)?.(); toolDisposers.delete(kind); continue }
      // ctx.tools.register returns its own disposer; the tools come and go with the config file,
      // so they are tracked here and released by the plugin-scoped effect below.
      toolDisposers.set(kind, ctx.tools.register(TOOLS[kind]()))
    }
  }

  const fileLine = value => `${value.file}${value.bytes ? ` (${(value.bytes / 1024).toFixed(0)} KB)` : ''}`

  // github.com/openai/openai-openapi: CreateSpeechRequest.input is maxLength 4096.
  const TTS_MAX_INPUT = 4096
  const PROMPT_MAX = 4000

  const TOOLS = {
    image: () => defineTool({
      name: 'generate_image',
      description: '用已配置的图像 API 生成图片,存到本地并在对话里显示。提示词尽量具体(主体/风格/构图/光线),英文提示词通常更稳。',
      parameters: {
        prompt: { type: 'string', required: true, description: '图像提示词,越具体越好。' },
        size: { type: 'string', description: "尺寸,如 '1024x1024'、'1024x1536';留空用设置里的默认值。" },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true }, file: { type: 'string', required: true },
            url: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
            marker: { type: 'string', required: true }, provider: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `图片已生成:${value.marker}\n${value.file}` }],
      },
      isConcurrencySafe: () => false,
      async execute(args, { signal } = {}) {
        const out = await generate('image', { prompt: String(args.prompt ?? '').slice(0, 4000), size: args.size }, signal)
        return { id: out.id, file: out.file, url: out.url, bytes: out.bytes, marker: out.marker, provider: config.image.provider }
      },
    }),
    video: () => defineTool({
      name: 'generate_video',
      description: '用已配置的视频 API 生成一段短视频(异步,可能要等几十秒到几分钟)。生成后文件存在本地,并在对话里可播放。',
      parameters: {
        prompt: { type: 'string', required: true, description: '视频提示词:主体、动作、镜头、风格。' },
        seconds: { type: 'integer', description: '时长(秒),留空用设置里的默认值。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true }, file: { type: 'string', required: true },
            url: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
            marker: { type: 'string', required: true }, provider: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `视频已生成:${value.marker}\n${value.file}` }],
      },
      isConcurrencySafe: () => false,
      async execute(args, { signal } = {}) {
        const out = await generate('video', { prompt: String(args.prompt ?? '').slice(0, 4000), seconds: args.seconds }, signal)
        return { id: out.id, file: out.file, url: out.url, bytes: out.bytes, marker: out.marker, provider: config.video.provider }
      },
    }),
    tts: () => defineTool({
      name: 'text_to_speech',
      description: '把文字合成语音,返回可播放的音频文件(用已配置的 TTS API)。',
      parameters: {
        text: { type: 'string', required: true, description: '要念的文字。' },
        voice: { type: 'string', description: '音色 id;留空用设置里的默认音色。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true }, file: { type: 'string', required: true },
            url: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
            marker: { type: 'string', required: true }, provider: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `语音已生成:${value.marker}\n${value.file}` }],
      },
      isConcurrencySafe: () => false,
      async execute(args, { signal } = {}) {
        const out = await generate('tts', { text: String(args.text ?? '').slice(0, TTS_MAX_INPUT), voice: args.voice }, signal)
        return { id: out.id, file: out.file, url: out.url, bytes: out.bytes, marker: out.marker, provider: config.tts.provider }
      },
    }),
    stt: () => defineTool({
      name: 'transcribe_audio',
      description: '把本地音频文件转写成文字(用已配置的语音识别 API)。',
      parameters: {
        path: { type: 'string', required: true, description: '音频文件的绝对路径(mp3/wav/m4a/ogg/webm)。' },
        language: { type: 'string', description: "语言代码,如 'zh'、'en';留空自动判断。" },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true }, provider: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      isConcurrencySafe: () => true,
      async execute(args, { signal } = {}) {
        const path = String(args.path ?? '')
        if (!isAbsolute(path)) throw new Error('path must be absolute')
        const full = resolvePath(path)
        const out = await generate('stt', {
          read: async () => ({ bytes: await readAudio(full, signal), name: full.split(/[\\/]/).pop(), type: CONTENT_TYPE[extname(full).slice(1).toLowerCase()] ?? 'application/octet-stream' }),
          language: args.language,
        }, signal)
        if (typeof out.text !== 'string' || out.text.length === 0) throw new Error('the transcription provider returned no text (check resultType / resultPath for a custom endpoint)')
        return { text: out.text, provider: config.stt.provider }
      },
    }),
  }

  // ── routes ───────────────────────────────────────────────────────────────
  const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
  const hostOf = req => { const h = String(req.headers.host ?? '').trim().toLowerCase(); const m = /^\[([^\]]+)\](?::\d+)?$/.exec(h); return m ? `[${m[1]}]` : h.replace(/:\d+$/, '') }
  const rejectCrossSite = req => {
    if (!LOOPBACK_HOSTS.has(hostOf(req))) return true
    const site = String(req.headers['sec-fetch-site'] ?? '')
    if (site === 'cross-site' || site === 'same-site') return true   // another local port is not us
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin.length > 0) {
      // compare the whole authority, like the core's own trust check: another port is another origin
      try { if (new URL(origin).host.toLowerCase() !== String(req.headers.host ?? '').toLowerCase()) return true } catch { return true }
    }
    if (req.method === 'POST' && !/^application\/json/i.test(String(req.headers['content-type'] ?? ''))) return true
    return false
  }
  // `limit` defaults to the small cap every JSON route needs; /generate raises it for reference images.
  const readBody = (req, limit = MAX_BODY) => new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let over = false
    let settled = false
    const fail = (status, message) => { if (!settled) { settled = true; reject(Object.assign(new Error(message), { status })) } }
    // A declared length over the limit is refused before a byte is buffered or drained.
    const declared = Number(req.headers?.['content-length'])
    if (Number.isFinite(declared) && declared > limit) { req.resume(); fail(413, 'body too large'); return }
    req.on('data', c => {
      if (over) return
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c)
      bytes += buf.length
      if (bytes > limit) { over = true; chunks.length = 0; req.resume(); fail(413, 'body too large'); return }
      chunks.push(buf)
    })
    req.on('end', () => {
      if (over || settled) return
      settled = true
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        const value = text ? JSON.parse(text) : {}
        if (value === null || typeof value !== 'object' || Array.isArray(value)) { reject(Object.assign(new Error('JSON body must be an object'), { status: 400 })); return }
        resolve(value)
      } catch { reject(Object.assign(new Error('invalid JSON body'), { status: 400 })) }
    })
    req.on('aborted', () => fail(400, 'request aborted'))
    req.on('error', () => fail(400, 'request error'))
  })
  const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }

  const status = async () => {
    // Wait for the credential-ref helper like every other lookup: without this the first status
    // after boot describes a raw env name instead of a credential ref, reporting a configured key
    // as unconfigured until the dynamic import lands.
    await credentialRefReady
    const keys = {}
    for (const env of Object.keys(KEY_ENVS)) keys[env] = { label: KEY_ENVS[env], configured: await keyConfigured(env) }
    let keyWritable = false
    try { keyWritable = (await credentials()?.describe?.(credentialRef('OPENAI_API_KEY')))?.writable === true } catch { /* unknown */ }
    // A custom section's headers may hold a literal token the user pasted instead of `{{key}}`: they
    // are stored in plain text and the panel does not render them, so they are not echoed back.
    const shown = Object.fromEntries(Object.entries(config).map(([key, value]) => [
      key,
      value && typeof value === 'object' && !Array.isArray(value) && value.headers
        ? { ...value, headers: Object.fromEntries(Object.keys(value.headers).map(name => [name, '(hidden)'])) }
        : value,
    ]))
    return { ok: true, config: shown, providers: describeProviders(), keys, keyWritable, mediaDir: MEDIA_DIR }
  }

  const route = async (req, res) => {
    let url
    // Inside the try in spirit: an absolute-form target that will not parse is a 400, not a
    // rejected promise and a hung socket.
    try { url = new URL(req.url, 'http://127.0.0.1') } catch {
      req.resume?.()
      return json(res, 400, { ok: false, message: 'unreadable request target' })
    }
    const p = url.pathname
    try {
      if (rejectCrossSite(req)) { req.resume?.(); return json(res, 403, { ok: false, message: 'same-origin requests only' }) }
      if (req.method === 'GET' && p === '/dsh-media-lab/status') return json(res, 200, await status())
      if (req.method === 'GET' && p === '/dsh-media-lab/harness-providers') {
        await credentialRefReady
        const out = []
        for (const prov of harnessProviders()) {
          out.push({
            ...prov,
            configured: prov.keyEnv ? await keyConfigured(prov.keyEnv) : false,
            // Only a provider whose host this plugin can name may be borrowed: without one the
            // generate path fails closed, so the UI should not offer it as a live choice.
            borrowable: harnessHost(prov) !== '',
          })
        }
        return json(res, 200, { ok: true, providers: out })
      }
      if (req.method === 'GET' && p === '/dsh-media-lab/models') {
        // The host is never taken from the query — and host and credential always come from ONE
        // resolved provider. A section stored as harness-sourced answers with its provider's pair
        // whatever the query says, so the two can never be mixed across providers.
        const kind = String(url.searchParams.get('kind') ?? '')
        if (!KINDS.includes(kind)) return json(res, 400, { ok: false, message: 'unknown media kind' })
        let baseURL = ''
        let key
        let keyEnvName = ''
        const askedHarness = url.searchParams.get('source') === 'harness'
        if (askedHarness || config[kind].source === 'harness') {
          const route = String((askedHarness && url.searchParams.get('route')) || config[kind].harnessRoute || '')
          let resolved
          try { resolved = resolveHarness(route) } catch (error) { return json(res, 400, { ok: false, message: String(error?.message ?? error) }) }
          baseURL = resolved.baseURL
          keyEnvName = resolved.found.keyEnv
          await credentialRefReady
          try { key = (await credentials()?.resolve?.(credentialRef(resolved.found.keyEnv)))?.value } catch { key = undefined }
        } else {
          const section = config[kind]
          baseURL = section.baseURL || adapterFor(kind, section.provider)?.defaultBaseURL || ''
          keyEnvName = keyEnvFor(kind, config)
          key = await keyFor(kind)
        }
        if (!baseURL) return json(res, 400, { ok: false, message: 'no base URL to list models from' })
        const cacheKey = `${baseURL}|${kind}|${keyEnvName}`
        const hit = modelCache.get(cacheKey)
        if (hit && Date.now() - hit.at < 600000) return json(res, 200, { ok: true, models: hit.models, cached: true })
        const models = await scoutModels({ baseURL, kind, apiKey: key })
        modelCache.set(cacheKey, { at: Date.now(), models })
        if (modelCache.size > 40) modelCache.delete(modelCache.keys().next().value)
        return json(res, 200, { ok: true, models })
      }
      if (req.method === 'GET' && p === '/dsh-media-lab/files') {
        const asked = Number(url.searchParams.get('limit') ?? 60)
        return json(res, 200, { ok: true, files: listMedia(Number.isFinite(asked) ? Math.min(500, Math.max(1, asked)) : 60) })
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && p.startsWith('/dsh-media-lab/file/')) {
        const id = p.slice('/dsh-media-lab/file/'.length)
        const file = mediaPath(id)
        let stat
        try { stat = file ? statSync(file) : null } catch { stat = null }
        if (!file || !stat) { res.writeHead(404); return res.end() }
        const ext = extname(file).slice(1).toLowerCase()
        const common = {
          'content-type': CONTENT_TYPE[ext] ?? 'application/octet-stream',
          'cache-control': 'private, max-age=86400',
          'content-disposition': `inline; filename="${id}.${ext}"`,
          'x-content-type-options': 'nosniff',
          // Without this a `<video>` seek re-downloads the whole file from the start.
          'accept-ranges': 'bytes',
        }
        // One range, which is what every browser asks for; anything else is answered in full.
        const asked = String(req.headers.range ?? '')
        // RFC 9110: a range spec that names nothing is ignored, not answered with 206.
        const range = asked === 'bytes=-' ? null : /^bytes=(\d*)-(\d*)$/.exec(asked)
        let start = 0
        let end = stat.size - 1
        if (range && stat.size > 0) {
          if (range[1] === '' && range[2] !== '') start = Math.max(0, stat.size - Number(range[2]))
          else {
            start = Number(range[1] || 0)
            if (range[2] !== '') end = Math.min(end, Number(range[2]))
          }
          if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
            res.writeHead(416, { 'content-range': `bytes */${stat.size}` })
            return res.end()
          }
          res.writeHead(206, { ...common, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${stat.size}` })
          // A browser probing seekability sends HEAD with a Range: answer the headers, open nothing.
          if (req.method === 'HEAD') return res.end()
          return pipeline(createReadStream(file, { start, end }), res, error => {
            if (error) console.warn(`[media-lab] serving ${id} stopped: ${String(error?.message ?? error).slice(0, 160)}`)
          })
        }
        res.writeHead(200, { ...common, 'content-length': stat.size })
        if (req.method === 'HEAD') return res.end()
        // pipeline (not pipe): a file deleted mid-stream, or a client that walks away, must not
        // raise an uncaught error in the harness process, and the read stream is always closed.
        return pipeline(createReadStream(file), res, error => {
          if (error) console.warn(`[media-lab] serving ${id} stopped: ${String(error?.message ?? error).slice(0, 160)}`)
        })
      }
      if (req.method === 'POST' && p === '/dsh-media-lab/config') {
        const body = await readBody(req)
        // Merge per section: a UI that posts only `{ image: { enabled: false } }` must not wipe the
        // provider, model and base URL that section already had.
        const merged = { ...config, ...body }
        for (const kind of KINDS) {
          if (body[kind] === undefined) continue
          if (body[kind] === null || typeof body[kind] !== 'object' || Array.isArray(body[kind])) {
            return json(res, 400, { ok: false, message: `the "${kind}" section must be an object` })
          }
          // Switching provider drops the credential and the host the OLD one was using — from
          // the stored section, before the body is applied. What the caller explicitly sends still
          // wins (and is then judged by mayCarryKey), but nothing is inherited across a switch.
          merged[kind] = { ...config[kind], ...body[kind] }
          // The panel is served masked custom headers ('(hidden)') and posts the whole draft
          // back: a masked value is the echo of a secret, never a new secret — writing it would
          // replace the real token with the literal mask. The stored value is restored instead.
          if (merged[kind].headers && typeof merged[kind].headers === 'object' && config[kind].headers) {
            for (const [name, value] of Object.entries(merged[kind].headers)) {
              if (value === '(hidden)' && config[kind].headers[name] !== undefined) merged[kind].headers[name] = config[kind].headers[name]
            }
          }
          // A provider switch drops the credential and the host the OLD provider was using. The
          // settings panel posts the whole section back, so "the body did not mention it" is not the
          // test: what is dropped is what the body merely ECHOED. A field the caller actually changed
          // is kept and then judged by mayCarryKey, so a foreign credential is refused, not ignored.
          if (typeof body[kind].provider === 'string' && body[kind].provider !== config[kind].provider) {
            for (const field of ['keyEnv', 'baseURL']) {
              if (body[kind][field] === undefined || body[kind][field] === config[kind][field]) delete merged[kind][field]
            }
          }
        }
        if (body.tools !== undefined) {
          if (body.tools === null || typeof body.tools !== 'object' || Array.isArray(body.tools)) {
            return json(res, 400, { ok: false, message: 'the "tools" section must be an object' })
          }
          for (const [name, value] of Object.entries(body.tools)) {
            if (typeof value !== 'boolean') return json(res, 400, { ok: false, message: `tools.${name} must be true or false` })
          }
          merged.tools = { ...config.tools, ...body.tools }
        }
        for (const field of ['keepDays', 'maxFileMB']) {
          if (body[field] !== undefined && (typeof body[field] !== 'number' || !Number.isFinite(body[field]))) {
            return json(res, 400, { ok: false, message: `"${field}" must be a number` })
          }
        }
        const problems = validateConfig(merged)
        if (problems.length > 0) return json(res, 400, { ok: false, message: problems.join('; ') })
        mkdirSync(DSH_HOME, { recursive: true })
        writeFileSync(CONFIG_FILE, JSON.stringify(normalizeConfig(merged), null, 2))
        loadConfig()
        return json(res, 200, await status())
      }
      if (req.method === 'POST' && p === '/dsh-media-lab/key') {
        const body = await readBody(req)
        const env = String(body.env ?? '')
        if (!(env in KEY_ENVS)) return json(res, 400, { ok: false, message: `unknown credential "${env}"` })
        const creds = credentials()
        if (!creds || typeof creds.set !== 'function') return json(res, 503, { ok: false, message: 'credentials service unavailable' })
        const value = String(body.value ?? '')
        if (value.length === 0) await creds.unset(credentialRef(env))
        else await creds.set(credentialRef(env), value)
        return json(res, 200, await status())
      }
      if (req.method === 'POST' && p === '/dsh-media-lab/generate') {
        // Reference images ride in the body as data: URLs, so this one route accepts a larger body
        // than the config/key routes. That body limit is the real cap on references; the per-item
        // cap in the image branch only keeps one reference from being the whole body.
        const body = await readBody(req, GENERATE_MAX_BODY)
        const kind = String(body.kind ?? '')
        if (!KINDS.includes(kind)) return json(res, 400, { ok: false, message: `unknown kind "${kind}"` })
        const t0 = Date.now()
        let task
        if (kind === 'tts') task = { text: String(body.text ?? body.prompt ?? '').slice(0, TTS_MAX_INPUT), voice: body.voice }
        else if (kind === 'stt') {
          // Transcription takes a file: the caller (the desktop pet's voice input, the launcher, a
          // script) hands over an absolute path, which is read here and posted as multipart.
          const path = String(body.path ?? '')
          if (!isAbsolute(path)) return json(res, 400, { ok: false, message: 'stt needs an absolute file path' })
          const full = resolvePath(path)
          task = {
            read: async () => ({ bytes: await readAudio(full), name: full.split(/[\\/]/).pop(), type: CONTENT_TYPE[extname(full).slice(1).toLowerCase()] ?? 'application/octet-stream' }),
            language: body.language,
          }
        } else {
          task = { prompt: String(body.prompt ?? '').slice(0, 4000), seconds: body.seconds, size: body.size }
          // An image may ask for a transparent background and a format that can carry one; the
          // adapters that cannot do it ignore both.
          if (kind === 'image') {
            if (body.background !== undefined) task.background = String(body.background).slice(0, 20)
            if (body.format !== undefined) task.format = String(body.format).slice(0, 10)
            if (body.quality !== undefined) task.quality = String(body.quality).slice(0, 20)
            // A tier spelled "1k" is folded rather than sent for a provider 400; anything outside
            // the documented set is refused here, where the caller can read why.
            if (body.resolution !== undefined) {
              const tier = String(body.resolution).trim().toUpperCase()
              if (!RESOLUTION_TIERS.has(tier)) return json(res, 400, { ok: false, message: `resolution must be one of ${[...RESOLUTION_TIERS].join(' / ')}` })
              task.resolution = tier
            }
            // Number.isInteger(1e300) is true; a seed is a non-negative safe integer or nothing.
            if (body.seed !== undefined) {
              if (!Number.isSafeInteger(body.seed) || body.seed < 0) return json(res, 400, { ok: false, message: 'seed must be a non-negative integer' })
              task.seed = body.seed
            }
            // Reference images for image-to-image guidance: `data:` URLs the caller built (a pet's
            // own canon drawing) or http(s) URLs. Capped in count, and each one below the route's
            // body limit so a single reference cannot be the whole body; anything else is dropped
            // rather than forwarded.
            if (Array.isArray(body.references)) {
              task.references = body.references
                .filter(r => typeof r === 'string' && /^(data:image\/(png|jpeg|webp);base64,|https?:\/\/)/i.test(r) && r.length <= REFERENCE_MAX_CHARS)
                .slice(0, 4)
            }
          }
          // Image-to-video: the caller hands over the first frame, either as a `data:` URL it built
          // itself or as an absolute path on this machine. Providers that cannot take one ignore it.
          if (kind === 'video' && body.image !== undefined) task.image = await readFirstFrame(String(body.image))
        }
        const out = await generate(kind, task)
        if (kind === 'stt' && (typeof out.text !== 'string' || out.text.length === 0)) {
          return json(res, 502, { ok: false, message: 'the transcription provider returned no text (check resultType / resultPath for a custom endpoint)' })
        }
        return json(res, 200, { ok: true, ms: Date.now() - t0, ...out })
      }
      if (req.method === 'POST' && p === '/dsh-media-lab/delete') {
        const body = await readBody(req)
        const id = String(body.id ?? '')
        const file = mediaPath(id)
        if (!file) {
          // The media may be gone while its sidecar is not: without this the listing kept showing an
          // entry that /delete answered 404 for, for ever.
          if (ID.test(id) && existsSync(join(MEDIA_DIR, id + '.json'))) {
            try { unlinkSync(join(MEDIA_DIR, id + '.json')) } catch { /* already gone */ }
            forgetListing()
            return json(res, 200, { ok: true })
          }
          return json(res, 404, { ok: false, message: 'no such media' })
        }
        try { unlinkSync(file) } catch { /* already gone */ }
        try { unlinkSync(join(MEDIA_DIR, id + '.json')) } catch { /* already gone */ }
        forgetListing()
        return json(res, 200, { ok: true })
      }
      res.writeHead(404); res.end()
    } catch (error) {
      const msg = String(error?.message ?? error) + (error?.cause?.code ? ` (${error.cause.code})` : '')
      if (res.headersSent) { console.warn(`[media-lab] ${p} failed after the response started: ${msg.slice(0, 200)}`); try { res.end() } catch { /* already closed */ } return }
      // Any status this plugin chose deliberately, not just the two it used to name.
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500
      if (status === 429) res.setHeader?.('retry-after', '5')
      json(res, status, { ok: false, message: msg.slice(0, 400) })
    }
  }

  loadConfig()
  ctx.effect(() => { watchFile(CONFIG_FILE, { interval: 1500 }, loadConfig).unref?.(); return () => unwatchFile(CONFIG_FILE, loadConfig) }, 'dsh-media-lab: config watch')
  ctx.effect(() => () => {
    try { promptDisposer?.() } catch { /* noop */ }
    for (const dispose of toolDisposers.values()) { try { dispose() } catch { /* noop */ } }
    toolDisposers.clear()
  }, 'dsh-media-lab: dispose tools')
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-media-lab', handler: route }), 'dsh-media-lab: routes')
}

export { DEFAULT_CONFIG, KEY_ENVS, describeProviders, normalizeConfig, validateConfig }
