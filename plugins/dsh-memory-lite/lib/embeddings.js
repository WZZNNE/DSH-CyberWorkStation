/**
 * Optional vector recall through an OpenAI-compatible `POST /v1/embeddings` endpoint
 * (LM Studio and Ollama both serve it locally). Request: { model, input: string[] };
 * reply: { data: [{ index, embedding: number[] }] }.
 */

const TIMEOUT_MS = 30000
const MAX_BATCH = 32
const MAX_INPUT_CHARS = 4000

/**
 * Embed texts in batches.
 * @param {{ baseURL: string, model: string }} cfg
 * @param {string[]} texts
 * @param {{ apiKey?: string, signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<number[][]>} one vector per text, in order
 */
export async function embedTexts(cfg, texts, opts = {}) {
  const url = String(cfg.baseURL ?? '').replace(/\/+$/, '') + '/embeddings'
  if (!/^https?:\/\//i.test(url)) throw new Error('embeddings.baseURL must be an http(s) URL ending in /v1')
  if (!cfg.model) throw new Error('embeddings.model is empty')
  const out = []
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH).map(t => String(t ?? '').slice(0, MAX_INPUT_CHARS) || ' ')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('embeddings request timed out')), Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : TIMEOUT_MS)
    const onAbort = () => controller.abort(opts.signal?.reason)
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
        body: JSON.stringify({ model: cfg.model, input: batch }),
        signal: controller.signal,
      })
      const body = await r.text()
      if (!r.ok) throw new Error(`embeddings endpoint answered ${r.status}: ${body.slice(0, 200)}`)
      let json
      try { json = JSON.parse(body) } catch { throw new Error('embeddings endpoint returned non-JSON') }
      const data = Array.isArray(json?.data) ? json.data : null
      if (!data || data.length !== batch.length) throw new Error(`embeddings endpoint returned ${data ? data.length : 'no'} vectors for ${batch.length} inputs`)
      const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      for (const d of sorted) {
        if (!Array.isArray(d.embedding) || d.embedding.length === 0 || !d.embedding.every(n => typeof n === 'number' && Number.isFinite(n))) throw new Error('embeddings endpoint returned an invalid vector')
        out.push(d.embedding)
      }
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }
  return out
}
