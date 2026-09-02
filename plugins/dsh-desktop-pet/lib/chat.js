/**
 * The pet's own chat endpoint — deliberately separate from the model the harness works with, so a
 * cheap multimodal model can drive the pet while the expensive one writes code.
 *
 * Three wire formats, all with image support (screenshots and uploaded material):
 *   openai-compatible — POST {baseURL}/v1/chat/completions, content parts `{type:'image_url'}`
 *                       (github.com/openai/openai-openapi); covers OpenAI, OpenRouter, DeepSeek,
 *                       SiliconFlow, Groq, LM Studio, Ollama's /v1 and most gateways.
 *   anthropic        — POST {baseURL}/v1/messages with `x-api-key` + `anthropic-version: 2023-06-01`
 *                       and `{type:'image', source:{type:'base64', media_type, data}}`
 *                       (platform.claude.com/docs/en/api/messages).
 *   gemini           — POST {baseURL}/v1beta/models/{model}:generateContent with `x-goog-api-key`,
 *                       `contents[].parts[].inline_data` and `systemInstruction`
 *                       (ai.google.dev/api/generate-content).
 */

const ANTHROPIC_VERSION = '2023-06-01'

const readPath = (value, path) => {
  let cur = value
  for (const part of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : cur[part]
  }
  return cur
}

/** `{ role: 'user'|'assistant', text, images: [{ base64, mime }] }` → provider content. */
function partsFor(provider, message) {
  const images = Array.isArray(message.images) ? message.images.filter(i => i && typeof i.base64 === 'string') : []
  if (images.length === 0) return message.text ?? ''
  if (provider === 'anthropic') {
    return [
      ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime ?? 'image/png', data: i.base64 } })),
      { type: 'text', text: message.text ?? '' },
    ]
  }
  if (provider === 'gemini') {
    return [
      { text: message.text ?? '' },
      ...images.map(i => ({ inline_data: { mime_type: i.mime ?? 'image/png', data: i.base64 } })),
    ]
  }
  return [
    { type: 'text', text: message.text ?? '' },
    ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime ?? 'image/png'};base64,${i.base64}` } })),
  ]
}

const DEFAULT_BASE = {
  'openai-compatible': 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
}

/** Build the one request this turn needs. Exported for the tests. */
export function buildRequest({ llm, system, messages, key }) {
  const provider = llm.provider ?? 'openai-compatible'
  // Every branch below appends its own versioned path, so a base that already ends in /v1 — which
  // is how LM Studio, Ollama and most local servers print their address — would otherwise become
  // /v1/v1/chat/completions.
  const base = (llm.baseURL || DEFAULT_BASE[provider] || '').replace(/\/+$/, '').replace(/\/v1$/, '')
  const list = Array.isArray(messages) ? messages : []
  if (provider === 'anthropic') {
    return {
      url: base + '/v1/messages',
      headers: { 'content-type': 'application/json', 'x-api-key': key ?? '', 'anthropic-version': ANTHROPIC_VERSION },
      body: {
        model: llm.model,
        max_tokens: llm.maxTokens ?? 800,
        temperature: llm.temperature ?? 0.8,
        system,
        messages: list.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: partsFor(provider, m) })),
      },
    }
  }
  if (provider === 'gemini') {
    return {
      url: `${base}/v1beta/models/${encodeURIComponent(llm.model)}:generateContent`,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key ?? '' },
      body: {
        contents: list.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toParts(partsFor(provider, m)) })),
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { temperature: llm.temperature ?? 0.8, maxOutputTokens: llm.maxTokens ?? 800 },
      },
    }
  }
  const headers = { 'content-type': 'application/json' }
  if (key) headers.authorization = `Bearer ${key}`
  return {
    url: base + '/v1/chat/completions',
    headers,
    body: {
      model: llm.model,
      temperature: llm.temperature ?? 0.8,
      max_tokens: llm.maxTokens ?? 800,
      messages: [{ role: 'system', content: system }, ...list.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: partsFor(provider, m) }))],
      ...(llm.extra && typeof llm.extra === 'object' ? llm.extra : {}),
    },
  }
}
const toParts = content => (typeof content === 'string' ? [{ text: content }] : content)

/** The reply text out of any of the three response shapes. */
export function readReplyText(provider, json) {
  if (provider === 'anthropic') {
    const blocks = readPath(json, 'content')
    if (Array.isArray(blocks)) return blocks.filter(b => b?.type === 'text').map(b => b.text).join('').trim()
    return ''
  }
  if (provider === 'gemini') {
    const parts = readPath(json, 'candidates.0.content.parts')
    if (Array.isArray(parts)) return parts.map(p => p?.text ?? '').join('').trim()
    return ''
  }
  const content = readPath(json, 'choices.0.message.content')
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map(c => (typeof c === 'string' ? c : c?.text ?? '')).join('').trim()
  return ''
}

/** Provider error text, whatever envelope it came in. */
export function readError(json, status) {
  const m = readPath(json, 'error.message') ?? readPath(json, 'error') ?? readPath(json, 'message') ?? readPath(json, 'detail')
  const text = typeof m === 'string' ? m : m === undefined ? '' : JSON.stringify(m)
  return `HTTP ${status}${text ? ': ' + text.slice(0, 300) : ''}`
}

const isLocal = url => { try { const h = new URL(String(url)).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '::1' } catch { return false } }

/** One turn. Returns the reply text; throws with the provider's own message when it fails. */
export async function chat({ llm, system, messages, key, fetchImpl = fetch, signal, timeoutMs = 90000 }) {
  if (!llm?.model) throw new Error('桌宠尚未配置模型(设置 → 桌宠 → 对话模型)')
  const request = buildRequest({ llm, system, messages, key })
  if (!request.url.startsWith('http')) throw new Error('桌宠尚未配置 API 地址(设置 → 桌宠 → 对话模型)')
  if (!key && !isLocal(request.url)) throw new Error(`桌宠尚未配置 API 密钥(${llm.keyEnv ?? 'DESKTOP_PET_API_KEY'};设置 → 桌宠 → 对话模型)`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener?.('abort', onAbort)
  try {
    const response = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal })
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch { json = { message: text.slice(0, 300) } }
    if (response.status >= 400) throw new Error(readError(json, response.status))
    const reply = readReplyText(llm.provider ?? 'openai-compatible', json)
    if (!reply) throw new Error('模型接口返回了空回复')
    return { text: reply, usage: json?.usage }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onAbort)
  }
}
