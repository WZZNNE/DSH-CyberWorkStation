/**
 * Ledger backfill: rebuild daily totals from session logs recorded before the
 * plugin was installed (legacy JSONL / gzip session files), and import that
 * history into the ledger without double counting.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as zlib from 'node:zlib'
import { costOf, providerPriceEntryFor } from './pricing.js'
import { localDayKey, zeroDay } from './store.js'

const ZSTD_MAGIC = 4247762216
const PACKED_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return frames
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return frames
    offset += 4
    if (offset === buffer.length) return frames
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) return frames
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return frames
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) return frames
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

export function readSessionRecords(path) {
  const buffer = readFileSync(path)
  let text
  if (path.endsWith('.zstd')) {
    if (typeof zlib.zstdDecompressSync !== 'function') return []
    const frames = scanZstdFrames(buffer)
    if (frames.length === 0) return []
    const parts = frames.map(f => zlib.zstdDecompressSync(buffer.subarray(f.start, f.end)))
    text = Buffer.concat(parts).toString('utf8')
  } else {
    text = buffer.toString('utf8')
  }
  const records = []
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    try {
      records.push(JSON.parse(line))
    } catch {
    }
  }
  return records
}

/**
 * The log generations a session directory may hold: the legacy `session.jsonl(.zstd)` and, since dsh 0.1.5
 * migrates on open, `session.v<N>.jsonl(.zstd)` beside it (the legacy file is preserved). Pick the newest
 * generation, compressed over plaintext, so a migrated session is read once and from its current log.
 */
export function pickSessionLog(names) {
  let best = null
  for (const name of names) {
    const m = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(name)
    if (!m) continue
    const candidate = { name, version: m[1] === undefined ? 0 : Number(m[1]), zstd: m[2] !== undefined }
    if (best === null || candidate.version > best.version || (candidate.version === best.version && candidate.zstd && !best.zstd)) best = candidate
  }
  return best?.name ?? null
}

export function listSessionLogs(root) {
  const paths = []
  let projects
  try {
    projects = readdirSync(root, { withFileTypes: true })
  } catch {
    return paths
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    let sessions
    try {
      sessions = readdirSync(join(root, project.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      let names
      try {
        names = readdirSync(join(root, project.name, session.name))
      } catch {
        continue
      }
      const name = pickSessionLog(names)
      if (name === null) continue
      const path = join(root, project.name, session.name, name)
      try {
        if (statSync(path).isFile()) paths.push(path)
      } catch {
      }
    }
  }
  return paths
}

export function replaySessionRecords(records, config, wantDates = null) {
  const zeroBuckets = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 })
  const num = value => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  let sessionId = ''
  let title = ''
  let createdAt = 0
  let provider = 'deepseek'
  let model = 'default'
  let last = null
  const days = {}
  const shift = (sample, sign) => {
    const dayMap = days[sample.date] ?? (days[sample.date] = {})
    const current = dayMap[sample.providerKey] ?? zeroBuckets()
    dayMap[sample.providerKey] = {
      input: current.input + sign * sample.buckets.input,
      output: current.output + sign * sample.buckets.output,
      cacheRead: current.cacheRead + sign * sample.buckets.cacheRead,
      cacheWrite: current.cacheWrite + sign * sample.buckets.cacheWrite,
      reasoning: current.reasoning + sign * sample.buckets.reasoning,
      calls: current.calls + sign,
      cost: current.cost + sign * sample.cost,
    }
  }
  for (const event of records) {
    if (event === null || typeof event !== 'object') continue
    if (event.type === 'session' && typeof event.id === 'string') {
      sessionId = event.id
      const created = Number(event.createdAt)
      if (Number.isFinite(created) && created > 0) createdAt = created
      continue
    }
    if (event.type === 'session/title') {
      const nextTitle = event.data?.title
      if (typeof nextTitle === 'string' && nextTitle.trim().length > 0) title = nextTitle.trim()
      continue
    }
    if (PACKED_ROW_TYPES.has(event.type)) continue
    if (event.type === 'request/header') {
      const nextModel = event.data?.header?.config?.model
      const nextProvider = event.data?.header?.config?.provider
      model = typeof nextModel === 'string' && nextModel.length > 0 ? nextModel : 'default'
      provider = typeof nextProvider === 'string' && nextProvider.length > 0 ? nextProvider : 'deepseek'
      continue
    }
    let usage = null
    let turn = 0
    let step = 0
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage' && event.data.chunk.usage !== undefined) {
      usage = event.data.chunk.usage
      turn = event.data.turn
      step = event.data.step
    } else if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
      usage = event.data.usage
      turn = event.data.turn
      step = event.data.step
    } else {
      continue
    }
    const atMs = Number(event.time)
    if (!Number.isFinite(atMs) || atMs <= 0) continue
    const date = localDayKey(atMs)
    if (wantDates !== null && !wantDates.has(date)) continue
    const buckets = {
      input: num(usage.inputTokens),
      output: num(usage.outputTokens),
      cacheRead: num(usage.cacheReadTokens),
      cacheWrite: num(usage.cacheWriteTokens),
      reasoning: num(usage.reasoningTokens),
    }
    const key = `${turn}:${step}`
    const prev = last !== null && last.key === key ? last : null
    if (prev !== null && prev.providerKey === `${provider}:${model}`
      && prev.buckets.input === buckets.input && prev.buckets.output === buckets.output
      && prev.buckets.cacheRead === buckets.cacheRead && prev.buckets.cacheWrite === buckets.cacheWrite
      && prev.buckets.reasoning === buckets.reasoning) {
      continue
    }
    const resolved = providerPriceEntryFor(provider, model, config?.prices, {
      mode: config?.priceMatch === 'exact' ? 'exact' : 'auto',
      overrides: config?.priceOverrides,
    })
    const peak = {
      enabled: resolved.billingMode === 'deepseek-peak' && config?.peakEnabled === true,
      effectiveAtMs: Date.parse(config?.peakEffectiveAt ?? ''),
      windows: config?.peakWindows,
    }
    const cost = resolved.priced ? costOf(buckets, resolved.entry, atMs, peak) : 0
    const providerKey = `${provider}:${model}`
    if (prev !== null) shift(prev, -1)
    const sample = { key, date, providerKey, buckets, cost }
    shift(sample, 1)
    last = sample
  }
  return { sessionId, title, createdAt, days }
}

export async function backfillLegacyLedger(ledger, sessionsRoot) {
  const result = { days: 0, sessions: 0, scanned: 0, titles: 0 }
  const needDates = new Set()
  for (const [date, day] of Object.entries(ledger.days ?? {})) {
    if ((day?.calls ?? 0) > 0 && Object.keys(day?.byProviderModel ?? {}).length === 0) needDates.add(date)
  }
  for (const day of Object.values(ledger.days ?? {})) {
    for (const session of day?.sessions ?? []) {
      if ((session?.calls ?? 0) > 0 && Object.keys(session?.byProviderModel ?? {}).length === 0) {
        const dates = collectSessionDates(ledger, session.id)
        for (const date of dates) needDates.add(date)
      }
    }
  }
  let needTitles = false
  for (const day of Object.values(ledger.days ?? {})) {
    for (const session of day?.sessions ?? []) {
      if (typeof session?.title !== 'string' || session.title.length === 0 || !Number.isFinite(Number(session?.at))) {
        needTitles = true
        break
      }
    }
    if (needTitles) break
  }
  if (needDates.size === 0 && !needTitles) return result
  const bySession = new Map()
  const titles = new Map()
  const createdAts = new Map()
  let scannedCount = 0
  for (const path of listSessionLogs(sessionsRoot)) {
    if ((scannedCount += 1) % 8 === 0) await new Promise(resolve => setImmediate(resolve))
    result.scanned += 1
    let replayed
    try {
      replayed = replaySessionRecords(readSessionRecords(path), ledger.config, needDates.size > 0 ? needDates : new Set(['-']))
    } catch {
      continue
    }
    if (replayed.sessionId.length === 0) continue
    if (replayed.title.length > 0 && !titles.has(replayed.sessionId)) titles.set(replayed.sessionId, replayed.title)
    if (replayed.createdAt > 0 && !createdAts.has(replayed.sessionId)) createdAts.set(replayed.sessionId, replayed.createdAt)
    if (needDates.size === 0) continue
    const existing = bySession.get(replayed.sessionId)
    if (existing === undefined) bySession.set(replayed.sessionId, replayed.days)
    else mergeDayMaps(existing, replayed.days)
  }
  for (const [date, day] of Object.entries(ledger.days ?? {})) {
    const dayIsEmpty = (day?.calls ?? 0) > 0 && Object.keys(day?.byProviderModel ?? {}).length === 0
    if (dayIsEmpty) {
      const aggregate = {}
      for (const days of bySession.values()) {
        const pm = days[date]
        if (pm === undefined) continue
        mergeBucketsInto(aggregate, pm)
      }
      const replayed = Object.values(aggregate).reduce((acc, b) => {
        acc.input += b.input ?? 0
        acc.output += b.output ?? 0
        acc.cacheRead += b.cacheRead ?? 0
        acc.cacheWrite += b.cacheWrite ?? 0
        acc.reasoning += b.reasoning ?? 0
        acc.calls += b.calls ?? 0
        acc.cost += b.cost ?? 0
        return acc
      }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 })
      if (replayed.calls === (day.calls ?? 0)
        && replayed.input === (day.input ?? 0) && replayed.output === (day.output ?? 0)
        && replayed.cacheRead === (day.cacheRead ?? 0) && replayed.cacheWrite === (day.cacheWrite ?? 0)) {
        day.cost = replayed.cost
        result.recosted = (result.recosted ?? 0) + 1
      }
      if (replayed.calls < (day.calls ?? 0)) {
        aggregate['deepseek:legacy'] = {
          input: Math.max(0, (day.input ?? 0) - replayed.input),
          output: Math.max(0, (day.output ?? 0) - replayed.output),
          cacheRead: Math.max(0, (day.cacheRead ?? 0) - replayed.cacheRead),
          cacheWrite: Math.max(0, (day.cacheWrite ?? 0) - replayed.cacheWrite),
          reasoning: Math.max(0, (day.reasoning ?? 0) - replayed.reasoning),
          calls: (day.calls ?? 0) - replayed.calls,
          cost: Math.max(0, (day.cost ?? 0) - replayed.cost),
        }
      }
      if (Object.keys(aggregate).length > 0) {
        day.byProviderModel = aggregate
        result.days += 1
      }
    }
    for (const session of day?.sessions ?? []) {
      if ((session?.calls ?? 0) <= 0) continue
      const pm = bySession.get(session.id)?.[date]
      if (pm === undefined || Object.keys(pm).length === 0) continue
      if (Object.keys(session.byProviderModel ?? {}).length === 0) {
        session.byProviderModel = cloneDayMap(pm)
        result.sessions += 1
      }
      const sTotals = Object.values(pm).reduce((acc, b) => {
        acc.input += b.input ?? 0
        acc.output += b.output ?? 0
        acc.cacheRead += b.cacheRead ?? 0
        acc.cacheWrite += b.cacheWrite ?? 0
        acc.calls += b.calls ?? 0
        acc.cost += b.cost ?? 0
        return acc
      }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0 })
      if (sTotals.calls === (session.calls ?? 0)
        && dayIsEmpty
        && sTotals.input === (session.input ?? 0) && sTotals.output === (session.output ?? 0)
        && sTotals.cacheRead === (session.cacheRead ?? 0) && sTotals.cacheWrite === (session.cacheWrite ?? 0)) {
        session.cost = sTotals.cost
      }
    }
  }
  if (titles.size > 0 || createdAts.size > 0) {
    for (const day of Object.values(ledger.days ?? {})) {
      for (const session of day?.sessions ?? []) {
        if (session === null || typeof session !== 'object') continue
        if ((typeof session.title !== 'string' || session.title.length === 0) && titles.size > 0) {
          const found = titles.get(session.id)
          if (found !== undefined) {
            session.title = found
            result.titles += 1
          }
        }
        if (!Number.isFinite(Number(session.at)) && createdAts.size > 0) {
          const foundAt = createdAts.get(session.id)
          if (foundAt !== undefined) session.at = foundAt
        }
      }
    }
  }
  if (result.days > 0 || result.sessions > 0 || result.titles > 0) ledger.scheduleWrite()
  return result
}

function collectSessionDates(ledger, sessionId) {
  const dates = new Set()
  for (const [date, day] of Object.entries(ledger.days ?? {})) {
    if ((day?.sessions ?? []).some(s => s?.id === sessionId)) dates.add(date)
  }
  return dates
}

function mergeDayMaps(target, source) {
  for (const [date, pm] of Object.entries(source)) {
    const current = target[date]
    if (current === undefined) target[date] = cloneDayMap(pm)
    else mergeBucketsInto(current, pm)
  }
}

function mergeBucketsInto(target, source) {
  for (const [key, b] of Object.entries(source)) {
    const current = target[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
    target[key] = {
      input: current.input + (b.input ?? 0),
      output: current.output + (b.output ?? 0),
      cacheRead: current.cacheRead + (b.cacheRead ?? 0),
      cacheWrite: current.cacheWrite + (b.cacheWrite ?? 0),
      reasoning: current.reasoning + (b.reasoning ?? 0),
      calls: current.calls + (b.calls ?? 0),
      cost: current.cost + (b.cost ?? 0),
    }
  }
}

function cloneDayMap(pm) {
  const out = {}
  for (const [key, b] of Object.entries(pm)) {
    out[key] = {
      input: b.input ?? 0,
      output: b.output ?? 0,
      cacheRead: b.cacheRead ?? 0,
      cacheWrite: b.cacheWrite ?? 0,
      reasoning: b.reasoning ?? 0,
      calls: b.calls ?? 0,
      cost: b.cost ?? 0,
    }
  }
  return out
}

function sumDayMap(pm) {
  return Object.values(pm).reduce((acc, b) => {
    acc.input += b.input ?? 0
    acc.output += b.output ?? 0
    acc.cacheRead += b.cacheRead ?? 0
    acc.cacheWrite += b.cacheWrite ?? 0
    acc.reasoning += b.reasoning ?? 0
    acc.calls += b.calls ?? 0
    acc.cost += b.cost ?? 0
    return acc
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 })
}

function addTotalsTo(target, totals) {
  target.input += totals.input
  target.output += totals.output
  target.cacheRead += totals.cacheRead
  target.cacheWrite += totals.cacheWrite
  target.reasoning += totals.reasoning
  target.calls += totals.calls
  target.cost += totals.cost
}

function sessionEntryOf(sessionId, info, totals, pm) {
  const entry = {
    id: sessionId,
    input: totals.input,
    output: totals.output,
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    reasoning: totals.reasoning,
    calls: totals.calls,
    cost: totals.cost,
    byProviderModel: cloneDayMap(pm),
  }
  if (typeof info.title === 'string' && info.title.length > 0) entry.title = info.title
  if (Number.isFinite(info.createdAt) && info.createdAt > 0) entry.at = info.createdAt
  return entry
}

export async function importLegacyHistory(ledger, sessionsRoot) {
  const result = { days: 0, sessions: 0, scanned: 0 }
  const bySession = new Map()
  let scannedCount = 0
  for (const path of listSessionLogs(sessionsRoot)) {
    if ((scannedCount += 1) % 8 === 0) await new Promise(resolve => setImmediate(resolve))
    result.scanned += 1
    let replayed
    try {
      replayed = replaySessionRecords(readSessionRecords(path), ledger.config, null)
    } catch {
      continue
    }
    if (replayed.sessionId.length === 0) continue
    const existing = bySession.get(replayed.sessionId)
    if (existing === undefined) {
      bySession.set(replayed.sessionId, { title: replayed.title, createdAt: replayed.createdAt, days: replayed.days })
      continue
    }
    mergeDayMaps(existing.days, replayed.days)
  }
  if (bySession.size === 0) return result
  const dateSessions = new Map()
  for (const [sessionId, info] of bySession) {
    for (const [date, pm] of Object.entries(info.days)) {
      const totals = sumDayMap(pm)
      if (totals.calls <= 0) continue
      let list = dateSessions.get(date)
      if (list === undefined) dateSessions.set(date, list = [])
      list.push({ sessionId, info, pm, totals })
    }
  }
  for (const [date, list] of dateSessions) {
    const day = ledger.days[date]
    const dayEmpty = day === undefined
      || ((day.calls ?? 0) === 0
        && (Array.isArray(day.sessions) ? day.sessions.every(s => (s?.calls ?? 0) === 0) : true))
    if (dayEmpty) {
      const target = zeroDay(date)
      const aggregate = {}
      for (const entry of list) {
        target.sessions.push(sessionEntryOf(entry.sessionId, entry.info, entry.totals, entry.pm))
        mergeBucketsInto(aggregate, entry.pm)
        addTotalsTo(target, entry.totals)
        result.sessions += 1
      }
      target.byProviderModel = aggregate
      ledger.days[date] = target
      result.days += 1
      continue
    }
    const known = new Set((Array.isArray(day.sessions) ? day.sessions : []).map(s => s?.id))
    for (const entry of list) {
      if (known.has(entry.sessionId)) continue
      day.sessions.push(sessionEntryOf(entry.sessionId, entry.info, entry.totals, entry.pm))
      addTotalsTo(day, entry.totals)
      if (day.byProviderModel === null || typeof day.byProviderModel !== 'object') day.byProviderModel = {}
      mergeBucketsInto(day.byProviderModel, entry.pm)
      result.sessions += 1
      result.days += 1
    }
  }
  if (result.days > 0 || result.sessions > 0) {
    const ordered = {}
    for (const key of Object.keys(ledger.days).sort()) ordered[key] = ledger.days[key]
    ledger.days = ordered
    ledger.scheduleWrite()
  }
  return result
}
