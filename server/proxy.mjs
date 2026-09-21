import { execFileSync } from 'node:child_process'

function normalizeProxy(raw) {
  const value = String(raw || '').trim()
  if (!value) return null
  if (/^=?https?=/i.test(value) || value.includes(';')) {
    const parts = Object.fromEntries(value.split(';').map(p => p.trim()).filter(Boolean).map(p => {
      const i = p.indexOf('=')
      return i >= 0 ? [p.slice(0, i).toLowerCase(), p.slice(i + 1)] : ['all', p]
    }))
    const host = parts.https || parts.http || parts.all
    return host ? normalizeProxy(host) : null
  }
  if (/^https?:\/\//i.test(value)) return value
  return `http://${value}`
}

export function readWindowsProxy() {
  if (process.platform !== 'win32') return null
  try {
    const enable = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable'], { encoding: 'utf8', windowsHide: true })
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enable)) return null
    const server = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'], { encoding: 'utf8', windowsHide: true })
    const match = server.match(/ProxyServer\s+REG_SZ\s+(.+)/i)
    return normalizeProxy(match?.[1])
  } catch {
    return null
  }
}

/** Apply HTTPS_PROXY from env or Windows system proxy so Node fetch can reach Google APIs. */
export function applySystemProxy() {
  const existing = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY
  if (existing) {
    if (!process.env.HTTPS_PROXY) process.env.HTTPS_PROXY = existing
    if (!process.env.HTTP_PROXY) process.env.HTTP_PROXY = existing
    return existing
  }
  const system = readWindowsProxy()
  if (!system) return null
  process.env.HTTPS_PROXY = system
  process.env.HTTP_PROXY = system
  process.env.NO_PROXY = process.env.NO_PROXY || 'localhost,127.0.0.1,::1'
  return system
}

export { normalizeProxy }
