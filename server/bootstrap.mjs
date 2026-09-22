import { assert } from './core.mjs'

export const PACKAGE_IDS = ['nginx', 'node', 'pm2', 'certbot']

export const PROBE_COMMAND = [
  "printf 'SYSTEM '; uname -s; printf '\\n'",
  "printf 'DISTRO_ID '; . /etc/os-release 2>/dev/null && printf '%s' \"$ID\" || printf unknown; printf '\\n'",
  "printf 'DISTRO_LIKE '; . /etc/os-release 2>/dev/null && printf '%s' \"$ID_LIKE\" || printf ''; printf '\\n'",
  // 每项独占一行；缺软件时也要换行，避免 NODE/NGINX/…粘成一行导致误判无 sudo
  "printf 'NODE '; node --version 2>/dev/null || true; printf '\\n'",
  "printf 'NGINX '; command -v nginx || true; printf '\\n'",
  "printf 'PM2 '; command -v pm2 || true; printf '\\n'",
  "printf 'CERTBOT '; command -v certbot || true; printf '\\n'",
  "printf 'SUDO '; sudo -n true 2>/dev/null && printf 'yes' || printf 'no'; printf '\\n'",
  "printf 'PORTS\\n'; ss -H -ltn 2>/dev/null || true",
].join('; ')

function lineValue(report, key) {
  const match = String(report || '').match(new RegExp(`^${key} (.+)$`, 'm'))
  return match ? match[1].trim() : ''
}

export function parseReport(report) {
  const text = String(report || '')
  const system = lineValue(text, 'SYSTEM')
  const distroId = lineValue(text, 'DISTRO_ID').toLowerCase()
  const distroLike = lineValue(text, 'DISTRO_LIKE').toLowerCase()
  const node = lineValue(text, 'NODE')
  const nginx = lineValue(text, 'NGINX')
  const pm2 = lineValue(text, 'PM2')
  const certbot = lineValue(text, 'CERTBOT')
  const sudo = lineValue(text, 'SUDO')
  const debianFamily = distroId === 'debian' || distroId === 'ubuntu'
    || /\bdebian\b/.test(distroLike) || /\bubuntu\b/.test(distroLike)
  const hasNode22 = /v(?:2[2-9]|[3-9]\d)\./.test(node)
  return {
    system,
    distroId: distroId || 'unknown',
    distroLike,
    osFamily: debianFamily ? 'debian' : system === 'Linux' ? 'other-linux' : 'unsupported',
    hasLinux: system === 'Linux',
    hasNginx: nginx.startsWith('/'),
    hasNode22,
    nodeVersion: node.startsWith('v') ? node : '',
    hasPm2: pm2.startsWith('/'),
    hasCertbot: certbot.startsWith('/'),
    hasSudo: sudo === 'yes',
  }
}

export function missingPackages(parsed, { includeCertbot = true } = {}) {
  const missing = []
  if (!parsed.hasNginx) missing.push('nginx')
  if (!parsed.hasNode22) missing.push('node')
  if (!parsed.hasPm2) missing.push('pm2')
  if (includeCertbot && !parsed.hasCertbot) missing.push('certbot')
  return missing
}

export function requirementsFromReport(report, options = {}) {
  const parsed = parseReport(report)
  const missing = missingPackages(parsed, options)
  return {
    ...parsed,
    missing,
    canBootstrap: parsed.osFamily === 'debian' && parsed.hasSudo && missing.length > 0,
    ready: missing.length === 0 && parsed.hasSudo && parsed.hasLinux,
    items: [
      { id: 'sudo', label: '免密 sudo', ok: parsed.hasSudo, required: true },
      { id: 'nginx', label: 'Nginx', ok: parsed.hasNginx, required: true },
      { id: 'node', label: 'Node 22+', ok: parsed.hasNode22, required: false, detail: parsed.nodeVersion || undefined },
      { id: 'pm2', label: 'PM2', ok: parsed.hasPm2, required: false },
      { id: 'certbot', label: 'Certbot', ok: parsed.hasCertbot, required: false },
    ],
  }
}

export function normalizePackages(packages, parsed) {
  const allowed = new Set(PACKAGE_IDS)
  const requested = Array.isArray(packages) && packages.length
    ? packages.map(String)
    : missingPackages(parsed)
  const unique = [...new Set(requested)]
  for (const id of unique) assert(allowed.has(id), `不支持安装：${id}`)
  return unique.filter(id => {
    if (id === 'nginx') return !parsed.hasNginx
    if (id === 'node') return !parsed.hasNode22
    if (id === 'pm2') return !parsed.hasPm2
    if (id === 'certbot') return !parsed.hasCertbot
    return false
  })
}

export function buildInstallScript(packages, parsed = null) {
  const state = parsed || { osFamily: 'debian', hasSudo: true, hasNginx: false, hasNode22: false, hasPm2: false, hasCertbot: false }
  assert(state.osFamily === 'debian', '自动安装仅支持 Ubuntu / Debian；请手动安装 Nginx、Node 22+、PM2 和 Certbot')
  assert(state.hasSudo, '自动安装需要当前用户已配置免密 sudo')
  const list = normalizePackages(packages, state)
  assert(list.length > 0, '没有需要安装的依赖')

  const lines = [
    'set -eu',
    'export DEBIAN_FRONTEND=noninteractive',
    "echo 'DeployX: preparing package indexes'",
    'sudo -n apt-get update -y',
  ]

  if (list.includes('nginx')) {
    lines.push("echo 'DeployX: installing nginx'")
    lines.push('sudo -n apt-get install -y nginx')
    lines.push('sudo -n systemctl enable --now nginx || true')
  }

  if (list.includes('node')) {
    lines.push("echo 'DeployX: installing Node.js 22.x'")
    lines.push('sudo -n apt-get install -y ca-certificates curl gnupg')
    lines.push('sudo -n mkdir -p /etc/apt/keyrings')
    lines.push('curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo -n gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg')
    lines.push('echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | sudo -n tee /etc/apt/sources.list.d/nodesource.list >/dev/null')
    lines.push('sudo -n apt-get update -y')
    lines.push('sudo -n apt-get install -y nodejs')
    lines.push('node --version | grep -E "^v(2[2-9]|[3-9][0-9])\\." >/dev/null')
  }

  if (list.includes('pm2')) {
    lines.push("echo 'DeployX: installing pm2'")
    lines.push('command -v node >/dev/null || { echo "安装 PM2 前需要 Node.js"; exit 1; }')
    lines.push('sudo -n npm install -g pm2')
  }

  if (list.includes('certbot')) {
    lines.push("echo 'DeployX: installing certbot'")
    lines.push('sudo -n apt-get install -y certbot python3-certbot-nginx')
  }

  lines.push("echo 'DeployX: bootstrap finished'")
  return { packages: list, script: lines.join('\n') }
}
