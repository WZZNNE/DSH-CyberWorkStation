/**
 * dsh-desktop-pet pure core: the pet document, the prompt it speaks with, expression selection,
 * proactive pacing and reminder parsing. No I/O — the host module and the tests both import this.
 */

export const PERMISSION_LEVELS = ['none', 'ask', 'full']
export const FREQUENCIES = { low: [30, 60], medium: [15, 30], high: [5, 15], chatty: [1, 5] }
export const LLM_PROVIDERS = ['openai-compatible', 'anthropic', 'gemini']
/** Whose endpoint the pet talks to: its own, or the one the harness is already configured with. */
export const LLM_SOURCES = ['own', 'harness', 'follow']
export const WINDOW_VARIANTS = ['winforms', 'webview', 'in-app']
/** Storage limits, imported by the host so the numbers live in one place. */
export const MAX_LORE = 200
export const MAX_MESSAGES = 400

/** `String({toString:1})` throws, and every one of these values came out of a JSON body. */
const str = (v, fallback = '') => {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}
const clamp = (v, min, max, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback)

/** A complete pet document from whatever the caller had. */
export function normalizePet(raw, { id } = {}) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const persona = o.persona && typeof o.persona === 'object' ? o.persona : {}
  const llm = o.llm && typeof o.llm === 'object' ? o.llm : {}
  const voice = o.voice && typeof o.voice === 'object' ? o.voice : {}
  const permissions = o.permissions && typeof o.permissions === 'object' ? o.permissions : {}
  const proactive = o.proactive && typeof o.proactive === 'object' ? o.proactive : {}
  const task = o.taskAwareness && typeof o.taskAwareness === 'object' ? o.taskAwareness : {}
  const profile = o.profile && typeof o.profile === 'object' ? o.profile : {}
  const search = o.search && typeof o.search === 'object' ? o.search : {}
  const win = o.window && typeof o.window === 'object' ? o.window : {}
  return {
    // The id names a directory and rides `--pet <id>` into the desktop host: keep it boring.
    id: (str(o.id, id ?? 'pet').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^[-_]+/, '').slice(0, 60) || 'pet'),
    // Leading dashes would be read as a flag by the desktop host's argument parser.
    name: (str(o.name, '桌宠').replace(/^[-\s]+/, '').trim() || '桌宠').slice(0, 40),
    createdAt: str(o.createdAt, new Date().toISOString()),
    persona: {
      prompt: str(persona.prompt).slice(0, 20000),
      appearance: str(persona.appearance).slice(0, 4000),
      greeting: str(persona.greeting).slice(0, 500),
      language: str(persona.language, 'auto'),
    },
    // The pet talks to its own endpoint, independent of the model the harness uses for work —
    // unless `source` says otherwise, in which case it borrows the harness's own provider (its
    // host and its key) and only picks a model from that provider's list.
    llm: {
      source: oneOf(str(llm.source), LLM_SOURCES, 'own'),
      harnessRoute: str(llm.harnessRoute).slice(0, 80),
      provider: oneOf(str(llm.provider), LLM_PROVIDERS, 'openai-compatible'),
      baseURL: str(llm.baseURL).replace(/\/+$/, ''),
      model: str(llm.model),
      keyEnv: str(llm.keyEnv, 'DESKTOP_PET_API_KEY'),
      temperature: clamp(llm.temperature, 0, 2, 0.8),
      maxTokens: clamp(llm.maxTokens, 64, 32000, 800),
      // Input budget in tokens; 0 leaves the history trimming to the message-count cap alone.
      maxInput: Math.round(clamp(llm.maxInput, 0, 1000000, 0)),
      multimodal: llm.multimodal !== false,
      // Merged into the request body as written: a reasoning model needs `{reasoning:{enabled:false}}`
      // or it spends the whole budget thinking and answers with nothing, and every gateway spells
      // its own knobs differently.
      extra: llm.extra && typeof llm.extra === 'object' && !Array.isArray(llm.extra) ? llm.extra : {},
    },
    // One saved snapshot of the custom (own) configuration per pet: restore fills the form back.
    llmPreset: o.llmPreset && typeof o.llmPreset === 'object' && !Array.isArray(o.llmPreset)
      ? {
        provider: oneOf(str(o.llmPreset.provider), LLM_PROVIDERS, 'openai-compatible'),
        baseURL: str(o.llmPreset.baseURL).replace(/\/+$/, ''),
        model: str(o.llmPreset.model),
        keyEnv: str(o.llmPreset.keyEnv, 'DESKTOP_PET_API_KEY'),
        temperature: clamp(o.llmPreset.temperature, 0, 2, 0.8),
        maxTokens: clamp(o.llmPreset.maxTokens, 64, 32000, 800),
        maxInput: Math.round(clamp(o.llmPreset.maxInput, 0, 1000000, 0)),
      }
      : null,
    // How the pet's lorebook relates to the control deck's world info: `override` reads only the
    // pet's own entries; `coexist` evaluates both books into the pet's prompt. Neither mode
    // touches the deck itself — the pet only ever reads it.
    lorebook: normalizeLorebookSettings(o.lorebook),
    voice: {
      enabled: voice.enabled === true,
      mode: oneOf(str(voice.mode), ['push', 'always'], 'push'),
      autoSpeak: voice.autoSpeak !== false,
      ttsVoice: str(voice.ttsVoice),
      sttLanguage: str(voice.sttLanguage),
    },
    expressions: normalizeSprites(o.expressions, 'expressions'),
    actions: normalizeSprites(o.actions, 'actions'),
    permissions: {
      screen: oneOf(str(permissions.screen), PERMISSION_LEVELS, 'ask'),
      control: oneOf(str(permissions.control), PERMISSION_LEVELS, 'none'),
    },
    proactive: {
      enabled: proactive.enabled === true,
      frequency: oneOf(str(proactive.frequency), Object.keys(FREQUENCIES), 'low'),
      screenshotFirst: proactive.screenshotFirst === true,
      workRatio: clamp(proactive.workRatio, 0, 1, 0.5),
      quietWhileBusy: proactive.quietWhileBusy !== false,
    },
    taskAwareness: {
      enabled: task.enabled !== false,
      announceStart: task.announceStart !== false,
      announceEnd: task.announceEnd !== false,
      longTaskMinutes: clamp(task.longTaskMinutes, 0, 240, 30),
    },
    profile: {
      enabled: profile.enabled === true,
      text: str(profile.text).slice(0, 8000),
      updatedAt: str(profile.updatedAt),
      sessionsRead: clamp(profile.sessionsRead, 0, 100000, 0),
    },
    personaScope: oneOf(str(o.personaScope), ['pet', 'global'], 'pet'),
    // What the pet's conversation list is called in the sidebar. The owner names it; several pets
    // each get their own heading, which is the only way to tell two of them apart at a glance.
    chatsLabel: str(o.chatsLabel).slice(0, 40),
    theme: normalizeTheme(o.theme),
    // Set when a program wrote this pet's prompt text; cleared when the owner saves it from the
    // panel. Durable, because the text it marks is durable.
    promptWrittenByProgram: o.promptWrittenByProgram === true,
    search: { mode: oneOf(str(search.mode), ['follow', 'own', 'off'], 'follow'), provider: str(search.provider) },
    window: {
      variant: oneOf(str(win.variant), WINDOW_VARIANTS, 'in-app'),
      width: clamp(win.width, 80, 2000, 220),
      height: clamp(win.height, 80, 2000, 260),
      x: clamp(win.x, -10000, 20000, -1),
      y: clamp(win.y, -10000, 20000, -1),
      opacity: clamp(win.opacity, 0.1, 1, 1),
      alwaysOnTop: win.alwaysOnTop !== false,
      bubbleSeconds: clamp(win.bubbleSeconds, 2, 120, 12),
    },
  }
}

/**
 * How the pet's speech looks, wherever it speaks: the bubble in the desktop window, the pet page and
 * the floating pet in dsh all build their styling from this one block, so a pet looks like itself on
 * every surface. Colours are #rrggbb; `opacity` and `blur` are what make it glass rather than a box.
 */
const HEX = /^#[0-9a-fA-F]{6}$/
// Opaque by default. Translucency belongs behind text, never under it: a frosted bubble over a
// busy wallpaper is unreadable, and the frosted field you type into is worse. Both are one preset
// away for anyone who wants them.
const DEFAULT_THEME = { bg: '#141821', text: '#e9edf6', accent: '#6aa3ff', radius: 16, blur: 0, opacity: 1, fontSize: 13, ui: 'plain', slice: 28 }

export const UI_LOOKS = ['plain', 'art']

export function normalizeTheme(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const colour = (v, fallback) => (HEX.test(str(v)) ? str(v).toLowerCase() : fallback)
  return {
    // `plain` draws the bubble with colour and blur; `art` draws it with the pieces the image
    // model made, stretched as a nine-slice so one drawing fits any sentence.
    ui: oneOf(str(o.ui), UI_LOOKS, 'plain'),
    // How far in from each edge of those drawings the stretchable middle starts, in per cent.
    slice: Math.round(clamp(o.slice, 8, 45, 28)),
    bg: colour(o.bg, DEFAULT_THEME.bg),
    text: colour(o.text, DEFAULT_THEME.text),
    accent: colour(o.accent, DEFAULT_THEME.accent),
    radius: Math.round(clamp(o.radius, 0, 28, DEFAULT_THEME.radius)),
    // 0 turns the frosting off, which is what a machine with no compositor wants.
    blur: Math.round(clamp(o.blur, 0, 40, DEFAULT_THEME.blur)),
    opacity: Math.round(clamp(o.opacity, 0.25, 1, DEFAULT_THEME.opacity) * 100) / 100,
    fontSize: Math.round(clamp(o.fontSize, 10, 20, DEFAULT_THEME.fontSize)),
  }
}

/** `#rrggbb` + alpha as a CSS colour, for the surfaces that draw the bubble themselves. */
export function themeCss(theme) {
  const t = normalizeTheme(theme)
  const rgb = [1, 3, 5].map(i => parseInt(t.bg.slice(i, i + 2), 16)).join(', ')
  return {
    ...t,
    bubble: `rgba(${rgb}, ${t.opacity})`,
    glass: t.blur > 0 ? `blur(${t.blur}px) saturate(1.6)` : 'none',
  }
}

/**
 * The motions a sprite can be given. Each is a CSS animation the pet window and the in-app pet both
 * carry, applied to the drawing while that sprite is showing. It is the fallback for a sprite with
 * a single drawing; a sprite with real frames plays those instead.
 *
 *   breathe  slow chest-lift, for idle / resting        sway     lazy side-to-side
 *   bob      light up-and-down, for cheerful lines      nod      thinking, small forward dips
 *   shake    tight tremor, for anger                    burst    hard shake with a scale kick
 *   pop      squash-and-stretch, for a joke             wobble   loose rocking, for silliness
 *   stretch  a long yawn-and-reach                      sleep    very slow, very small breathing
 */
export const MOTIONS = ['none', 'breathe', 'bob', 'nod', 'sway', 'shake', 'burst', 'pop', 'wobble', 'stretch', 'sleep']

/**
 * A frame animation is a numbered run of drawings next to the sprite's own file: `rest.png` is
 * frame 1 and `rest-02.png … rest-24.png` are the rest of them, served by `/sprite?frame=N`.
 * `MAX_FRAMES` is the ceiling the owner's frame count is clamped to; 24 frames at 12fps is two
 * seconds of animation, which is as much as a desktop pet ever needs for one mood.
 */
export const MAX_FRAMES = 24
export const LOOPS = ['pingpong', 'forward']

/** The file name of frame `n` (1-based) of a sprite whose first frame is `asset`. */
export function frameName(asset, n) {
  const raw = String(asset ?? '')
  const index = Number(n)
  if (!raw || !Number.isFinite(index) || index <= 1) return raw
  const dot = raw.lastIndexOf('.')
  const stem = dot > 0 ? raw.slice(0, dot) : raw
  const ext = dot > 0 ? raw.slice(dot) : ''
  return `${stem}-${String(Math.floor(index)).padStart(2, '0')}${ext}`
}

function normalizeSprites(raw, kind) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  const seen = new Set()
  for (const item of list.slice(0, 200)) {
    const o = item && typeof item === 'object' ? item : { name: str(item) }
    // Leading dashes stripped for the same reason the pet's own name strips them: sprite names now
    // ride the desktop host's command line (--sprite <name>), whose parser reads "--…" as a flag —
    // an expression named "--port" would rebind the port and orphan the window.
    const name = str(o.name).trim().replace(/^[-\s]+/, '').trim().slice(0, 40)
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({
      name,
      asset: str(o.asset).slice(0, 300),
      when: str(o.when).slice(0, 300),
      // How the drawing moves while this sprite is showing, when there is only one of them: a named
      // CSS animation the surfaces apply to the still image. `none` leaves it still.
      motion: oneOf(str(o.motion), MOTIONS, 'none'),
      // How many drawings this sprite actually has. 1 is a still image with `motion` over it;
      // anything more is a real frame animation, played at `fps` and looped by `loop`.
      // Whole drawings and whole frames per second: a fraction would reach three surfaces that each
      // round it their own way, and they would not agree on which drawing is showing.
      frames: Math.round(clamp(o.frames, 1, MAX_FRAMES, 1)),
      fps: Math.round(clamp(o.fps, 1, 30, 12)),
      // A drawn run rarely ends where it began, so the default plays it forwards and then back:
      // that always joins seamlessly, where `forward` needs frames drawn to loop on purpose.
      loop: oneOf(str(o.loop), LOOPS, 'pingpong'),
      kind: kind === 'actions' ? 'action' : 'expression',
    })
  }
  return out
}

/** The whole deployment: pets plus the switches that are not per pet. */
/** A roster this side of "the panel is usable"; every write re-normalises and re-saves all of it. */
export const MAX_PETS = 40

export function normalizeConfig(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const pets = Array.isArray(o.pets) ? o.pets.slice(0, MAX_PETS).map((p, i) => normalizePet(p, { id: `pet-${i + 1}` })) : []
  const activeId = pets.some(p => p.id === o.activeId) ? o.activeId : pets[0]?.id ?? ''
  return {
    enabled: o.enabled === true,
    activeId,
    pets,
    // The desktop window is started on demand; this only records what the user chose last.
    autoStartWindow: o.autoStartWindow === true,
    media: { useMediaLab: o.media?.useMediaLab !== false },
  }
}

/** Milliseconds until the next proactive line, uniformly inside the band for the chosen frequency. */
export function pickInterval(frequency, random = Math.random) {
  const [lo, hi] = FREQUENCIES[frequency] ?? FREQUENCIES.low
  return Math.round((lo + random() * (hi - lo)) * 60000)
}

const EXPR_TAG = /\[(?:expr|expression|表情)\s*[:：]\s*([^\]]{1,40})\]/i
const ACTION_TAG = /\[(?:action|act|动作)\s*[:：]\s*([^\]]{1,40})\]/i
const EXPR_TAG_ALL = new RegExp(EXPR_TAG.source, 'gi')
const ACTION_TAG_ALL = new RegExp(ACTION_TAG.source, 'gi')

/**
 * Pull the expression/action the pet asked for out of its reply and hand back the clean text.
 * Unknown names are kept as requests (the window falls back to the default sprite) so a pet can
 * invent moods without the plugin having to know them.
 */
/**
 * Split a reply into what the speech provider hears and what the owner sees.
 *
 * Fish Audio's S2 line performs `[tag]` markers instead of reading them (docs.fish.audio's emotion
 * reference), so the tags have to survive all the way to the TTS request — and must never reach the
 * chat bubble, where they would just be noise. Anything that is not a marker is left alone: a
 * bracket in ordinary text (`[1]`, `[图]`) is only treated as a marker when it holds a short run
 * with no punctuation, which is what a marker is.
 */
export function splitVoiceTags(text) {
  const spoken = str(text)
  // Removed outright rather than replaced with a space: CJK text has no spaces to preserve, and a
  // run of spaces left behind in Latin text is collapsed below.
  const isMarker = inner => /\p{L}/u.test(inner) && !/[。！？!?,，.、:：;；]/.test(inner)
  const visible = spoken.replace(/\[([^\][\n]{1,24})\]/g, (whole, inner) => (isMarker(inner) ? '' : whole))
  return { spoken, visible: visible.replace(/[ \t]{2,}/g, ' ').trim() }
}

export function readReply(text, pet) {
  const raw = str(text)
  const expr = EXPR_TAG.exec(raw)?.[1]?.trim()
  const action = ACTION_TAG.exec(raw)?.[1]?.trim()
  let clean = raw
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass++) {
    const before = clean
    clean = clean.replace(EXPR_TAG_ALL, ' ').replace(ACTION_TAG_ALL, ' ')
    if (clean === before) break
  }
  clean = clean.replace(SHAPE_OPENER_RE, ' ').replace(/[ \t]{2,}/g, ' ').trim()
  const known = name => (pet?.expressions ?? []).concat(pet?.actions ?? []).find(e => e.name.toLowerCase() === String(name).toLowerCase())
  const sprite = known(expr) ?? known(action)
  return {
    text: clean,
    expression: expr ?? '',
    action: action ?? '',
    // The name of the sprite that actually resolved. Pushing the raw expression tag instead sent
    // surfaces asking /sprite for a name the pet invented — 404, and a blanked pet — while the
    // frame count they were told belonged to the action that DID resolve.
    shownName: sprite?.name ?? expr ?? action ?? '',
    sprite: sprite?.asset ?? '',
    // How to play it travels with the name, so no surface has to look the sprite up again.
    motion: sprite?.motion ?? 'none',
    frames: sprite?.frames ?? 1,
    fps: sprite?.fps ?? 12,
    loop: sprite?.loop ?? 'pingpong',
  }
}

/**
 * The pet has no tool-calling loop of its own (any small multimodal model can drive it), so it
 * asks for things with tags. Everything the pet may do is one of these, and every one of them is
 * checked against the permissions before it runs.
 */
export const INTENT_TAGS = ['screen', 'click', 'type', 'key', 'scroll', 'image', 'search', 'remind', 'speak']
export const CONTROL_TAGS = ['click', 'type', 'key', 'scroll']
// 1500, not 400: an `[image:…]` prompt that carries the pet's own appearance description is longer
// than that, and a tag too long to match was swept down to a mangled remnant in the visible text
// instead of drawing anything.
const INTENT_RE = new RegExp(`\\[(${INTENT_TAGS.join('|')})(?:\\s*[:：]\\s*([^\\]]{0,1500}))?\\]`, 'gi')
// Whatever survives the stripping loop is not a tag any more — but it can still LOOK like one,
// and a live `[click:5,5]` left in the visible text would be read back as one on the next turn.
// Deeply nested shapes (`[click[click[click…`) peel one layer per pass, so the loop is bounded and
// this sweep removes whatever opener the bound left behind.
const INTENT_OPENER_RE = new RegExp(`\\[\\s*(?:${INTENT_TAGS.join('|')})\\b`, 'gi')
const SHAPE_OPENER_RE = /\[\s*(?:expr|expression|表情|action|act|动作)\b/gi
const MAX_STRIP_PASSES = 12

/** Pull the tags out of a reply; the visible text keeps none of them. */
export function parseIntents(text) {
  const intents = []
  // To a fixed point: `[cli[click:1,2]ck:400,400]` would otherwise leave a live `[click:400,400]`
  // behind after one pass — both in what the user sees and in what the next turn reads back.
  let clean = str(text)
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass++) {
    const before = clean
    clean = clean.replace(INTENT_RE, (_m, kind, arg) => {
      intents.push({ kind: String(kind).toLowerCase(), arg: String(arg ?? '').trim() })
      return ' '
    })
    if (clean === before) break
  }
  return { text: clean.replace(INTENT_OPENER_RE, ' ').replace(/[ \t]{2,}/g, ' ').trim(), intents }
}

/** `x,y` for a click/move tag; null when the pet wrote something else. */
export function parsePoint(arg) {
  const m = /^\s*(-?\d{1,5})\s*[,，\s]\s*(-?\d{1,5})\s*$/.exec(str(arg))
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null
}

/** "1小时后提醒我喝水" / "in 30 minutes stand up" / "20:30 开会" → an absolute time plus the text. */
export function parseSchedule(text, now = new Date()) {
  const raw = str(text).trim()
  if (!raw) return null
  const base = now instanceof Date ? now.getTime() : Number(now)
  const rel = /(?:^|[\s,，]|(?<=[\u4e00-\u9fff]))(?:in\s+)?(?:(\d+(?:\.\d+)?)\s*(小时|分钟|秒|钟头|hours?|hrs?|minutes?|mins?|seconds?|secs?)\s*(?:后|later|from now)?)/i.exec(raw)
  if (rel) {
    const amount = Number(rel[1])
    const unit = rel[2].toLowerCase()
    const ms = /小时|钟头|hour|hr/.test(unit) ? amount * 3600000 : /分钟|min/.test(unit) ? amount * 60000 : amount * 1000
    const at = new Date(base + ms)
    if (Number.isNaN(at.getTime())) return null
    return { at: at.toISOString(), text: cleanTask(raw.replace(rel[0], ' ')), in: ms }
  }
  const abs = /(?:^|[\s,，]|(?<=[\u4e00-\u9fff]))(?:(明天|tomorrow)\s*)?(\d{1,2})\s*[:：点]\s*(\d{1,2})?/.exec(raw)
  if (abs) {
    const d = new Date(base)
    const hour = Number(abs[2])
    const minute = Number(abs[3] ?? 0)
    if (hour > 23 || minute > 59) return null
    d.setSeconds(0, 0)
    d.setHours(hour, minute)
    if (abs[1]) d.setDate(d.getDate() + 1)
    else if (d.getTime() <= base) d.setDate(d.getDate() + 1)
    return { at: d.toISOString(), text: cleanTask(raw.replace(abs[0], ' ')), in: d.getTime() - base }
  }
  return null
}
const cleanTask = t => t.replace(/^[\s,，]*(?:在\s*)?(?:提醒我|叫我|记得|remind me to|remind me)?\s*/i, '').replace(/\s{2,}/g, ' ').trim()

/** Reminders that are due, and the list with them removed. */
export function dueSchedules(schedules, now = Date.now()) {
  const list = Array.isArray(schedules) ? schedules : []
  const due = list.filter(s => Date.parse(s.at) <= now)
  return { due, rest: list.filter(s => !due.includes(s)) }
}

/**
 * The pet's system prompt: who it is, what it looks like, what it may do, what it knows about the
 * user and what the harness is doing right now.
 */
export function buildSystemPrompt({ pet, lore = [], task = null, now = new Date(), tools = {} } = {}) {
  const p = pet ?? normalizePet(null)
  const lines = []
  lines.push(p.persona.prompt || `你是「${p.name}」,用户桌面上的一只小宠物。用短句说话,别啰嗦。`)
  if (p.persona.appearance) lines.push(`【你的外观】${p.persona.appearance}\n(需要给自己画图/生成新表情时,把这段外观描述写进提示词,保持形象一致。)`)
  if (p.persona.language && p.persona.language !== 'auto') lines.push(`【语言】始终用${p.persona.language}回答。`)
  const sprites = p.expressions.concat(p.actions)
  if (sprites.length > 0) {
    lines.push(`【表情/动作】每次回复都要以 [expr:名字] 或 [action:名字] 开头,挑一个最贴合这句话的,别重复用同一个。可用的有:${sprites.map(s => s.name + (s.when ? `(${s.when})` : '')).join('、')}。标记会被剥掉,不会显示给主人。`)
  }
  if (lore.length > 0) {
    // No count cap here: the caller hands over an activated, budget-trimmed list, and slicing it
    // again would cut exactly the highest-order entries the budget ranked to keep.
    lines.push('【设定集(世界书)】\n' + lore.map(e => `- ${e.key ? e.key + ': ' : ''}${e.content}`).join('\n'))
  }
  if (p.profile.enabled && p.profile.text) lines.push('【你记得的主人】\n' + p.profile.text)
  if (task && p.taskAwareness.enabled) {
    lines.push(`【主人现在的工作】${describeTask(task)}`)
  }
  const abilities = []
  if (p.permissions.screen !== 'none') abilities.push(`[screen] 看一眼屏幕(${p.permissions.screen === 'ask' ? '每次都要主人点同意' : '已授权,直接看'});看完会把截图给你,你再接着说`)
  if (p.permissions.control !== 'none') {
    abilities.push(`[click:x,y]、[type:要打的字]、[key:ctrl+s]、[scroll:3] 操作电脑(${p.permissions.control === 'ask' ? '每次都要主人点同意' : '已授权'})`)
  }
  if (tools.voiceTags) {
    // docs.fish.audio/api-reference/emotion-reference: the S2 line (s2-pro, s2.1-pro, drama3) reads
    // `[tag]` markers inline and accepts free-form descriptions; they are performed, not spoken.
    lines.push([
      '【语气标记】你的声音走 Fish Audio,它认识写在句子里的方括号标记,会照着演,标记本身不会被念出来,也不会显示给主人。',
      '每句话至少带一个,放在要生效的那一句前面:',
      '- 情绪:[happy] [sad] [angry] [excited] [calm] [nervous] [confident] [surprised] [satisfied] [scared] [worried] [frustrated] [proud] [relaxed] [curious] [sarcastic] [disdainful] [doubtful] [disappointed] [determined]',
      '- 语气:[hurried] [shouting] [whispering] [soft] [emphasis]',
      '- 声音效果:[laughing] [chuckling] [sighing] [groaning] [panting] [gasping] [yawning] [clear throat] [short pause] [long pause]',
      '- 也可以自己写,比如 [压低嗓子坏笑] [憋着笑]——它认自然语言描述。',
      '例:[chuckling]胖爷我跟你讲,[emphasis]这地方我熟。',
    ].join('\n'))
  }
  if (tools.image) abilities.push('[image:英文提示词] 生成一张图')
  if (tools.tts) abilities.push('[speak] 把这句话念出来')
  if (tools.search) abilities.push('[search:关键词] 联网搜一下')
  abilities.push('[remind:1小时后 站起来动动] 定个提醒')
  lines.push([
    '【你能做的事】只能通过下面这些标记,写在回复里就会执行,标记本身不会显示给主人:',
    ...abilities.map(a => '- ' + a),
    '一次最多用一个标记;做不到的事直接说做不到,不要假装。',
  ].join('\n'))
  if (p.permissions.screen === 'none' && p.permissions.control === 'none') {
    lines.push('注意:看屏幕和操作电脑都没被授权,主人问起就说“没给我权限”。')
  }
  lines.push(`【现在】${now.toISOString()}(本地 ${new Date(now).toLocaleString()})。别编造你没看到的东西;不知道就说不知道。`)
  return lines.join('\n\n')
}

function describeTask(task) {
  const bits = []
  if (task.title) bits.push(`会话「${task.title}」`)
  if (task.status) bits.push(`状态 ${task.status}`)
  if (task.lastTool) bits.push(`刚用了 ${task.lastTool}`)
  if (task.turns) bits.push(`已经聊了 ${task.turns} 轮`)
  return bits.length > 0 ? bits.join(',') : '暂时看不出来'
}

/** The user-side line for a proactive ping: half work, half small talk, decided by workRatio. */
export function proactiveSeed({ pet, task, random = Math.random, hasScreenshot = false } = {}) {
  const wantsWork = task && random() < (pet?.proactive.workRatio ?? 0.5)
  if (wantsWork) {
    return [
      '(系统:该主动搭话了。主人正在干活:',
      describeTask(task),
      hasScreenshot ? ';另外附了一张屏幕截图,你可以看看他在做什么' : '',
      '。说一句短的、跟这件事有关的话——关心、提醒或者吐槽都行,别打断他,不要提问式追问。)',
    ].join('')
  }
  return `(系统:该主动搭话了${hasScreenshot ? ',附了一张屏幕截图' : ''}。随便聊点轻松的,一两句话就好,别问“需要我帮忙吗”这种客套话。)`
}

/** The last N messages of a pet conversation (the older ones are simply dropped). */
export function trimMessages(messages, max = 40) {
  const list = Array.isArray(messages) ? messages : []
  if (list.length <= max) return list
  return list.slice(list.length - max)
}

// ── lorebook ────────────────────────────────────────────────────────────────

export const LORE_MODES = ['override', 'coexist']
export const LORE_LOGIC = ['andAny', 'andAll', 'notAny', 'notAll']

export function normalizeLorebookSettings(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  return {
    mode: oneOf(str(o.mode), LORE_MODES, 'override'),
    scanDepth: Math.round(clamp(o.scanDepth, 0, 50, 6)),
    budgetChars: Math.round(clamp(o.budgetChars, 200, 50000, 6000)),
    caseSensitive: o.caseSensitive === true,
    matchWholeWords: o.matchWholeWords === true,
  }
}

const strList = (v, cap = 50) => (Array.isArray(v) ? v.map(x => str(x).trim()).filter(Boolean).slice(0, cap) : [])
const triBool = v => (v === true ? true : v === false ? false : null)

/**
 * One lorebook entry with the full parameter set. The old shape ({key, content, always}) maps
 * cleanly: `always: false` was the only way to switch an entry off, and an entry without
 * keywords can only be constant — which is exactly what every old entry was.
 */
export function normalizeLoreEntry(raw) {
  const e = raw && typeof raw === 'object' ? raw : {}
  const keywords = strList(e.keywords ?? e.keys)
  return {
    key: str(e.key ?? e.name).slice(0, 80),
    content: str(e.content).slice(0, 4000),
    enabled: e.enabled !== undefined ? e.enabled !== false : e.always !== false,
    constant: e.constant !== undefined ? e.constant === true : keywords.length === 0,
    keywords,
    secondaryKeys: strList(e.secondaryKeys ?? e.secondary),
    selectiveLogic: oneOf(str(e.selectiveLogic), LORE_LOGIC, 'andAny'),
    caseSensitive: triBool(e.caseSensitive),      // null = book-level setting
    matchWholeWords: triBool(e.matchWholeWords),  // null = book-level setting
    probability: Math.round(clamp(e.probability, 0, 100, 100)),
    order: Math.round(clamp(e.order, -100000, 100000, 100)),
    scanDepth: e.scanDepth === undefined || e.scanDepth === null || e.scanDepth === '' ? null : Math.round(clamp(e.scanDepth, 0, 50, 6)),
  }
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Does `key` appear in `text`? A `/pattern/flags` key is a regex, the same convention the
 * control deck reads (so a coexisting deck entry keeps firing); a bad pattern falls back to
 * literal matching rather than killing the entry. Whole-word only means something for Latin
 * words; CJK keys substring-match.
 */
export function loreKeyHit(key, text, { caseSensitive = false, matchWholeWords = false } = {}) {
  const needle = str(key)
  if (!needle) return false
  const hay = str(text)
  // The deck's charset exactly: `/home/user` has "user" for flags, is NOT a regex there, and
  // must not become one here. Flags ride the pattern as written (no book-level `i` added), so a
  // deck key matches the same text in both engines; g/y are dropped as stateful, not meaningful.
  const asRegex = /^\/(.+)\/([gimsuy]*)$/.exec(needle)
  if (asRegex) {
    try {
      const flags = [...new Set(asRegex[2].split(''))].filter(f => 'imsu'.includes(f)).join('')
      return new RegExp(asRegex[1], flags).test(hay)
    } catch { /* not a usable pattern: match it as the literal text it is */ }
  }
  if (matchWholeWords && /^[\w'-]+$/.test(needle)) {
    return new RegExp(`\\b${escapeRe(needle)}\\b`, caseSensitive ? '' : 'i').test(hay)
  }
  return caseSensitive ? hay.includes(needle) : hay.toLowerCase().includes(needle.toLowerCase())
}

/**
 * Which entries speak this turn. `messages` is the recent conversation (oldest first) and
 * `currentText` the line being answered; each entry scans its own window (scanDepth), constant
 * entries always fire, keyword entries need a primary hit plus whatever `selectiveLogic` asks of
 * the secondary keys, `probability` rolls once per entry, and the budget keeps the highest-order
 * entries when the book is too fat. The returned list is in ascending `order`.
 */
export function activateLore(entries, { messages = [], currentText = '', settings, rng = Math.random } = {}) {
  const book = normalizeLorebookSettings(settings)
  const list = (Array.isArray(entries) ? entries : []).map(normalizeLoreEntry)
    .filter(e => e.enabled && e.content.length > 0 && (e.constant || e.keywords.length > 0))
  const texts = (Array.isArray(messages) ? messages : []).map(m => str(typeof m === 'string' ? m : m?.text)).filter(Boolean)
  const scanFor = depth => [...texts.slice(texts.length - Math.max(0, depth)), str(currentText)].join('\n')
  const hits = []
  for (const e of list) {
    if (!e.constant) {
      const opts = {
        caseSensitive: e.caseSensitive ?? book.caseSensitive,
        matchWholeWords: e.matchWholeWords ?? book.matchWholeWords,
      }
      const scan = scanFor(e.scanDepth ?? book.scanDepth)
      if (!e.keywords.some(k => loreKeyHit(k, scan, opts))) continue
      if (e.secondaryKeys.length > 0) {
        const hit = e.secondaryKeys.filter(k => loreKeyHit(k, scan, opts)).length
        const ok = e.selectiveLogic === 'andAny' ? hit > 0
          : e.selectiveLogic === 'andAll' ? hit === e.secondaryKeys.length
            : e.selectiveLogic === 'notAny' ? hit === 0
              : hit < e.secondaryKeys.length // notAll
        if (!ok) continue
      }
    }
    if (e.probability < 100 && rng() * 100 >= e.probability) continue
    hits.push(e)
  }
  // Budget by priority (constant first, then higher order); output in ascending order so the
  // book reads the way the owner sorted it. The top-priority entry is admitted even when it
  // alone exceeds the budget — an activated book that injects nothing at all would be worse
  // than one oversized entry.
  const ranked = [...hits].sort((a, b) => (Number(b.constant) - Number(a.constant)) || (b.order - a.order))
  const kept = new Set()
  let used = 0
  for (const e of ranked) {
    if (used + e.content.length > book.budgetChars && kept.size > 0) continue
    used += e.content.length
    kept.add(e)
  }
  return hits.filter(e => kept.has(e)).sort((a, b) => a.order - b.order)
}

// ── input budget ────────────────────────────────────────────────────────────

/**
 * Rough token estimate: CJK / Hangul / kana / fullwidth forms and every astral character count
 * about one token each, Latin-ish text about four characters a token. Counted in code points so
 * an emoji is one heavy character, not two light ones.
 */
export function estimateTokens(text) {
  const s = str(text)
  let heavy = 0
  let total = 0
  for (const ch of s) {
    total++
    const cp = ch.codePointAt(0)
    if ((cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x3000 && cp <= 0x9FFF) || (cp >= 0xAC00 && cp <= 0xD7AF)
      || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFF00 && cp <= 0xFFEF) || cp > 0xFFFF) heavy++
  }
  return heavy + Math.ceil((total - heavy) / 4)
}

/**
 * Drop the oldest turns until system + history fit `maxInput` tokens. 0 means no budget. The
 * newest message always survives — a budget smaller than the current line still has to send it.
 */
export function applyInputBudget(messages, systemText, maxInput) {
  const list = Array.isArray(messages) ? messages : []
  const budget = Math.round(clamp(maxInput, 0, 1000000, 0))
  if (budget === 0 || list.length === 0) return list
  const fixed = estimateTokens(systemText)
  let out = [...list]
  let total = fixed + out.reduce((n, m) => n + estimateTokens(m?.text) + 4, 0)
  while (out.length > 1 && total > budget) {
    total -= estimateTokens(out[0]?.text) + 4
    out = out.slice(1)
  }
  return out
}
