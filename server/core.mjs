import path from 'node:path'
import { readFile, realpath, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'

export const presets = {
  vue: { label: 'Vue', mode: 'static', output: 'dist', entry: '', spa: true, requireSiteKey: false, buildScript: 'build' },
  react: { label: 'React', mode: 'static', output: 'dist', entry: '', spa: true, requireSiteKey: false, buildScript: 'build' },
  astro: { label: 'Astro', mode: 'static', output: 'dist', entry: '', spa: false, requireSiteKey: true, buildScript: 'build' },
  nuxt: { label: 'Nuxt', mode: 'static', output: '.output/public', entry: '', spa: false, requireSiteKey: false, buildScript: 'generate' },
  next: { label: 'Next.js', mode: 'static', output: 'out', entry: '', spa: false, requireSiteKey: false, buildScript: 'build' },
}

export function assert(ok, message) { if (!ok) throw new Error(message) }
export const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`
export function unwrapPath(value) {
  let pathValue = String(value || '').trim()
  while ((pathValue.startsWith('"') && pathValue.endsWith('"')) || (pathValue.startsWith("'") && pathValue.endsWith("'"))) {
    pathValue = pathValue.slice(1, -1).trim()
  }
  return pathValue
}
export function relativePath(value) {
  assert(typeof value === 'string' && /^[a-zA-Z0-9_.\-/]+$/.test(value) && !value.startsWith('/') && !value.split('/').includes('..'), '产物或入口路径必须是项目内的相对路径')
  return value
}
export function parseEnv(text = '') {
  const result = {}
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    assert(m, '环境变量请使用 KEY=value，每行一个')
    let value = m[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '').trim()
    assert(!value.includes('\0'), '环境变量不能包含空字符')
    result[m[1]] = value
  }
  return result
}
export function envText(env) {
  return Object.entries(env).map(([k, v]) => {
    assert(!/[\r\n]/.test(v), '暂不支持多行环境变量')
    const delimiter = v.includes('"') ? "'" : '"'
    assert(!v.includes(delimiter), '环境变量值不能同时包含单引号和双引号')
    return `${k}=${delimiter}${v}${delimiter}`
  }).join('\n') + '\n'
}
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false
  let source = String(text || '').replace(/^\uFEFF/, '').replace(/^\uFFFE/, '')
  if (/^sep=(.)\r?\n/i.test(source)) source = source.replace(/^sep=(.)\r?\n/i, '')
  source = source.replace(/，/g, ',')
  const delimiter = detectDelimiter(source)
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (c === delimiter && !quoted) { row.push(normalizeCell(cell)); cell = '' }
    else if (c === '\n' && !quoted) { row.push(normalizeCell(cell)); rows.push(row); row = []; cell = '' }
    else if (c !== '\r' || quoted) cell += c
  }
  assert(!quoted, 'CSV 引号未闭合')
  if (cell || row.length) { row.push(normalizeCell(cell)); rows.push(row) }
  return rows.filter(r => r.some(Boolean))
}
function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n')
  const counts = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i]
    if (c === '"') { if (quoted && sample[i + 1] === '"') i++; else quoted = !quoted; continue }
    if (!quoted && c in counts) counts[c]++
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ','
}
function normalizeCell(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim()
}
function normalizeHeader(value) {
  return normalizeCell(value).toLowerCase().replace(/[\s_\-./／]+/g, '')
}
const DOMAIN_HEADERS = new Set(['domain', '域名', '网站', '网址', '站点', '站点域名', '网站域名', '主机名', 'host', 'hostname', 'url', 'fqdn'])
const KEY_HEADERS = new Set(['sitekey', 'site_key', '站点key', '站点密钥', 'key'])
const PORT_HEADERS = new Set(['port', '端口', '埠'])
const SEQ_HEADERS = new Set(['序号', 'seq', 'no', '编号', 'id'])
export function sitesFromRows(rows) {
  const headerRow = rows.findIndex(r => r.some(c => DOMAIN_HEADERS.has(normalizeHeader(c))))
  if (headerRow < 0) {
    const preview = rows.slice(0, 3).map(r => r.join(' | ')).join(' || ')
    assert(false, `找不到域名列；请使用表头 domain/域名（也支持 网站/网址/host）。当前前几行：${preview.slice(0, 180)}`)
  }
  const header = rows[headerRow].map(normalizeHeader)
  const col = (names) => header.findIndex(c => names.has(c))
  const domain = col(DOMAIN_HEADERS), key = col(KEY_HEADERS), port = col(PORT_HEADERS), seq = col(SEQ_HEADERS)
  assert(domain >= 0, '找不到域名列')
  return { headerRow, portColumn: port, sites: rows.slice(headerRow + 1).map((r, i) => ({
    seq: String((seq >= 0 ? r[seq] : '') || i + 1),
    domain: String(r[domain] || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, ''),
    siteKey: String((key >= 0 ? r[key] : '') || '').trim(),
    port: port >= 0 && r[port] ? Number(r[port]) : null,
    selected: true,
    sourceRow: headerRow + i + 2,
  })).filter(r => r.domain) }
}
export function columnName(n) { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s }

async function readFirstFile(root, names) {
  for (const name of names) {
    try { return { name, text: await readFile(path.join(root, name), 'utf8') } } catch {}
  }
  return { name: '', text: '' }
}

export function detectFramework(deps) {
  if (deps.nuxt || deps['nuxt-edge']) return 'nuxt'
  if (deps.next) return 'next'
  if (deps.astro) return 'astro'
  if (deps.vue) return 'vue'
  if (deps.react) return 'react'
  return null
}

export function parseAstroHints(text) {
  const output = text.match(/\boutput\s*:\s*['"`](static|server|hybrid)['"`]/)?.[1] || 'static'
  const hasNodeAdapter = /@astrojs\/node/.test(text) || /\badapter\s*:/.test(text)
  return { output, hasNodeAdapter }
}

export function parseNextHints(text) {
  return { staticExport: /\boutput\s*:\s*['"`]export['"`]/.test(text) }
}

export function parseNuxtHints(text, scripts = {}) {
  const ssrDisabled = /\bssr\s*:\s*false\b/.test(text)
  const hasGenerate = Object.keys(scripts).some(s => /generate/i.test(s) || String(scripts[s]).includes('nuxt generate') || String(scripts[s]).includes('nuxi generate'))
  return { ssrDisabled, hasGenerate, preferStatic: ssrDisabled || hasGenerate }
}

export function resolveProjectProfile(framework, deps, scripts, hints = {}) {
  const base = { ...presets[framework] }
  const scriptNames = Object.keys(scripts || {})
  let buildScript = base.buildScript
  if (!scriptNames.includes(buildScript)) buildScript = scriptNames.includes('build') ? 'build' : (scriptNames[0] || 'build')

  if (framework === 'astro') {
    const outputMode = hints.astro?.output || 'static'
    const adapter = !!deps['@astrojs/node'] || !!hints.astro?.hasNodeAdapter
    if (outputMode === 'server' || outputMode === 'hybrid') {
      assert(adapter, 'Astro server/hybrid 模式需要安装并配置 @astrojs/node standalone adapter')
      return {
        ...base,
        mode: 'node',
        output: 'dist',
        entry: 'dist/server/entry.mjs',
        spa: false,
        requireSiteKey: true,
        buildScript,
        adapter: true,
        runtimeInstall: false,
        runner: 'node-file',
        outputMode,
        detection: `Astro ${outputMode} → Node + PM2`,
      }
    }
    return {
      ...base,
      mode: 'static',
      output: 'dist',
      entry: '',
      spa: false,
      requireSiteKey: true,
      buildScript,
      adapter,
      runtimeInstall: false,
      runner: 'static',
      outputMode: 'static',
      detection: 'Astro static → Nginx 静态托管',
    }
  }

  if (framework === 'next') {
    const staticExport = !!hints.next?.staticExport
    if (staticExport) {
      return {
        ...base,
        mode: 'static',
        output: 'out',
        entry: '',
        spa: false,
        requireSiteKey: false,
        buildScript: scriptNames.includes('build') ? 'build' : buildScript,
        adapter: false,
        nextSsr: false,
        runtimeInstall: false,
        runner: 'static',
        outputMode: 'export',
        detection: 'Next.js output:export → Nginx 静态托管',
      }
    }
    return {
      ...base,
      mode: 'node',
      output: '.next',
      entry: 'node_modules/next/dist/bin/next',
      spa: false,
      requireSiteKey: false,
      buildScript: scriptNames.includes('build') ? 'build' : buildScript,
      adapter: false,
      nextSsr: true,
      runtimeInstall: true,
      runner: 'next-start',
      outputMode: 'ssr',
      detection: 'Next.js SSR → next start + PM2（服务器需安装 production 依赖）',
    }
  }

  if (framework === 'nuxt') {
    if (hints.nuxt?.preferStatic) {
      return {
        ...base,
        mode: 'static',
        output: '.output/public',
        entry: '',
        spa: false,
        requireSiteKey: false,
        buildScript: scriptNames.includes('generate') ? 'generate' : buildScript,
        adapter: false,
        nuxtSsr: false,
        runtimeInstall: false,
        runner: 'static',
        outputMode: 'static',
        detection: 'Nuxt 静态（nuxt generate → .output/public）→ Nginx',
      }
    }
    return {
      ...base,
      mode: 'node',
      output: '.output',
      entry: '.output/server/index.mjs',
      spa: false,
      requireSiteKey: false,
      buildScript: scriptNames.includes('build') ? 'build' : buildScript,
      adapter: false,
      nuxtSsr: true,
      runtimeInstall: false,
      runner: 'node-file',
      outputMode: 'ssr',
      detection: 'Nuxt SSR → .output/server/index.mjs + PM2',
    }
  }

  return {
    ...base,
    buildScript,
    adapter: false,
    runtimeInstall: false,
    runner: 'static',
    outputMode: 'spa',
    detection: `${base.label} SPA → Nginx 静态托管`,
  }
}

export async function inspectProject(projectPath) {
  const root = await realpath(unwrapPath(projectPath))
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const scripts = pkg.scripts || {}
  const framework = detectFramework(deps)
  assert(framework, '此目录未检测到 Vue、React、Astro、Nuxt 或 Next.js；请选择实际前端 package.json 所在目录')

  const hints = {}
  if (framework === 'astro') {
    const file = await readFirstFile(root, ['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.mts', 'astro.config.cts'])
    hints.astro = parseAstroHints(file.text)
  }
  if (framework === 'next') {
    const file = await readFirstFile(root, ['next.config.mjs', 'next.config.js', 'next.config.ts', 'next.config.cjs'])
    hints.next = parseNextHints(file.text)
  }
  if (framework === 'nuxt') {
    const file = await readFirstFile(root, ['nuxt.config.ts', 'nuxt.config.mjs', 'nuxt.config.js', 'nuxt.config.mts'])
    hints.nuxt = parseNuxtHints(file.text, scripts)
  }

  const profile = resolveProjectProfile(framework, deps, scripts, hints)
  let envKeys = []
  try { envKeys = Object.keys(parseEnv(await readFile(path.join(root, '.env'), 'utf8'))) } catch {}

  return {
    path: root,
    name: pkg.name || path.basename(root),
    framework,
    label: presets[framework].label,
    mode: profile.mode,
    output: profile.output,
    entry: profile.entry,
    spa: profile.spa,
    requireSiteKey: profile.requireSiteKey,
    buildScript: profile.buildScript,
    scripts: Object.keys(scripts),
    packageManager: pkg.packageManager?.split('@')[0] || 'npm',
    envKeys,
    next: framework === 'next',
    nextSsr: !!profile.nextSsr,
    nuxtSsr: !!profile.nuxtSsr,
    adapter: !!profile.adapter,
    runtimeInstall: !!profile.runtimeInstall,
    runner: profile.runner || (profile.mode === 'node' ? 'node-file' : 'static'),
    outputMode: profile.outputMode,
    detection: profile.detection,
  }
}

export function assertDeployShape(c, project = null) {
  assert(presets[c.framework], '请选择支持的技术栈：Vue、React、Astro、Nuxt 或 Next.js')
  assert(['static', 'node'].includes(c.mode), '无效的运行模式')
  relativePath(c.output)
  if (c.mode === 'static') {
    assert(!c.entry, '静态模式请清空 Node 入口')
  } else if (c.framework === 'next' || c.runner === 'next-start') {
    c.runner = 'next-start'
    c.runtimeInstall = true
    c.output = c.output || '.next'
    c.entry = c.entry || 'node_modules/next/dist/bin/next'
    assert(c.output === '.next', 'Next.js SSR 产物目录应为 .next')
  } else {
    c.runner = c.runner || 'node-file'
    relativePath(c.entry)
    assert(c.entry === c.output || c.entry.startsWith(c.output + '/'), 'Node 入口必须位于产物目录内')
  }
  if (c.framework === 'astro' && c.mode === 'node' && project) {
    assert(project.adapter, 'Astro Node 模式需要先安装并配置 @astrojs/node standalone adapter')
  }
  if (c.mode === 'static' && ['astro', 'nuxt', 'next'].includes(c.framework) && c.spa) {
    c.spa = false
  }
}

export function validateConfig(input, occupied = []) {
  const c = structuredClone(input)
  assertDeployShape(c)
  assert(typeof c.projectPath === 'string', '请选择本地项目的绝对路径')
  c.projectPath = unwrapPath(c.projectPath)
  assert(path.isAbsolute(c.projectPath), '请选择本地项目的绝对路径')
  assert(['auto', 'npm', 'pnpm', 'yarn'].includes(c.buildTool), '构建工具无效')
  assert(/^[a-zA-Z0-9:_-]+$/.test(c.buildScript), '构建脚本名称无效')
  assert(/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(c.baseDir) && c.baseDir.split('/').length >= 3 && !['/etc', '/usr', '/bin', '/root', '/home'].some(p => c.baseDir === p || c.baseDir.startsWith(p + '/')), '部署目录建议使用 /var/www/deployx，不能使用系统目录')
  assert(!c.https || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email), '申请证书需要填写有效邮箱')
  assert(['minimal', 'http', 'full', 'custom'].includes(c.validation), '验证策略无效')
  c.env = parseEnv(c.envText || '')
  c.checkPaths = (c.checkPaths || ['/']).map(p => { assert(/^\/[A-Za-z0-9/_?.=&%-]*$/.test(p), '检查路径必须以 / 开头且不含空格'); return p })
  c.sites = (c.sites || []).filter(s => s.selected !== false)
  assert(c.sites.length > 0 && c.sites.length <= 500, '请选择 1–500 个站点')
  const domains = new Set(), ports = new Set(), slugs = new Set()
  const reserved = new Set([...occupied.map(Number), ...c.sites.filter(s => s.port).map(s => Number(s.port))])
  let nextPort = Number(c.startPort || 3021)
  for (const site of c.sites) {
    site.domain = site.domain.trim().toLowerCase()
    assert(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(site.domain), `域名格式错误：${site.domain}`)
    assert(!domains.has(site.domain), `域名重复：${site.domain}`); domains.add(site.domain)
    assert(!site.siteKey || /^[A-Za-z0-9_-]+$/.test(site.siteKey), `SITE_KEY 格式错误：${site.domain}`)
    assert(!c.requireSiteKey || site.siteKey, `${site.domain} 缺少 SITE_KEY`)
    if (c.mode === 'node') {
      while (reserved.has(nextPort)) nextPort++
      site.port = site.port ? Number(site.port) : nextPort++
      assert(Number.isInteger(site.port) && site.port >= 1024 && site.port <= 65535, '端口需介于 1024–65535')
      assert(!ports.has(site.port), `端口重复：${site.port}`); ports.add(site.port)
    } else site.port = null
    site.slug = site.domain.replaceAll('.', '-')
    assert(!slugs.has(site.slug), '两个域名生成了相同的部署目录，请分开配置不同的部署根目录'); slugs.add(site.slug)
  }
  return c
}

export async function assertOutputReady(projectPath, output, mode, entry) {
  const root = unwrapPath(projectPath)
  const outDir = path.join(root, output)
  await access(outDir, fsConstants.F_OK).catch(() => { throw new Error(`找不到产物目录 ${output}，请确认构建输出路径`) })
  if (mode === 'static') {
    await access(path.join(outDir, 'index.html'), fsConstants.F_OK).catch(() => { throw new Error(`静态产物缺少 ${output}/index.html`) })
  } else {
    await access(path.join(root, entry), fsConstants.F_OK).catch(() => { throw new Error(`找不到 Node 入口 ${entry}`) })
  }
}

export function redact(text, secrets = []) {
  let value = String(text).replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g, '[私钥已隐藏]')
  for (const secret of secrets.filter(s => typeof s === 'string' && s.length >= 3).sort((a,b) => b.length-a.length)) value = value.replaceAll(secret, '••••••')
  return value.replace(/((?:token|password|secret|authorization)\s*[=:]\s*)[^\s,]+/gi, '$1[已隐藏]')
}
