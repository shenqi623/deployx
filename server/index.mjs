import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { applySystemProxy } from './proxy.mjs'
import { assert, inspectProject, parseCsv, sitesFromRows, validateConfig, redact, assertDeployShape } from './core.mjs'
import { connect, remote } from './ssh.mjs'
import { explainError, formatExplanation } from './errors.mjs'
import { deploySite } from './deploy.mjs'
import { loadSheet, writePorts } from './sheets.mjs'
import { PROBE_COMMAND, buildInstallScript, parseReport, requirementsFromReport } from './bootstrap.mjs'

const proxyUrl = applySystemProxy()
if (proxyUrl) console.log(`DeployX outbound proxy: ${proxyUrl}`)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.env.DEPLOYX_DATA_DIR || process.env.LAUNCHPAD_DATA_DIR || path.join(root, '.deployx')
await mkdir(dataDir, { recursive: true, mode: 0o700 })
const connections = new Map(), sources = new Map(), plans = new Map(), jobs = new Map()
let activeJob = null
let history = []
const startedAt = new Date().toISOString()
try { history = JSON.parse(await readFile(path.join(dataDir, 'history.json'), 'utf8')) } catch {}
history = history.map(j => j.status === 'running' ? {...j,status:'interrupted',phase:'后台已重启；请核实远程状态后再重试'} : j)
const port = Number(process.env.PORT || 4318)
const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://localhost:5173', 'http://127.0.0.1:5173'])
function getConnection(id) { const s = connections.get(id); assert(s && s.expires > Date.now(), '连接会话已过期（本地服务重启或超过 8 小时）。请回到「连接服务器」重新测试连接。'); return s }
function publicJob(j) { return { id: j.id, createdAt: j.createdAt, status: j.status, phase: j.phase, total: j.total, current: j.current, results: j.results, logs: j.logs, stopRequested: j.stopRequested, sheetStatus: j.sheetStatus } }
async function save(j) { history = [publicJob(j), ...history.filter(x => x.id !== j.id)].slice(0,30); const temp=path.join(dataDir,'history.tmp'); await writeFile(temp, JSON.stringify(history), { mode: 0o600 }); await rename(temp,path.join(dataDir,'history.json')) }
async function execute(j, c, credentials, source) {
  const secrets = [credentials.password, credentials.passphrase, ...Object.values(c.env)]
  try {
    await save(j)
    for (const site of c.sites) {
      if (j.stopRequested) break
      j.current = site.domain
      try { j.results.push(await deploySite(c, site, credentials, j, dataDir)) }
      catch(e) {
        const detail = explainError(e, secrets)
        j.log(`\n${site.domain} 部署失败\n${formatExplanation(detail)}`)
        j.results.push({ domain: site.domain, siteKey: site.siteKey, port: site.port, sourceRow: site.sourceRow, status: 'failed', error: detail.title, detail })
        if (!c.continueOnError) break
      }
      await save(j)
    }
    if (source && c.syncSheet) {
      j.phase = '回填表格'
      try { const count = await writePorts(source, j.results); j.sheetStatus = `已回填并读回确认 ${count} 个 Port` }
      catch(e) { j.sheetStatus = `回填失败：${e.message}；可导出 CSV 手动回填`; j.log(j.sheetStatus) }
    }
    j.status = j.stopRequested ? 'stopped' : j.results.some(r => r.status === 'failed') ? 'partial' : 'complete'
  } catch(e) { j.status = 'failed'; j.log(formatExplanation(explainError(e, secrets))) }
  finally { j.phase = '结束'; activeJob = null; await save(j) }
}
async function body(req) {
  let size = 0, data = ''
  for await (const chunk of req) { size += chunk.length; assert(size <= 2 * 1024 * 1024, '请求过大（最多 2MB）'); data += chunk }
  return data ? JSON.parse(data) : {}
}
function friendlyError(error) {
  const message = String(error?.message || error || '')
  if (/ENOENT|no such file|realpath/i.test(message) && /package\.json|project|path|目录|文件夹/i.test(message + (error?.path || ''))) {
    return '找不到这个项目文件夹，它可能已移动或被删除。请重新选择文件夹。'
  }
  if (/ENOENT|no such file/i.test(message)) {
    return '找不到指定的文件或文件夹，请检查路径后重试。'
  }
  if (/package\.json/i.test(message) && /找不到|不存在|no such|ENOTDIR/i.test(message)) {
    return '这个目录不是可识别的前端项目，请选择包含 package.json 的目录。'
  }
  return redact(message)
}
function errorBody(error, secrets = []) {
  const detail = explainError({ message: friendlyError(error), raw: error?.raw }, secrets)
  return { error: detail.title, detail }
}
async function readDraft() {
  try {
    return JSON.parse(await readFile(path.join(dataDir, 'draft.json'), 'utf8'))
  } catch {
    return null
  }
}
async function writeDraft(payload) {
  const temp = path.join(dataDir, 'draft.tmp')
  await writeFile(temp, JSON.stringify(payload ?? null), { mode: 0o600 })
  await rename(temp, path.join(dataDir, 'draft.json'))
}
function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}
const server = http.createServer(async (req, res) => {
  try {
    assert([`localhost:${port}`, `127.0.0.1:${port}`, 'localhost:5173', '127.0.0.1:5173'].includes(req.headers.host), '不允许的 Host')
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin) assert(origins.has(req.headers.origin), '不允许跨站请求本机部署服务')
      if (req.method === 'POST') assert((req.headers['x-deployx-client'] === 'local-ui' || req.headers['x-launchpad-client'] === 'local-ui') && req.headers['content-type']?.includes('application/json'), '请求必须来自本机控制台')
      const b = req.method === 'POST' ? await body(req) : {}
      if (url.pathname === '/api/health') return json(res,200,{ ready:true, activeJob, platform:process.platform, startedAt, desktop:!!process.env.DEPLOYX_DATA_DIR })
      if (url.pathname === '/api/draft' && req.method === 'GET') return json(res,200,{ draft: await readDraft() })
      if (url.pathname === '/api/draft' && req.method === 'POST') {
        if (b.clear) { await writeDraft(null); return json(res,200,{ ok:true }) }
        assert(b.draft && typeof b.draft === 'object', '草稿格式无效')
        await writeDraft(b.draft)
        return json(res,200,{ ok:true })
      }
      if (url.pathname === '/api/project' && req.method === 'POST') {
        try { return json(res,200,await inspectProject(b.path)) }
        catch (e) { return json(res,400,errorBody(e)) }
      }
      if (url.pathname === '/api/import/csv' && req.method === 'POST') return json(res,200,sitesFromRows(parseCsv(b.text)))
      if (url.pathname === '/api/import/sheets' && req.method === 'POST') { const parsed = await loadSheet(b); const id = randomUUID(); sources.set(id,b); return json(res,200,{...parsed,sourceId:id}) }
      if (url.pathname === '/api/server/fingerprint' && req.method === 'POST') return json(res,200,{ fingerprint:await connect(b,true) })
      if (url.pathname === '/api/server/connect' && req.method === 'POST') {
        const client = await connect(b)
        let output
        try { output = await remote(client, PROBE_COMMAND, () => {}, 30000) } finally { client.end() }
        const id = randomUUID(); connections.set(id,{ credentials:b, expires:Date.now()+8*3600000, report:output })
        return json(res,200,{ id, report:output, requirements: requirementsFromReport(output) })
      }
      if (url.pathname === '/api/server/bootstrap' && req.method === 'POST') {
        const connection = getConnection(b.connectionId)
        const before = parseReport(connection.report)
        const { packages, script } = buildInstallScript(b.packages, before)
        const client = await connect(connection.credentials)
        let output = ''
        try {
          output = await remote(client, script, () => {}, 20 * 60 * 1000)
          const report = await remote(client, PROBE_COMMAND, () => {}, 30000)
          connection.report = report
          return json(res,200,{
            packages,
            output: redact(output).slice(-12000),
            report,
            requirements: requirementsFromReport(report),
          })
        } finally { client.end() }
      }
      if (url.pathname === '/api/plans' && req.method === 'POST') {
        let c = validateConfig(b); const connection = getConnection(c.connectionId)
        const project = await inspectProject(c.projectPath)
        assert(project.framework === c.framework, `选择的技术栈（${c.framework}）与项目检测结果（${project.framework}）不一致`)
        assertDeployShape(c, project)
        assert(project.scripts.includes(c.buildScript), '项目中没有此构建脚本')
        const report = connection.report
        assert(report.includes('Linux'), '当前部署器支持 Linux 服务器')
        assert(/NGINX \/.+/.test(report) && /SUDO yes/.test(report), '服务器需先安装 Nginx，并为当前用户配置免密 sudo')
        assert(c.mode !== 'node' || (/PM2 \/.+/.test(report) && /NODE v(?:2[2-9]|[3-9]\d)\./.test(report)), 'Node 模式需要服务器 Node 22+ 和 PM2')
        assert(!c.https || /CERTBOT \/.+/.test(report), '申请证书前需在服务器安装 Certbot 和 nginx 插件')
        const client = await connect(connection.credentials)
        let live
        try {
          live = await remote(client, 'ss -H -ltn; ' + c.sites.map(s => `p='${c.baseDir}/${s.slug}/.deployx-port'; [ -f "$p" ] || p='${c.baseDir}/${s.slug}/.launchpad-port'; if [ -f "$p" ]; then printf 'DX_PORT ${s.domain} '; cat "$p"; printf '\\n'; fi`).join('; '), () => {}, 30000)
        } finally { client.end() }
        const occupied = [...live.matchAll(/(?:\]|[\d.*]):(\d+)\s/g)].map(m=>Number(m[1]))
        const existing = new Map([...live.matchAll(/^(?:DX|LP)_PORT (\S+) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]))
        const nextInput = structuredClone(b)
        nextInput.sites = nextInput.sites.map(s=>({...s,port:s.port||existing.get(s.domain)||null}))
        c = validateConfig(nextInput,occupied)
        assertDeployShape(c, project)
        for(const s of c.sites) if(c.mode==='node' && occupied.includes(s.port)) assert(existing.get(s.domain)===s.port, `${s.domain} 指定的端口 ${s.port} 已被其他服务占用`)
        const id = randomUUID(); plans.set(id,{ config:c, expires:Date.now()+10*60000 })
        return json(res,200,{id,sites:c.sites, framework:c.framework,mode:c.mode,baseDir:c.baseDir,https:c.https,validation:c.validation,steps:['本机构建','上传独立版本','切换版本 / PM2','Nginx 配置',...(c.https?['申请 HTTPS 证书']:[]),...(c.validation!=='minimal'?['可选验证']:[]),...(c.syncSheet?['回填 Port']:[])], notes:[project.detection || `${project.label} · ${c.mode}`,'首次部署会创建独立站点目录；已有非本工具管理的目录将拒绝覆盖。','请确保域名已解析到目标服务器，且 80/443 端口可访问。',...(c.runtimeInstall?['运行时依赖仅安装 production，默认不执行安装脚本。']:[])]})
      }
      if (url.pathname === '/api/jobs' && req.method === 'POST') {
        assert(!activeJob, '已有任务运行中，请等待完成')
        const plan = plans.get(b.planId); assert(plan && plan.expires > Date.now(), '执行计划已过期，请重新生成')
        const c = plan.config, connection = getConnection(c.connectionId)
        const source = c.sourceId ? sources.get(c.sourceId) : null
        assert(!c.syncSheet || source, 'Google 表格连接已失效，请重新导入')
        plans.delete(b.planId)
        const j = {id:randomUUID(),createdAt:new Date().toISOString(),status:'running',phase:'准备',total:c.sites.length,current:'',results:[],logs:[],stopRequested:false,sheetStatus:''}
        j.log = text => { j.logs.push({time:new Date().toISOString(),text:String(text).slice(-6000)}); if(j.logs.length>800)j.logs.shift() }
        jobs.set(j.id,j); activeJob=j.id
        execute(j,c,connection.credentials,source).catch(()=>{})
        return json(res,202,{id:j.id})
      }
      if (url.pathname === '/api/history' && req.method === 'GET') return json(res,200,history.map(j=>({...j,logs:undefined})))
      if (url.pathname === '/api/history/clear' && req.method === 'POST') {
        assert(!activeJob, '部署进行中，请先等待完成或停止后再清除')
        history = []
        const temp = path.join(dataDir, 'history.tmp')
        await writeFile(temp, '[]', { mode: 0o600 })
        await rename(temp, path.join(dataDir, 'history.json'))
        return json(res,200,{ ok:true })
      }
      if (url.pathname === '/api/history') return json(res,404,{error:'接口不存在'})
      if (url.pathname.startsWith('/api/jobs/')) {
        const id = url.pathname.split('/')[3], job = jobs.get(id) || history.find(j=>j.id===id)
        assert(job,'任务不存在')
        if (req.method==='POST' && url.pathname.endsWith('/stop')) { assert(jobs.has(id)&&job.status==='running','任务未运行'); job.stopRequested=true; return json(res,200,{ok:true}) }
        return json(res,200,publicJob(job))
      }
      return json(res,404,{error:'接口不存在'})
    }
    assert(req.method==='GET','不支持的方法')
    let pathname = decodeURIComponent(url.pathname)
    if(pathname==='/') pathname='/index.html'
    const dist = path.join(root,'dist'), file = path.resolve(dist,'.'+pathname)
    assert(file.startsWith(dist+path.sep),'路径无效')
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.ico':'image/x-icon'}
    try { const bytes=await readFile(file); res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'}); res.end(bytes) }
    catch { if(!res.headersSent)res.writeHead(404); res.end('请先运行 pnpm build，或使用 pnpm dev 启动开发界面。') }
  } catch(e) { if(!res.headersSent)json(res,400,errorBody(e)); else res.end() }
})
server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用。请关闭其他 DeployX / pnpm start / pnpm dev，或设置环境变量 PORT 换端口后重试。`)
    process.exit(1)
  }
  throw err
})
server.listen(port,'127.0.0.1',()=>console.log(`DeployX local API: http://127.0.0.1:${port}`))
setInterval(()=>{for(const [id,s]of connections)if(s.expires<Date.now())connections.delete(id);for(const[id,p]of plans)if(p.expires<Date.now())plans.delete(id)},60000).unref()
