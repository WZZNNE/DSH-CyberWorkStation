import path from 'node:path'

/** TCP listeners only, comparing the complete local port rather than a substring. */
export function listeningPids(netstat, port) {
  const pids = new Set()
  for (const line of String(netstat).split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields[0] !== 'TCP' || fields[3] !== 'LISTENING') continue
    const match = /:(\d+)$/.exec(fields[1])
    const pid = Number(fields[4])
    if (match && Number(match[1]) === port && Number.isSafeInteger(pid) && pid > 4) pids.add(pid)
  }
  return [...pids]
}

/** Microsoft CRT whitespace, quote and backslash rules; malformed quotes fail closed. */
export function windowsArgv(commandLine) {
  const result = []
  const text = String(commandLine ?? '')
  let i = 0
  while (i < text.length) {
    while (/[\t ]/.test(text[i] ?? '') && i < text.length) i++
    if (i >= text.length) break
    let argument = '', quoted = false
    while (i < text.length && (quoted || !/[\t ]/.test(text[i]))) {
      let slashes = 0
      while (text[i] === '\\') { slashes++; i++ }
      if (text[i] === '"') {
        argument += '\\'.repeat(Math.floor(slashes / 2))
        if (slashes % 2) argument += '"'
        else if (quoted && text[i + 1] === '"') { argument += '"'; i++ }
        else quoted = !quoted
        i++
      } else {
        argument += '\\'.repeat(slashes)
        if (i < text.length && (quoted || !/[\t ]/.test(text[i]))) argument += text[i++]
      }
    }
    if (quoted) return []
    result.push(argument)
  }
  return result
}

function descendantOf(pid, ancestor, table) {
  const seen = new Set()
  for (let current = pid; current > 4 && !seen.has(current); current = table.get(current)?.ppid ?? 0) {
    if (current === ancestor) return true
    seen.add(current)
  }
  return false
}

/** Only a Node process running this checkout's CLI in its actual script position is ours. */
export function isDshWebProcess(pid, table, { repo, ownedSourcePid = null }) {
  const row = table.get(pid)
  if (!row || row.name !== 'node' || !row.created) return false
  const argv = windowsArgv(row.commandLine)
  if (!/^node(?:\.exe)?$/i.test(path.win32.basename(argv[0] ?? ''))) return false
  let scriptIndex = 1
  for (; scriptIndex < argv.length; scriptIndex++) {
    const argument = argv[scriptIndex]
    if (argument === '--') { scriptIndex++; break }
    if (['--no-warnings', '--enable-source-maps', '--trace-warnings'].includes(argument)) continue
    if (argument === '--import' && argv[scriptIndex + 1] === 'tsx/esm') { scriptIndex++; continue }
    if (argument === '--import=tsx/esm') continue
    if (argument.startsWith('-')) return false
    break
  }
  const script = argv[scriptIndex] ?? ''
  const normalize = value => path.win32.normalize(value).toLowerCase()
  const built = normalize(path.win32.join(repo, 'apps/cli/lib/bin.js'))
  const source = normalize(path.win32.join(repo, 'apps/cli/src/bin.ts'))
  if (path.win32.isAbsolute(script)) {
    if (![built, source].includes(normalize(script))) return false
  } else {
    if (!ownedSourcePid || !descendantOf(pid, ownedSourcePid, table) || normalize(script) !== normalize('apps/cli/src/bin.ts')) return false
  }
  const args = argv.slice(scriptIndex + 1)
  if (args.some(value => ['--dump-config', '--dump-default-config', '--help', '-h'].includes(value))) return false
  const offset = args[0] === 'web' || args[0] === '--profile=web' ? 1 : args[0] === '--profile' && args[1] === 'web' ? 2 : 0
  if (!offset) return false
  return !args.slice(offset).some(value => value === '--profile' || value.startsWith('--profile='))
}

/** A changed/missing creation stamp or command line means the PID may have been reused. */
export function sameProcess(before, after) {
  return Boolean(before?.created && after?.created && before.created === after.created
    && before.commandLine === after.commandLine && before.name === after.name)
}
