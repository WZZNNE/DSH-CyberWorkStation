/**
 * The pure decision of dsh-lan-fence, so the tests drive it without a cordis context.
 *
 * `web-app` composes the /api trust list as `[...lanAddresses, ...extraTrustedHosts]` when the
 * server binds all interfaces: the auto-derived LAN IP literals are trusted so the official GUI
 * can be opened directly at a LAN address. When remote access is fronted by a pairing layer that
 * is the wrong default — an unpaired LAN device would reach the bare /api. This removes exactly
 * the auto-derived LAN authorities IN PLACE, leaving explicit `--trusted-host` values, so the
 * same array reference the connection fence holds now denies LAN /api.
 */

/**
 * Strip every auto-derived LAN literal from `trustedHosts` in place.
 * @param {string[]} trustedHosts - the live array the connection fence reads (mutated in place).
 * @param {readonly string[]} lanAddresses - the auto-derived LAN literals to remove.
 * @returns {{ removed: string[], leaked: string[] }} what was removed, and any LAN literal still
 *   present AFTER the splice — non-empty only when the splice itself did not take (a frozen or
 *   otherwise non-mutating array). It does NOT detect a core that copied the array away before the
 *   connection fence read it; that array is not this one, so it cannot be inspected here (see the
 *   module header — the backstop for that case is a post-upgrade manual 403 check).
 */
export function fenceLan(trustedHosts, lanAddresses) {
  if (!Array.isArray(trustedHosts)) return { removed: [], leaked: [] }
  const lan = new Set((lanAddresses ?? []).filter(a => typeof a === 'string' && a.length > 0))
  const removed = []
  for (let i = trustedHosts.length - 1; i >= 0; i--) {
    if (lan.has(trustedHosts[i])) { removed.push(trustedHosts[i]); trustedHosts.splice(i, 1) }
  }
  const leaked = trustedHosts.filter(h => lan.has(h))
  return { removed: removed.reverse(), leaked }
}
