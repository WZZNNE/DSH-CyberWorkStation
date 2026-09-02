/**
 * dsh-lan-fence — deny unpaired LAN devices the bare /api, WITHOUT touching the vendored core.
 *
 * `@deepseek-ai/dsh-web-app` trusts this machine's auto-derived LAN IP literals on the /api fence
 * whenever the server binds all interfaces (0.0.0.0), so the official GUI can be opened directly
 * at a LAN address. When remote access is fronted by a pairing layer (dsh-remote-web-ui), that
 * default hands an unpaired LAN device the full desktop API. This plugin removes exactly those
 * auto-derived LAN authorities from the trust list the connection fence reads — in place, so it
 * needs no core change and survives a core upgrade.
 *
 * It works because `dsh-client-connection` keeps the SAME array reference it is handed
 * (`config.trustedHosts ?? []`) and re-reads it on every request, and `web-app` publishes that
 * array as `ctx.webRuntime.trustedHosts` with the removable LAN literals mirrored in
 * `ctx.webRuntime.lanAddresses`.
 *
 * Limits of the self-check below, stated honestly: it re-reads the array it just spliced, so it
 * only catches a splice that did not take (a frozen or non-array trust list). It CANNOT catch the
 * failure mode where a future core copies the array before handing it to the connection fence —
 * then the fence holds a different array this plugin never sees, the splice succeeds on our copy,
 * and LAN /api stays open with a misleading "removed" log. The real backstop for that is a manual
 * check after any core upgrade: a request to `/api` from a LAN Host must return 403. Keep that in
 * the upgrade checklist.
 */
import { fenceLan } from './fence.js'

export const name = 'dsh-lan-fence'
export const inject = ['webRuntime']

export function apply(ctx) {
  const runtime = ctx.webRuntime
  if (!runtime || !Array.isArray(runtime.trustedHosts)) {
    console.warn('[lan-fence] webRuntime.trustedHosts unavailable — LAN /api fence NOT applied')
    return
  }
  const { removed, leaked } = fenceLan(runtime.trustedHosts, runtime.lanAddresses)
  if (leaked.length > 0) {
    console.warn(`[lan-fence] could not remove LAN authorities ${leaked.join(', ')} — LAN /api may be exposed; check core webRuntime sharing`)
  } else if (removed.length > 0) {
    console.log(`[lan-fence] LAN /api fenced — removed ${removed.length} auto-derived authorit${removed.length === 1 ? 'y' : 'ies'} (${removed.join(', ')})`)
  } else {
    console.log('[lan-fence] no LAN authorities to remove (loopback bind or none derived)')
  }
}
