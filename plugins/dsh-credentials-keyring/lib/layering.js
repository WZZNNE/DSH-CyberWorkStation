/**
 * The layering decisions of the keyring provider, as pure functions the tests
 * can drive without a cordis context. The order of authority is fixed:
 *
 *   process environment  >  Windows Credential Manager  >  the local provider
 *   (read-only shadow)      (managed, writable)            (.credentials.yaml + .env files)
 *
 * The environment stays on top because that is the local provider's own
 * doctrine — a keyring that shadowed the environment would make an exported
 * variable silently stop working. Every keyring failure falls through to the
 * local provider: the keyring can lose a call, never a credential.
 */

const SOURCE = 'windows-credential-manager'

const envValueOf = (env, ref) => {
  const value = env[String(ref)]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** @returns {Promise<{ value: string, source: string } | undefined>} */
export async function layeredResolve({ ref, env, keyring, superResolve }) {
  if (envValueOf(env, ref) !== undefined) return superResolve()
  if (keyring.available) {
    try {
      const value = await keyring.get(String(ref))
      if (typeof value === 'string' && value.length > 0) return { value, source: SOURCE }
    } catch { /* fall through to the local provider */ }
  }
  return superResolve()
}

/** @returns {Promise<{ configured: boolean, source?: string, writable: boolean }>} */
export async function layeredDescribe({ ref, env, keyring, superDescribe }) {
  if (envValueOf(env, ref) !== undefined) return superDescribe()
  if (keyring.available) {
    try {
      const value = await keyring.get(String(ref))
      if (typeof value === 'string' && value.length > 0) return { configured: true, source: SOURCE, writable: true }
    } catch { /* fall through */ }
  }
  return superDescribe()
}

/**
 * Writes go to the keyring; the yaml copy of the same reference is retired so
 * the secret has one home. An environment shadow is delegated to the local
 * provider's own `set`, which rejects with the canonical fail-loud error. A
 * keyring that is unavailable or failing falls back to the local write — the
 * save must succeed the way it always has.
 */
export async function layeredSet({ ref, value, env, keyring, superSet, superUnset }) {
  // Empty is not a store: the seam rejects it fail-loud ("use unset"). Delegating to the base
  // preserves that contract — writing an empty keyring blob and retiring the yaml copy would
  // silently DELETE a live credential, which is exactly what the contract exists to prevent.
  if (typeof value !== 'string' || value.length === 0) return superSet()
  if (envValueOf(env, ref) !== undefined) return superSet()
  if (keyring.available) {
    try {
      await keyring.set(String(ref), value)
      try { await superUnset() } catch { /* a read-only .env shadow: the yaml copy is already not the answer */ }
      return
    } catch { /* fall back to the local write */ }
  }
  return superSet()
}

/** Unset clears both homes; the local provider still owns the shadow rejection. */
export async function layeredUnset({ ref, env, keyring, superUnset }) {
  let keyringError
  if (envValueOf(env, ref) === undefined && keyring.available) {
    try { await keyring.remove(String(ref)) } catch (error) { keyringError = error }
  }
  // The yaml copy is always cleared first; then a REAL keyring delete failure (not mere absence,
  // which the helper reports as success) is surfaced fail-loud rather than reported as a clean
  // unset while the secret could still live in the vault.
  await superUnset()
  if (keyringError !== undefined) throw keyringError
}
