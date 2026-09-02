/**
 * dsh-credentials-keyring — the local credential provider with its reference
 * half backed by the Windows Credential Manager.
 *
 * Mounting: this class REPLACES the stock provider (both register the
 * `credentials` service), so the profile patch disables the base bundle's
 * `credentials` entry and inserts this one. The record half (`<owner>/<id>`
 * grants) and every config knob stay the inherited implementation — only
 * where an environment-variable-shaped secret LIVES changes:
 *
 *   process env (read-only, wins)  >  Credential Manager  >  .credentials.yaml / .env
 *
 * Secrets migrate on write: the next "save key" from any panel lands in the
 * Credential Manager and retires the yaml copy of that reference. Existing
 * yaml secrets keep resolving until then. On a platform without the keyring
 * (or when the helper breaks) every call falls through to the inherited
 * behavior — a keyring outage can cost a lookup path, never a credential.
 */
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { createKeyring } from './keyring.js'
import { layeredDescribe, layeredResolve, layeredSet, layeredUnset } from './layering.js'

export default class KeyringCredentialProvider extends LocalCredentialProvider {
  constructor(ctx, config) {
    super(ctx, config ?? {})
    this.keyring = createKeyring({ log: message => this.ctx?.logger?.warn?.(message) ?? console.warn(`[credentials-keyring] ${message}`) })
    this.ctx.effect(() => () => this.keyring.dispose(), 'credentials-keyring: helper process')
  }

  resolve(ref) {
    return layeredResolve({ ref, env: process.env, keyring: this.keyring, superResolve: () => super.resolve(ref) })
  }

  describe(ref) {
    return layeredDescribe({ ref, env: process.env, keyring: this.keyring, superDescribe: () => super.describe(ref) })
  }

  set(ref, value) {
    return layeredSet({
      ref, value, env: process.env, keyring: this.keyring,
      superSet: () => super.set(ref, value),
      superUnset: () => super.unset(ref),
    })
  }

  unset(ref) {
    return layeredUnset({ ref, env: process.env, keyring: this.keyring, superUnset: () => super.unset(ref) })
  }
}
