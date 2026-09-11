/** Apply only fields owned by the launcher search form, preserving other clients' settings. */
export function mergeWebSearchPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Search settings patch must be an object')
  const next = { ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}) }
  const fields = ['mode', 'provider', 'searxngUrl', 'maxResults', 'cacheTtlSec', 'template', 'budgetChars', 'visitLinks', 'visitChars', 'blacklist']
  for (const key of fields) if (Object.hasOwn(patch, key)) next[key] = patch[key]
  for (const [group, keys] of [
    ['triggers', ['backticks', 'always', 'maxWords', 'phrases', 'regex', 'regexQuery']],
    ['fetch', ['enabled']],
  ]) {
    if (!Object.hasOwn(patch, group)) continue
    if (!patch[group] || typeof patch[group] !== 'object' || Array.isArray(patch[group])) throw new Error(`${group} must be an object`)
    next[group] = { ...(next[group] && typeof next[group] === 'object' ? next[group] : {}) }
    for (const key of keys) if (Object.hasOwn(patch[group], key)) next[group][key] = patch[group][key]
  }
  return next
}
