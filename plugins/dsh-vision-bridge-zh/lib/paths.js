import { resolve, relative, isAbsolute, sep } from 'node:path'

/** Lexical convenience check; actual reads use resolveAllowedTarget and the filesystem provider. */
export function isPathAllowed(path, allowedDirs) {
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) return true
  if (typeof path !== 'string' || !path.trim()) return false
  return allowedDirs.some(dir => {
    if (typeof dir !== 'string' || !dir.trim()) return false
    const from = resolve(dir)
    const to = resolve(path)
    const rel = relative(from, to)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  })
}

/** Resolve aliases first, then enforce containment using the owning filesystem's canonical targets. */
export async function resolveAllowedTarget(fs, path, allowedDirs, signal) {
  if (!fs) throw new Error('vision: filesystem service unavailable')
  const target = await fs.resolve(path, { signal })
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) return target
  for (const dir of allowedDirs) {
    if (typeof dir !== 'string' || !dir.trim()) continue
    const root = await fs.resolve(dir, { signal })
    if (fs.contains(root, target)) return target
  }
  throw new Error('vision: file is outside allowedImageDirs')
}

/** Browser URL entry points cannot be used as alternative local-file readers. */
export function publicPageUrl(value) {
  const url = new URL(String(value))
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('vision: page URL must use http:// or https://')
  return url.href
}
