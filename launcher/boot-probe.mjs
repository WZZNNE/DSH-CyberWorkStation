/**
 * What a slice of the dsh output log says about a boot, as pure text parsing (the launcher reads the slice).
 *
 * The launcher writes `[launcher] dsh pid <N>` beside the process it spawned; the core prints
 * `dsh web: <authenticated url>` once its web server is up (apps/web bundle). Only the lines AFTER the last pid
 * marker count: during a restart the new process's marker lands in the log before its ready line, and the
 * previous process's url (or failure) must never be paired with the new pid. Without any marker the whole
 * slice is read (a dsh started elsewhere). The core's other `dsh web:` line ("opening the default browser")
 * carries no url and is ignored by the url pattern.
 */
const PID_MARKER = /^\[launcher\] dsh pid (\d+)/gm
const READY_LINE = /^dsh web: (https?:\/\/\S+)/gm
const FAILURE_LINE = /plugin tree failed to load|fatal load failure|host preparation failed|^Error: dsh: /m

/** @returns {{ url: string | null, pid: number | null, failed: boolean }} */
export function parseBootLog(text) {
  const source = typeof text === 'string' ? text : ''
  const pids = [...source.matchAll(PID_MARKER)]
  const lastPid = pids.length > 0 ? pids[pids.length - 1] : null
  const after = lastPid ? source.slice(lastPid.index + lastPid[0].length) : source
  const urls = [...after.matchAll(READY_LINE)]
  return {
    url: urls.length > 0 ? urls[urls.length - 1][1] : null,
    pid: lastPid ? Number(lastPid[1]) : null,
    failed: FAILURE_LINE.test(after),
  }
}
