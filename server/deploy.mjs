import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, cp, rm, stat, lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { assert, quote as q, parseEnv, envText, redact } from './core.mjs'
import { connect, remote, upload } from './ssh.mjs'

export function run(file, args, options = {}, log = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, windowsHide: true, stdio: ['ignore','pipe','pipe'] })
    let tail = ''
    const collect = b => { const s = b.toString(); tail = (tail + s).slice(-3000); log(s) }
    const timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error('本地命令执行超时'), { raw: tail })) }, 20 * 60 * 1000)
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Object.assign(new Error(`本地命令退出码 ${code}`), { raw: `本地命令退出码 ${code}\n${tail}` })) })
  })
}
async function safeOutput(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), '构建产物包含符号链接；请先生成可独立部署的产物')
    if (entry.isDirectory()) await safeOutput(path.join(directory, entry.name))
  }
}
async function build(c, env, log) {
  const pkg = JSON.parse(await readFile(path.join(c.projectPath, 'package.json'), 'utf8'))
  assert(pkg.scripts?.[c.buildScript], `项目缺少 ${c.buildScript} 脚本`)
  const opts = { cwd: c.projectPath, env: { ...process.env, ...env, ASTRO_TELEMETRY_DISABLED: '1' } }
  if (c.buildTool === 'auto' && /^(astro|vite) build$/.test(pkg.scripts[c.buildScript].trim())) {
    const tool = pkg.scripts[c.buildScript].startsWith('astro') ? 'astro' : 'vite'
    const dir = path.join(c.projectPath, 'node_modules', tool)
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[tool]
    await run(process.execPath, [path.join(dir, bin), 'build'], opts, log)
  } else {
    const pm = c.buildTool === 'auto' ? (pkg.packageManager?.split('@')[0] || 'npm') : c.buildTool
    assert(['npm','pnpm','yarn'].includes(pm), '不支持此包管理器')
    if (process.platform === 'win32') await run(process.env.ComSpec || 'cmd.exe', ['/d','/s','/c', `${pm}.cmd run ${c.buildScript}`], opts, log)
    else await run(pm, ['run', c.buildScript], opts, log)
  }
}
export function buildEcosystem(c, site, target, name) {
  const port = String(site.port || '')
  if (c.mode !== 'node') return null
  if (c.runner === 'next-start' || (c.framework === 'next' && c.mode === 'node')) {
    return {
      apps: [{
        name,
        cwd: target,
        script: 'node_modules/next/dist/bin/next',
        args: `start -H 127.0.0.1 -p ${port}`,
        interpreter: 'node',
        env: { NODE_ENV: 'production', PORT: port, HOSTNAME: '127.0.0.1' },
      }],
    }
  }
  return {
    apps: [{
      name,
      script: `${target}/${c.entry}`,
      cwd: target,
      interpreter: 'node',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: port,
        NITRO_HOST: '127.0.0.1',
        NITRO_PORT: port,
      },
    }],
  }
}

export function remoteScript(c, site, release, archive, env) {
  const root = `${c.baseDir}/${site.slug}`, target = `${root}/releases/${release}`, name = `lp-${site.slug}`
  const config = `/etc/nginx/sites-available/${name}`
  const ecosystem = buildEcosystem(c, site, target, name)
  const nginx = `server {\n listen 80;\n listen [::]:80;\n server_name ${site.domain};\n${c.mode === 'node' ? ` location / {\n  proxy_pass http://127.0.0.1:${site.port};\n  proxy_http_version 1.1;\n  proxy_set_header Host $host;\n  proxy_set_header X-Real-IP $remote_addr;\n  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n  proxy_set_header X-Forwarded-Proto $scheme;\n }` : ` root ${root}/current/${c.output};\n index index.html;\n location / { try_files $uri $uri/ ${c.spa ? '/index.html' : '=404'}; }`}\n}\n`
  const b64 = s => Buffer.from(s).toString('base64')
  const needsInstall = !!(c.runtimeInstall && c.mode === 'node') || (c.framework === 'next' && c.mode === 'node')
  return `set -eu
root=${q(root)}
target=${q(target)}
config=${q(config)}
previous=''
new_config=0
committed=0
if [ -e "$root" ] && [ ! -f "$root/.deployx-owned" ] && [ ! -f "$root/.launchpad-owned" ]; then echo '目录不属于此控制台，请更换部署根目录，避免覆盖已有站点'; exit 21; fi
test ! -L "$root" || { echo '站点目录不能是符号链接'; exit 21; }
domain_file="$root/.deployx-domain"; [ -f "$domain_file" ] || domain_file="$root/.launchpad-domain"
if [ -f "$domain_file" ]; then test "$(cat "$domain_file")" = ${q(site.domain)} || { echo '部署目录已由另一个域名使用'; exit 21; }; fi
mode_file="$root/.deployx-mode"; [ -f "$mode_file" ] || mode_file="$root/.launchpad-mode"
if [ -f "$mode_file" ]; then test "$(cat "$mode_file")" = ${q(c.mode)} || { echo '已有站点不能直接切换静态/Node模式，请使用新部署根目录'; exit 22; }; fi
${c.mode === 'node' ? `port_file="$root/.deployx-port"; [ -f "$port_file" ] || port_file="$root/.launchpad-port"
if [ -f "$port_file" ]; then test "$(cat "$port_file")" = ${q(site.port)} || { echo '已有站点的端口发生变化，请使用原端口'; exit 23; }; elif [ -n "$(ss -H -ltn 'sport = :${site.port}')" ]; then echo '端口 ${site.port} 已占用'; exit 24; fi` : ''}
if [ -e "$config" ] && [ ! -f "$root/.deployx-owned" ] && [ ! -f "$root/.launchpad-owned" ]; then echo 'Nginx 配置冲突'; exit 25; fi
if [ ! -d ${q(c.baseDir)} ]; then sudo -n install -d -m 755 -o "$(id -un)" -g "$(id -gn)" ${q(c.baseDir)}; fi
mkdir -p "$root/releases"
touch "$root/.deployx-owned"
printf '%s' ${q(site.domain)} > "$root/.deployx-domain"
printf '%s' ${q(c.mode)} > "$root/.deployx-mode"
${c.mode === 'node' ? `printf '%s' ${q(site.port)} > "$root/.deployx-port"` : ''}
test ! -e "$target"
mkdir -m 755 "$target"
tar -xzf ${q(archive)} -C "$target"
chmod 755 "$target"
chmod 600 "$target/.env"
previous=$(readlink "$root/current" || true)
rollback() {
 code=$?
 if [ "$code" -ne 0 ] && [ "$committed" -eq 0 ] && [ -n "$previous" ]; then
  echo '部署未完成，恢复上一个版本'
  ln -s "$previous" "$root/rollback-${release}"
  mv -Tf "$root/rollback-${release}" "$root/current"
  ${c.mode === 'node' ? `if [ -f "$previous/ecosystem.json" ]; then pm2 delete ${q(name)} --silent >/dev/null 2>&1 || true; pm2 start "$previous/ecosystem.json" --update-env >/dev/null || true; elif [ -f "$previous/ecosystem.cjs" ]; then pm2 startOrReload "$previous/ecosystem.cjs" --update-env >/dev/null || true; fi` : ':'}
  sudo -n nginx -t && sudo -n systemctl reload nginx || true
 fi
 if [ "$code" -ne 0 ] && [ "$new_config" -eq 1 ] && [ -z "$previous" ]; then echo '首次部署未完成，保留现场，请从失败日志修复后重试'; fi
 exit "$code"
}
trap rollback EXIT
${needsInstall ? `cd "$target"
npm install --omit=dev --no-audit --no-fund --ignore-scripts` : ''}
${c.framework === 'next' && c.mode === 'node' ? `test -f "$target/node_modules/next/dist/bin/next" || { echo 'Next.js 运行时未安装成功'; exit 26; }` : ''}
${c.framework === 'nuxt' && c.mode === 'node' ? `test -f "$target/${c.entry}" || { echo '找不到 Nuxt 入口 .output/server/index.mjs'; exit 26; }` : ''}
ln -s "$target" "$root/next-${release}"
mv -Tf "$root/next-${release}" "$root/current"
${c.mode === 'node' ? `printf '%s' ${q(b64(JSON.stringify(ecosystem)))} | base64 -d > "$target/ecosystem.json"
pm2 delete ${q(name)} --silent >/dev/null 2>&1 || true
pm2 start "$target/ecosystem.json" --update-env` : ''}
if [ ! -e "$config" ]; then
 printf '%s' ${q(b64(nginx))} | base64 -d | sudo -n tee "$config" >/dev/null
 sudo -n ln -s "$config" ${q(`/etc/nginx/sites-enabled/${name}`)}
 new_config=1
fi
sudo -n nginx -t
sudo -n systemctl reload nginx
${c.https ? `sudo -n certbot --nginx -d ${q(site.domain)} --email ${q(c.email)} --agree-tos --no-eff-email --redirect --non-interactive --keep-until-expiring` : ''}
${c.mode === 'node' ? 'pm2 save >/dev/null' : ''}
committed=1
if [ -n "$previous" ]; then printf '%s' "$previous" > "$root/previous-release"; fi
rm -f ${q(archive)}
echo 'DEPLOYMENT_COMPLETE'
`
}

async function stageArtifacts(c, stage) {
  if (c.framework === 'next' && c.mode === 'node') {
    const nextDir = path.join(c.projectPath, '.next')
    assert((await lstat(nextDir)).isDirectory(), '找不到 .next，请先执行 next build')
    await safeOutput(nextDir)
    await cp(nextDir, path.join(stage, '.next'), { recursive: true })
    try { await cp(path.join(c.projectPath, 'public'), path.join(stage, 'public'), { recursive: true }) } catch {}
    await cp(path.join(c.projectPath, 'package.json'), path.join(stage, 'package.json'))
    for (const name of ['next.config.mjs', 'next.config.js', 'next.config.ts', 'next.config.cjs', 'next.config.mts']) {
      try { await cp(path.join(c.projectPath, name), path.join(stage, name)) } catch {}
    }
    return
  }
  const output = path.join(c.projectPath, c.output)
  assert((await lstat(output)).isDirectory(), '构建产物目录不存在或为符号链接')
  await safeOutput(output)
  await cp(output, path.join(stage, c.output), { recursive: true })
  if (c.mode === 'node' && c.runner !== 'next-start') {
    assert((await stat(path.join(c.projectPath, c.entry))).isFile(), '找不到 Node 入口，请检查产物路径')
    assert(c.entry === c.output || c.entry.startsWith(c.output + '/'), 'Node 入口必须位于产物目录内')
  }
  if (c.mode === 'static') assert((await stat(path.join(output, 'index.html'))).isFile(), '静态产物缺少 index.html')
}

export async function deploySite(c, site, credentials, job, dataDir) {
  const release = `${Date.now()}-${randomUUID().slice(0,8)}`
  const stage = path.join(dataDir, 'work', release), archive = stage + '.tar.gz'
  let env = {}
  if (c.loadEnv) { try { env = parseEnv(await readFile(path.join(c.projectPath, '.env'), 'utf8')) } catch(e) { if (e.code !== 'ENOENT') throw e } }
  env = { ...env, ...c.env, ...(site.siteKey ? { SITE_KEY: site.siteKey } : {}), ...(c.framework === 'astro' ? { ASTRO_OUTPUT: c.mode === 'node' ? 'server' : 'static' } : {}) }
  const secrets = [credentials.password, credentials.passphrase, ...Object.entries(env).filter(([k]) => /token|secret|password|key|auth/i.test(k)).map(([,v]) => v)]
  let pending = ''
  const log = s => { pending += s; const lines = pending.split('\n'); pending = lines.pop(); for (const line of lines) job.log(redact(line + '\n', secrets)) }
  const phase = name => { job.phase = name; log(`\n── ${site.domain} · ${name} ──\n`) }
  let client
  try {
    phase('构建'); await build(c, env, log)
    await mkdir(stage, { recursive: true, mode: 0o700 })
    await stageArtifacts(c, stage)
    await writeFile(path.join(stage, '.env'), envText(env), { mode: 0o600 })
    const needsPackage = (c.runtimeInstall && c.mode === 'node') || (c.framework === 'next' && c.mode === 'node')
    if (needsPackage) {
      const pkg = JSON.parse(await readFile(path.join(c.projectPath, 'package.json'), 'utf8'))
      assert(!Object.values(pkg.dependencies || {}).some(v => /^(workspace:|file:|link:)/.test(v)), '运行时依赖含 workspace/file 链接；请先生成独立 bundle，或使用独立部署目录')
      if (c.framework === 'next' && c.mode === 'node') {
        // keep original package.json already copied in stageArtifacts
      } else {
        await writeFile(path.join(stage, 'package.json'), JSON.stringify({ private: true, type: pkg.type || 'module', dependencies: pkg.dependencies || {} }))
      }
    }
    await run('tar', ['-czf', archive, '-C', stage, '.'], {}, log)
    phase('上传'); client = await connect(credentials)
    const remoteArchive = `/tmp/deployx-${release}.tar.gz`
    await upload(client, archive, remoteArchive)
    phase('发布')
    const scriptFile = path.join(stage, 'deploy.sh')
    await writeFile(scriptFile, remoteScript(c, site, release, remoteArchive, env))
    const remoteFile = `/tmp/deployx-${release}.sh`
    await upload(client, scriptFile, remoteFile)
    try { await remote(client, `bash ${q(remoteFile)}`, log) }
    finally { await remote(client, `rm -f ${q(remoteFile)} ${q(remoteArchive)}`).catch(() => {}) }
    if (c.validation !== 'minimal') {
      phase('可选验证')
      const origin = `${c.https ? 'https' : 'http'}://${site.domain}`
      const paths = c.validation === 'full' ? ['/', '/sitemap.xml'] : c.validation === 'custom' ? c.checkPaths : ['/']
      for (const p of paths) {
        const response = await fetch(origin + p, { signal: AbortSignal.timeout(20000) })
        assert(response.ok, `${p} 返回 HTTP ${response.status}`)
        const body = await response.text()
        if (p === '/' && c.validation === 'full') assert(body.includes(`href="${origin}/"`) && body.includes('canonical'), '首页未找到匹配的 canonical')
        log(`${p} → ${response.status}\n`)
      }
      if (c.validation === 'full' && c.https) {
        const r = await fetch(`http://${site.domain}/`, { redirect: 'manual', signal: AbortSignal.timeout(20000) })
        assert([301,302,307,308].includes(r.status) && r.headers.get('location')?.startsWith(origin), 'HTTP 未正确跳转 HTTPS')
      }
    }
    return { domain: site.domain, port: site.port, siteKey: site.siteKey, sourceRow: site.sourceRow, status: 'deployed', release }
  } catch(e) { throw Object.assign(new Error(redact(e.message, secrets)), e.raw ? { raw: redact(e.raw, secrets) } : {}) }
  finally { if(pending)job.log(redact(pending,secrets)); client?.end(); await rm(stage, { recursive: true, force: true }); await rm(archive, { force: true }) }
}
