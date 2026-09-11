/** Port configuration shared by the server and launcher helpers. */
export function parsePort(value, fallback, name) {
  const text = String(value ?? fallback).trim()
  const port = Number(text)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }
  return port
}

export function serverPorts(env = process.env) {
  const launcher = parsePort(env.DSH_LAUNCHER_PORT, 3090, 'DSH_LAUNCHER_PORT')
  const dsh = parsePort(env.DSH_WEB_PORT, 3080, 'DSH_WEB_PORT')
  if (launcher === dsh) throw new Error('DSH_LAUNCHER_PORT and DSH_WEB_PORT must use different ports')
  return { launcher, dsh }
}
