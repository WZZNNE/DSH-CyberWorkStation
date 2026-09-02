/**
 * Durable-fact extraction: the instruction sent to the session's own routed model and the
 * tolerant parser for its answer. Pure.
 */
import { jaccard } from './recall.js'

export const MAX_FACTS = 8
export const MAX_FACT_CHARS = 300

export const EXTRACTION_INSTRUCTION = [
  'You are a memory extractor for this assistant. From the transcript ABOVE, list facts worth remembering in FUTURE, unrelated sessions:',
  '- stable preferences of the user (language, tone, formatting, tools they like or refuse)',
  '- decisions and conventions of this project (paths, versions, naming, constraints)',
  '- open goals or commitments that outlive this conversation',
  'Skip transient task details, anything already obvious from the code, and anything the user asked to forget.',
  `Answer with ONLY a JSON array (max ${MAX_FACTS} items, each ≤ ${MAX_FACT_CHARS} characters). Each item is {"text": "...", "global": true|false} — global = about the user themselves (applies in every project), false = specific to this project. Write each text in the language the user writes in. If nothing is worth remembering answer [].`,
].join('\n')

const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_FACT_CHARS)

/**
 * Parse the model answer: a JSON array of objects / strings, or a fallback bullet list.
 * @returns {Array<{text:string, global:boolean}>}
 */
export function parseFacts(answer) {
  const text = String(answer ?? '')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  const out = []
  const push = (t, global) => { const c = clean(t); if (c.length >= 4 && !out.some(o => o.text === c)) out.push({ text: c, global: global === true }) }
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === 'string') push(item, false)
          else if (item && typeof item === 'object' && typeof item.text === 'string') push(item.text, item.global === true)
          if (out.length >= MAX_FACTS) break
        }
        return out
      }
    } catch { /* fall through to bullets */ }
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line)
    if (m) push(m[1], false)
    if (out.length >= MAX_FACTS) break
  }
  return out
}

/** Drop facts that duplicate an existing item (exact or token-Jaccard ≥ 0.8). */
export function dedupeFacts(facts, existingTexts) {
  const kept = []
  for (const f of facts) {
    const dup = existingTexts.some(t => t === f.text || jaccard(t, f.text) >= 0.8) || kept.some(k => jaccard(k.text, f.text) >= 0.8)
    if (!dup) kept.push(f)
  }
  return kept
}
