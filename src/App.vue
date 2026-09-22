<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import './style.css'
type Site = { seq: string; domain: string; siteKey: string; port: number | null; selected: boolean; sourceRow?: number }
type Result = { domain: string; siteKey: string; port: number | null; status: string; error?: string }
type Job = { id: string; createdAt: string; status: string; phase: string; total: number; current: string; results: Result[]; logs: {time:string;text:string}[]; stopRequested?: boolean; sheetStatus?: string }
type Plan = { id: string; sites: Site[]; steps: string[]; notes: string[]; mode: string; baseDir: string; validation: string; https: boolean }
type Project = { name: string; framework: string; label?: string; mode: string; output: string; entry: string; spa: boolean; scripts: string[]; envKeys: string[]; adapter: boolean; requireSiteKey?: boolean; buildScript?: string; detection?: string; nextSsr?: boolean; nuxtSsr?: boolean; outputMode?: string; runtimeInstall?: boolean; runner?: string }
type RequirementItem = { id: string; label: string; ok: boolean; required: boolean; detail?: string }
type Requirements = { osFamily: string; distroId: string; hasSudo: boolean; missing: string[]; canBootstrap: boolean; ready: boolean; items: RequirementItem[] }
const frameworkOptions = [
  { id: 'vue', name: 'Vue', hint: '普通前端站', icon: 'V', ssr: '动态请用 Nuxt' },
  { id: 'react', name: 'React', hint: '普通前端站', icon: '⚛', ssr: '动态请用 Next' },
  { id: 'astro', name: 'Astro', hint: '官网 / 内容站', icon: 'A', ssr: '静态或动态都行' },
  { id: 'nuxt', name: 'Nuxt', hint: 'Vue 全家桶', icon: 'N', ssr: '静态或动态都行' },
  { id: 'next', name: 'Next', hint: 'React 全家桶', icon: '◆', ssr: '静态或动态都行' },
]
type GuideInfo = { title: string; summary: string; build: string; output: string; entry: string; deploy: string; steps: string[]; tip?: string }
const deployGuides: Record<string, { static: GuideInfo; node: GuideInfo | null }> = {
  vue: {
    static: {
      title: 'Vue 前端网站（推荐新手）',
      summary: '页面在用户浏览器里运行。打包后只有网页文件，服务器不需要再跑 Node。',
      build: '在项目目录执行：npm run build',
      output: 'dist/（打包结果文件夹）',
      entry: '不需要（没有后台程序）',
      deploy: '把网页文件放到服务器，用 Nginx 直接打开给用户访问',
      steps: ['确认这是用 Vite 创建的 Vue 项目', '本机先能成功执行构建（得到 dist 文件夹）', '这里选「静态网站」', '点「识别项目」核对后，继续下一步'],
      tip: '如果需要「搜索引擎更好收录」或「服务端渲染」，请改选 Nuxt，不要选 Vue + Node。',
    },
    node: null,
  },
  react: {
    static: {
      title: 'React 前端网站（推荐新手）',
      summary: '和 Vue 一样：打包成网页文件，用 Nginx 直接托管即可。',
      build: '在项目目录执行：npm run build',
      output: 'dist/（打包结果文件夹）',
      entry: '不需要（没有后台程序）',
      deploy: '把网页文件放到服务器，用 Nginx 直接打开给用户访问',
      steps: ['确认这是用 Vite 创建的 React 项目', '本机先能成功构建出 dist', '这里选「静态网站」', '点「识别项目」核对后继续'],
      tip: '如果需要服务端渲染，请改选 Next.js。',
    },
    node: null,
  },
  astro: {
    static: {
      title: 'Astro 静态官网',
      summary: '构建时就生成好每一页的 HTML，适合公司官网、内容站。服务器只负责「发文件」。',
      build: '在项目目录执行：npm run build',
      output: 'dist/',
      entry: '不需要',
      deploy: 'Nginx 直接托管 dist 里的网页文件',
      steps: ['确认项目默认是静态输出（多数 Astro 项目如此）', '本机构建成功，得到 dist', '选「静态网站」', '继续填写域名并部署'],
    },
    node: {
      title: 'Astro 动态网站（需要 Node）',
      summary: '页面由服务器实时生成。用户访问域名时，Nginx 把请求转给后台的 Node 程序。',
      build: '在项目目录执行：npm run build',
      output: 'dist/',
      entry: 'dist/server/entry.mjs（后台启动文件）',
      deploy: 'PM2 在服务器上启动 Node；Nginx 把域名请求转到这个程序（反向代理）',
      steps: ['项目需已安装 @astrojs/node，且配置为 standalone', '构建后确认有 dist/server/entry.mjs', '选「动态网站（Node）」', '在部署设置里填好起始端口（给后台程序用）'],
      tip: '没配好 Node 适配器时，系统会在生成计划时拦住你，避免上线失败。',
    },
  },
  nuxt: {
    static: {
      title: 'Nuxt 静态生成',
      summary: '提前生成好网页文件再上传。适合内容相对固定的站点。',
      build: '推荐执行：npm run generate（或 nuxt generate）',
      output: '.output/public/',
      entry: '不需要',
      deploy: 'Nginx 托管 .output/public 里的文件',
      steps: ['使用 generate 生成静态页', '确认产物在 .output/public', '选「静态网站」', '构建脚本填 generate'],
    },
    node: {
      title: 'Nuxt 动态网站（SSR）',
      summary: '服务器实时渲染页面。适合需要登录态、个性化内容的站点。',
      build: '在项目目录执行：npm run build',
      output: '.output/',
      entry: '.output/server/index.mjs',
      deploy: 'PM2 启动 Node；Nginx 把域名转到该程序（反向代理）',
      steps: ['执行 nuxt build / npm run build', '确认有 .output/server/index.mjs', '选「动态网站（Node）」', '继续连接服务器并部署'],
    },
  },
  next: {
    static: {
      title: 'Next.js 静态导出',
      summary: '导出成纯网页文件。需在 next.config 里写上 output: "export"。',
      build: '在项目目录执行：npm run build',
      output: 'out/',
      entry: '不需要',
      deploy: 'Nginx 托管 out 文件夹',
      steps: ['在 next.config 写上 output: "export"', '构建后得到 out 文件夹', '选「静态网站」', '不要用「动态网站」模式'],
      tip: '如果没写 export，识别时会自动当成需要 Node 的 SSR 项目。',
    },
    node: {
      title: 'Next.js 动态网站（SSR）',
      summary: '标准生产模式：服务器上运行 next start，由 Nginx 转发域名访问。',
      build: '在项目目录执行：npm run build',
      output: '.next/（还会带上 public、package.json）',
      entry: '由系统用 next start 启动（你不用手填复杂命令）',
      deploy: '上传产物 → 服务器安装依赖 → PM2 启动 → Nginx 反向代理到该服务',
      steps: ['不要设置 output: "export"', '本机构建成功', '选「动态网站（Node）」', '确保 package.json 里没有 workspace: 之类本机专用依赖'],
      tip: '服务器需要能访问 npm；第一次部署会稍慢，因为要装依赖。',
    },
  },
}
const modeLockedToStatic = computed(() => config.framework === 'vue' || config.framework === 'react')
const activeGuide = computed((): GuideInfo => {
  const pack = deployGuides[config.framework] ?? {
    static: {
      title: '通用静态站点',
      summary: '构建产物由 Nginx 托管。',
      build: 'npm run build',
      output: 'dist/',
      entry: '无（不需要）',
      deploy: 'Nginx 托管产物目录',
      steps: ['构建项目', '确认产物目录', '选「静态站点 · Nginx」'],
    },
    node: null,
  }
  if (config.mode === 'node') return pack.node ?? pack.static
  return pack.static
})
const guideModeNote = computed(() => {
  if (modeLockedToStatic.value && config.mode === 'node') return 'Vue / React（Vite）只能做静态网站。需要服务端渲染时，请改选 Nuxt（对应 Vue）或 Next（对应 React）。'
  return ''
})
const presetMap: Record<string, { mode: string; output: string; entry: string; spa: boolean; requireSiteKey: boolean; buildScript: string; runtimeInstall?: boolean; runner?: string }> = {
  vue: { mode: 'static', output: 'dist', entry: '', spa: true, requireSiteKey: false, buildScript: 'build', runner: 'static' },
  react: { mode: 'static', output: 'dist', entry: '', spa: true, requireSiteKey: false, buildScript: 'build', runner: 'static' },
  astro: { mode: 'static', output: 'dist', entry: '', spa: false, requireSiteKey: true, buildScript: 'build', runner: 'static' },
  nuxt: { mode: 'static', output: '.output/public', entry: '', spa: false, requireSiteKey: false, buildScript: 'generate', runner: 'static' },
  next: { mode: 'static', output: 'out', entry: '', spa: false, requireSiteKey: false, buildScript: 'build', runner: 'static' },
}
const steps = [
  { name: '选择项目', desc: '告诉系统你要部署什么', brief: '填写本地项目路径，选好技术栈。下方指南会告诉你该怎么构建、产物在哪。' },
  { name: '连接服务器', desc: '登录你的云服务器', brief: '输入服务器地址和登录方式。先核对指纹，再测试连接；缺软件时可一键安装。' },
  { name: '站点清单', desc: '要上线哪些域名', brief: '添加一个或多个域名，并勾选本次要部署的站点。' },
  { name: '部署设置', desc: 'HTTPS、目录与检查', brief: '确认部署方式、是否开启 HTTPS，以及上线后怎么验活。拿不准就用默认。' },
  { name: '确认执行', desc: '先看计划再动手', brief: '生成计划只会检查配置，不会改服务器。确认无误后再开始部署。' },
  { name: '任务中心', desc: '看进度和结果', brief: '实时查看每个站点的进度、日志和成败结果。' },
]
const overviewModeLabel = computed(() => config.mode === 'node'
  ? '动态网站（Node + Nginx 反向代理）'
  : '静态网站（Nginx 直接托管）')
const step = ref(0), online = ref(false), busy = ref(''), error = ref(''), notice = ref('')
const stepHelp = computed(() => ([
  { title: '这一步做什么？', body: '把「本地项目」告诉 DeployX。优先点「识别项目」，它会自动选好静态或动态、产物目录；你也可以对照下方指南自己勾选。' },
  { title: '这一步做什么？', body: '连接云服务器（通常是 Ubuntu）。指纹用来确认「连的是你的那台机器」。连上后若缺 Nginx / Node / PM2，可一键安装。' },
  { title: '这一步做什么？', body: '列出要上线的域名。可以手动添加，也可以用 CSV 批量导入。勾选本次要部署的行即可。' },
  { title: '这一步做什么？', body: '确认 HTTPS（推荐开启）、服务器存放目录，以及部署后检查到什么程度。新手建议保持默认。' },
  { title: '这一步做什么？', body: '先「生成执行计划」看清会改什么。打勾确认后才会真正构建并上传到服务器。' },
  { title: '这一步做什么？', body: '部署进行中可看日志。失败站点可单独重试；成功的一般不用再处理。' },
][step.value] || { title: '提示', body: '' }))
const project = ref<Project | null>(null), plan = ref<Plan | null>(null), job = ref<Job | null>(null), history = ref<Job[]>([])
const config = reactive(createDefaultConfig())
const server = reactive({host:'',port:22,username:'ubuntu',auth:'key',keyPath:'',passphrase:'',password:'',agent:'',fingerprint:''})
const fingerprint = ref(''), trusted = ref(false), report = ref(''), connected = ref(false)
const requirements = ref<Requirements | null>(null), bootstrapLog = ref('')
const importMode = ref('manual'), csv = ref(''), range = reactive({from:1,to:50})
const newSite = reactive({domain:'',siteKey:'',port:null as number|null})
const acknowledge = ref(false), customPaths = ref('/\n/sitemap.xml')
const selected = computed(()=>config.sites.filter(s=>s.selected))
const successful = computed(()=>job.value?.results.filter(r=>r.status==='deployed').length || 0)
const failed = computed(()=>job.value?.results.filter(r=>r.status==='failed').length || 0)
const progress = computed(() => {
  if (!job.value || !job.value.total) return 0
  return Math.round(job.value.results.length / job.value.total * 100)
})
const progressHeadline = computed(() => {
  if (!job.value) return ''
  if (job.value.status === 'running' && job.value.results.length === 0) return '进行中'
  return String(progress.value)
})
const showProgressPercent = computed(() => !(job.value?.status === 'running' && job.value.results.length === 0))
const lastLogAt = computed(() => {
  const last = job.value?.logs?.at(-1)?.time
  return last ? last.slice(11, 19) : ''
})
const isDesktop = computed(() => typeof window !== 'undefined' && !!(window as Window & { deployxDesktop?: { isDesktop?: boolean } }).deployxDesktop?.isDesktop)
const pathPlaceholder = computed(() => (navigator.platform || '').toLowerCase().includes('mac')
  ? '例如 /Users/你/Projects/my-site'
  : '例如 D:\\Project\\Apps\\consumer')
const keyPathPlaceholder = computed(() => (navigator.platform || '').toLowerCase().includes('mac')
  ? '例如 /Users/你/.ssh/id_ed25519'
  : '例如 C:\\Users\\你\\.ssh\\id_ed25519')
const readyCount = computed(()=>[!!project.value,connected.value,selected.value.length>0,!!config.email||!config.https].filter(Boolean).length)
const statusLabel = (s:string)=>({running:'进行中',complete:'已完成',partial:'部分失败',failed:'失败',stopped:'已停止',interrupted:'已中断',deployed:'已部署'}[s] || s)
function createDefaultConfig() {
  return {
    projectPath: '',
    framework: 'astro',
    mode: 'static',
    output: 'dist',
    entry: '',
    spa: false,
    buildTool: 'auto',
    buildScript: 'build',
    baseDir: '/var/www/deployx',
    startPort: 3021,
    https: true,
    email: '',
    validation: 'minimal',
    checkPaths: ['/'],
    loadEnv: true,
    envText: '',
    requireSiteKey: true,
    runtimeInstall: false,
    runner: 'static',
    continueOnError: true,
    syncSheet: false,
    sourceId: '',
    connectionId: '',
    sites: [] as Site[],
  }
}
function normalizeLocalPath(value: string) {
  let path = String(value || '').trim()
  while ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) {
    path = path.slice(1, -1).trim()
  }
  return path
}
function normalizeDomain(raw: string) {
  let domain = String(raw || '').trim().toLowerCase()
  domain = domain.replace(/^https?:\/\//i, '')
  domain = domain.replace(/[/?#].*$/, '')
  domain = domain.replace(/:\d+$/, '')
  domain = domain.replace(/\.$/, '')
  return domain
}
function onProjectPathInput(e: Event) {
  config.projectPath = normalizeLocalPath((e.target as HTMLInputElement).value)
  project.value = null
}
function onKeyPathInput(e: Event) {
  server.keyPath = normalizeLocalPath((e.target as HTMLInputElement).value)
}
async function pickProjectDir() {
  const desktop = (window as Window & { deployxDesktop?: { pickDirectory: () => Promise<string | null> } }).deployxDesktop
  if (!desktop?.pickDirectory) {
    error.value = '当前环境不支持文件夹选择，请手动粘贴路径。'
    return
  }
  const chosen = await desktop.pickDirectory()
  if (!chosen) return
  config.projectPath = normalizeLocalPath(chosen)
  project.value = null
}
async function pickKeyFile() {
  const desktop = (window as Window & { deployxDesktop?: { pickFile: (filters?: unknown) => Promise<string | null> } }).deployxDesktop
  if (!desktop?.pickFile) {
    error.value = '当前环境不支持文件选择，请手动粘贴私钥路径。'
    return
  }
  const chosen = await desktop.pickFile([
    { name: '私钥', extensions: ['pem', 'key'] },
    { name: '所有文件', extensions: ['*'] },
  ])
  if (!chosen) return
  server.keyPath = normalizeLocalPath(chosen)
}
async function api<T>(url:string,data?:unknown):Promise<T>{
  let response: Response
  try {
    response = await fetch('/api'+url, data===undefined ? undefined : {method:'POST',headers:{'Content-Type':'application/json','X-DeployX-Client':'local-ui'},body:JSON.stringify(data)})
  } catch {
    throw new Error(isDesktop.value
      ? '部署服务已断开。请重新打开 DeployX；若刚关闭过，请稍等几秒再试。'
      : '无法连接本地服务。请确认本地服务已启动。')
  }
  let body: { error?: string } = {}
  try { body = await response.json() } catch { /* non-json */ }
  if (!response.ok) {
    const message = body.error || `请求失败（HTTP ${response.status}）`
    if (/连接会话已过期/.test(message)) clearConnection('连接会话已失效，请重新连接服务器。')
    throw new Error(message)
  }
  return body as T
}
function clearConnection(reason?: string, resetTrust = false) {
  connected.value = false
  config.connectionId = ''
  report.value = ''
  requirements.value = null
  bootstrapLog.value = ''
  plan.value = null
  if (resetTrust) {
    fingerprint.value = ''
    trusted.value = false
  }
  if (reason) {
    notice.value = reason
    step.value = 1
  }
}
function syncServerEpoch(startedAt?: string) {
  if (!startedAt) return
  const previous = sessionStorage.getItem('deployx-server-started-at')
  if (previous && previous !== startedAt && connected.value) clearConnection('本地服务已重启，SSH 会话已清空。请重新测试连接。')
  sessionStorage.setItem('deployx-server-started-at', startedAt)
}
async function action(name:string,fn:()=>Promise<void>){busy.value=name;error.value='';notice.value='';try{await fn()}catch(e){error.value=e instanceof Error?e.message:String(e)}finally{busy.value=''}}
function selectFramework(f:string){
  const preset = presetMap[f] ?? {
    mode: 'static', output: 'dist', entry: '', spa: true, requireSiteKey: false, buildScript: 'build', runner: 'static',
  }
  config.framework = f
  Object.assign(config, {
    mode: preset.mode,
    output: preset.output,
    entry: preset.entry,
    spa: preset.spa,
    requireSiteKey: preset.requireSiteKey,
    buildScript: preset.buildScript,
    runtimeInstall: !!preset.runtimeInstall,
    runner: preset.runner || 'static',
  })
  project.value = null
}
function applyDetected(p: Project) {
  config.framework = p.framework
  Object.assign(config, {
    mode: p.mode,
    output: p.output,
    entry: p.entry || '',
    spa: p.spa,
    requireSiteKey: p.requireSiteKey ?? (p.framework === 'astro'),
    buildScript: p.buildScript || config.buildScript,
    runtimeInstall: !!p.runtimeInstall,
    runner: p.runner || (p.mode === 'node' ? 'node-file' : 'static'),
  })
  project.value = p
}
function selectMode(mode: 'static' | 'node') {
  if ((config.framework === 'vue' || config.framework === 'react') && mode === 'node') {
    error.value = config.framework === 'vue'
      ? 'Vue（Vite）只能部署成静态网站。若要服务端渲染，请改选 Nuxt。'
      : 'React（Vite）只能部署成静态网站。若要服务端渲染，请改选 Next.js。'
    return
  }
  config.mode = mode
  if (mode === 'static') {
    config.entry = ''
    config.runner = 'static'
    config.runtimeInstall = false
    if (config.framework === 'nuxt') { config.output = '.output/public'; config.buildScript = 'generate' }
    else if (config.framework === 'next') { config.output = 'out'; config.buildScript = 'build' }
    else if (config.framework === 'astro') { config.output = 'dist'; config.buildScript = 'build' }
    else { config.output = 'dist'; config.buildScript = 'build'; config.spa = true }
    if (['astro', 'nuxt', 'next'].includes(config.framework)) config.spa = false
  } else if (config.framework === 'next') {
    config.output = '.next'
    config.entry = 'node_modules/next/dist/bin/next'
    config.runner = 'next-start'
    config.runtimeInstall = true
    config.buildScript = 'build'
  } else if (config.framework === 'nuxt') {
    config.output = '.output'
    config.entry = '.output/server/index.mjs'
    config.runner = 'node-file'
    config.runtimeInstall = false
    config.buildScript = 'build'
  } else if (config.framework === 'astro') {
    config.output = 'dist'
    config.entry = 'dist/server/entry.mjs'
    config.runner = 'node-file'
    config.buildScript = 'build'
  }
}
async function inspect(){await action('识别项目',async()=>{config.projectPath=normalizeLocalPath(config.projectPath);const p=await api<Project>('/project',{path:config.projectPath});applyDetected(p);notice.value=`已识别 ${p.name}：${p.detection || (p.mode==='node'?'Node 服务':'静态站点')}`})}
async function getFingerprint(){await action('读取指纹',async()=>{server.keyPath=normalizeLocalPath(server.keyPath);const r=await api<{fingerprint:string}>('/server/fingerprint',server);fingerprint.value=r.fingerprint;trusted.value=false})}
async function connect(){await action('连接服务器',async()=>{if(!trusted.value)throw new Error('请先核实并确认服务器指纹');server.keyPath=normalizeLocalPath(server.keyPath);const r=await api<{id:string;report:string;requirements:Requirements}>('/server/connect',{...server,fingerprint:fingerprint.value});config.connectionId=r.id;report.value=r.report;requirements.value=r.requirements;bootstrapLog.value='';connected.value=true;server.password='';server.passphrase='';notice.value=r.requirements.missing.length?`连接成功。检测到缺失：${r.requirements.missing.join('、')}。可一键安装（Ubuntu/Debian）。`:'连接成功。认证信息仅保留在后台会话中，不写入配置文件。'})}
async function bootstrapDeps(){await action('安装依赖',async()=>{if(!config.connectionId)throw new Error('请先连接服务器');const r=await api<{report:string;requirements:Requirements;output:string;packages:string[]}>('/server/bootstrap',{connectionId:config.connectionId});report.value=r.report;requirements.value=r.requirements;bootstrapLog.value=r.output;notice.value=r.requirements.missing.length?`已安装 ${r.packages.join('、')}，仍缺：${r.requirements.missing.join('、')}`:`已安装 ${r.packages.join('、')}，环境检测通过`})}
function addSite(){
  const domain = normalizeDomain(newSite.domain)
  if (!domain) {
    error.value = '请填写域名，例如 example.com'
    return
  }
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    error.value = `域名格式不正确：${domain}`
    return
  }
  if (config.sites.some(s => s.domain === domain)) {
    error.value = `域名已在清单中：${domain}`
    return
  }
  error.value = ''
  config.sites.push({
    seq: String(config.sites.length + 1),
    domain,
    siteKey: newSite.siteKey.trim(),
    port: newSite.port,
    selected: true,
  })
  newSite.domain = ''
  newSite.siteKey = ''
  newSite.port = null
  notice.value = `已添加 ${domain}`
}
function validateStep(index: number) {
  if (index === 0) {
    if (!config.projectPath.trim()) return '请填写或选择本地项目文件夹。'
    if (!project.value) return '请先点「识别项目」，确认技术栈和产物目录。'
  }
  if (index === 1) {
    if (!server.host.trim()) return '请填写服务器 IP 或主机名。'
    if (!connected.value) return '请先获取指纹、勾选确认，并完成「测试连接」。'
  }
  if (index === 2) {
    if (!config.sites.length) return '请先添加至少一个域名。'
    if (!selected.value.length) return '请至少勾选一个本次要部署的站点。'
  }
  if (index === 3) {
    if (!config.baseDir.trim()) return '请填写服务器存放根目录。'
    if (config.https && !config.email.trim()) return '开启 HTTPS 时请填写证书通知邮箱。'
  }
  return ''
}
function goNext() {
  const message = validateStep(step.value)
  if (message) {
    error.value = message
    return
  }
  error.value = ''
  step.value++
}
function newDeploy() {
  if (job.value?.status === 'running') {
    error.value = '部署仍在进行，请先等待完成或停止任务。'
    return
  }
  if (!window.confirm('将清空当前填写内容并开始新的部署。未保存的修改会丢失。')) return
  Object.assign(config, createDefaultConfig())
  Object.assign(server, { host: '', port: 22, username: 'ubuntu', auth: 'key', keyPath: '', passphrase: '', password: '', agent: '', fingerprint: '' })
  project.value = null
  plan.value = null
  job.value = null
  fingerprint.value = ''
  trusted.value = false
  report.value = ''
  connected.value = false
  requirements.value = null
  bootstrapLog.value = ''
  acknowledge.value = false
  csv.value = ''
  importMode.value = 'manual'
  newSite.domain = ''
  newSite.siteKey = ''
  newSite.port = null
  error.value = ''
  notice.value = '已开始新的部署配置。'
  step.value = 0
}
async function saveDraft(){
  const {envText,sourceId,connectionId,...safe}=config
  void envText; void sourceId; void connectionId
  const draft = {
    config: { ...safe, syncSheet: false },
    server: {
      host: server.host,
      port: server.port,
      username: server.username,
      auth: server.auth,
      keyPath: server.keyPath,
    },
  }
  try {
    await api('/draft', { draft })
    notice.value = '草稿已保存在本机应用数据中（不含密码、私钥口令和环境变量值）。'
  } catch {
    localStorage.setItem('deployx-draft', JSON.stringify(draft))
    notice.value = '草稿已保存在本机（备用存储）。不含认证敏感信息。'
  }
}
async function loadDraft(){
  try {
    let draft: { config?: Record<string, unknown>; server?: Record<string, unknown> } | null = null
    try {
      const remote = await api<{ draft: typeof draft }>('/draft')
      draft = remote.draft
    } catch {
      const saved = localStorage.getItem('deployx-draft') || localStorage.getItem('launchpad-draft')
      draft = saved ? JSON.parse(saved) : null
    }
    if (!draft) {
      notice.value = '还没有保存的草稿。'
      return
    }
    const payload = draft.config ? draft : { config: draft as Record<string, unknown>, server: undefined }
    Object.assign(config, createDefaultConfig(), payload.config || {})
    config.syncSheet = false
    config.sourceId = ''
    config.connectionId = ''
    if (payload.server) {
      Object.assign(server, {
        host: String(payload.server.host || ''),
        port: Number(payload.server.port || 22),
        username: String(payload.server.username || 'ubuntu'),
        auth: String(payload.server.auth || 'key'),
        keyPath: String(payload.server.keyPath || ''),
        passphrase: '',
        password: '',
        agent: '',
        fingerprint: '',
      })
    }
    if (importMode.value === 'google') importMode.value = 'manual'
    if (server.auth === 'agent') server.auth = 'key'
    clearConnection()
    plan.value = null
    acknowledge.value = false
    project.value = null
    notice.value = '已恢复草稿。项目与服务器连接已断开，请重新识别项目并测试连接。'
    step.value = 0
  } catch {
    error.value = '草稿读取失败'
  }
}
async function importCsv(){await action('导入清单',async()=>{const r=await api<{sites:Site[]}>('/import/csv',{text:csv.value});config.sites=r.sites;config.sourceId='';config.syncSheet=false;notice.value=`导入 ${r.sites.length} 个站点`})}
async function fileCsv(e:Event){const f=(e.target as HTMLInputElement).files?.[0];if(!f)return;csv.value=await decodeCsvFile(f);await importCsv()}
async function decodeCsvFile(file:File){
  const bytes=new Uint8Array(await file.arrayBuffer())
  if(bytes.length>=3&&bytes[0]===0xEF&&bytes[1]===0xBB&&bytes[2]===0xBF)return new TextDecoder('utf-8').decode(bytes)
  if(bytes.length>=2&&bytes[0]===0xFF&&bytes[1]===0xFE)return new TextDecoder('utf-16le').decode(bytes)
  if(bytes.length>=2&&bytes[0]===0xFE&&bytes[1]===0xFF)return new TextDecoder('utf-16be').decode(bytes)
  const utf8=new TextDecoder('utf-8').decode(bytes)
  if(!utf8.includes('\uFFFD')&&/(domain|域名|网站|网址|host|sitekey|端口|port|序号)/i.test(utf8))return utf8
  try{const gbk=new TextDecoder('gbk').decode(bytes);if(/(domain|域名|网站|网址|host|sitekey|端口|port|序号)/i.test(gbk))return gbk}catch{/* browser may lack gbk */}
  return utf8
}
function selectRange(){config.sites.forEach(s=>s.selected=Number(s.seq)>=range.from&&Number(s.seq)<=range.to)}
async function preview(){await action('生成执行计划',async()=>{config.checkPaths=customPaths.value.split('\n').map(x=>x.trim()).filter(Boolean);await new Promise(r=>setTimeout(r,0));const result=await api<Plan>('/plans',config);config.sites.forEach(s=>{const assigned=result.sites.find(r=>r.domain===s.domain);if(assigned)s.port=assigned.port});await nextTick();plan.value=result;step.value=4;acknowledge.value=false})}
async function start(){await action('开始部署',async()=>{if(!plan.value||!acknowledge.value)return;const r=await api<{id:string}>('/jobs',{planId:plan.value.id});job.value=await api<Job>(`/jobs/${r.id}`);step.value=5;plan.value=null})}
async function stop(){if(job.value)await action('请求停止',async()=>{await api(`/jobs/${job.value!.id}/stop`,{});job.value!.stopRequested=true})}
async function openJob(id:string){await action('读取任务',async()=>{job.value=await api<Job>(`/jobs/${id}`);step.value=5})}
function retryFailed(){const domains=new Set(job.value?.results.filter(r=>r.status==='failed').map(r=>r.domain));config.sites.forEach(s=>s.selected=domains.has(s.domain));step.value=4;plan.value=null;notice.value='已选择失败站点。请先处理日志中的问题，再生成新的执行计划。'}
function download(name:string,text:string){const url=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
function exportResults(){const esc=(v:unknown)=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';download('部署结果.csv',['domain,siteKey,Port,status,error',...(job.value?.results||[]).map(r=>[r.domain,r.siteKey,r.status==='deployed'?r.port:'',r.status,r.error].map(esc).join(','))].join('\r\n'))}
watch(()=>[server.host,server.port,server.username,server.auth,server.keyPath],()=>{clearConnection(undefined, true)})
watch(()=>JSON.stringify(config),()=>{plan.value=null;acknowledge.value=false})
let timer:ReturnType<typeof setInterval>
onMounted(async()=>{
  if(server.auth==='agent')server.auth='key'
  if(importMode.value==='google')importMode.value='manual'
  config.syncSheet=false
  try{const h=await api<{activeJob:string|null;startedAt?:string}>('/health');online.value=true;syncServerEpoch(h.startedAt);history.value=await api<Job[]>('/history');if(h.activeJob)await openJob(h.activeJob)}catch{online.value=false}timer=setInterval(async()=>{try{const h=await api<{activeJob:string|null;startedAt?:string}>('/health');online.value=true;syncServerEpoch(h.startedAt);if(job.value?.status==='running')job.value=await api<Job>(`/jobs/${job.value.id}`);else if(h.activeJob&&!job.value)await openJob(h.activeJob);history.value=await api<Job[]>('/history')}catch{online.value=false}},2500)
})
onUnmounted(()=>clearInterval(timer))
</script>

<template>
<div class="shell">
  <aside class="sidebar">
    <a class="brand" href="#" @click.prevent="step=0"><span class="brand-icon">↗</span><span>DeployX<small>部署工作台</small></span></a>
    <div class="workspace-label">WORKSPACE <span>LOCAL</span></div><button class="nav-home" @click="newDeploy"><span>◈</span> 新建部署 <b>＋</b></button><div class="nav-caption">部署向导</div>
    <nav><button v-for="(item,i) in steps" :key="item.name" :aria-label="item.name" :class="['nav-step',{active:step===i}]" @click="step=i"><span class="step-number">{{i+1}}</span><span>{{item.name}}<small>{{item.desc}}</small></span><span v-if="step===i" class="active-dot"></span></button></nav>
    <div class="sidebar-bottom"><span class="shield">◇</span><strong>在你的电脑上运行</strong><p>项目路径、私钥和密码只在本机使用。<br>上传到服务器的，主要是构建好的网站文件。</p><div class="local-status"><i :class="{off:!online}"></i>{{online?'本地服务已连接':'本地服务未连接'}}</div></div>
  </aside>
  <div class="main-shell">
    <header class="topbar"><div>工作空间 <span>/</span> 新建部署 <span>/</span> <strong>{{steps[step]?.name}}</strong></div><div class="top-actions"><span class="local-pill">◉ 本机模式</span><button class="text-button" @click="loadDraft">恢复草稿</button><button class="button small secondary" @click="saveDraft">保存草稿</button></div></header>
    <main>
      <div class="page-heading"><div><div class="eyebrow">FROM LOCAL TO LIVE</div><h1>{{step===5?'看着网站一点点上线。':'把本地项目，部署到你的域名。'}}</h1><p>{{steps[step]?.brief}}</p></div><div class="step-counter"><strong>0{{step+1}}</strong><span>/ 06</span></div></div>
      <div v-if="error" class="alert error" role="alert"><b>需要处理</b><span>{{error}}</span><button @click="error=''" aria-label="关闭错误">×</button></div>
      <div v-if="notice" class="alert success" role="status"><span>{{notice}}</span><button @click="notice=''" aria-label="关闭提示">×</button></div>
      <div v-if="!online" class="alert warning">{{ isDesktop ? '本地服务还没连上。请重新打开 DeployX；若刚关闭过，请稍等几秒再试。' : '本地服务还没连上。请确认本机 DeployX 服务已启动。' }}</div>
      <div class="content-grid">
        <section class="workspace-card">
          <div class="card-heading"><div><span class="section-index">第 {{step+1}} 步</span><h2>{{steps[step]?.name}}</h2><p>{{steps[step]?.desc}}</p></div><span class="tag">{{step===5?'进行中':'向导'}}</span></div>
          <div class="step-brief tip"><span>{{step+1}}</span><p><strong>{{stepHelp.title}}</strong>{{stepHelp.body}}</p></div>
          <div v-if="step===0" class="card-body">
            <label class="field-label">本地项目文件夹 <span>*</span></label><div class="input-action"><input id="project-path" :value="config.projectPath" :placeholder="pathPlaceholder" @input="onProjectPathInput"/><button v-if="isDesktop" class="button secondary" type="button" @click="pickProjectDir">选择文件夹</button><button class="button secondary" :disabled="!!busy||!config.projectPath" @click="inspect">{{busy==='识别项目'?'识别中…':'识别项目'}}</button></div><p class="field-help">选择或填写包含 <code>package.json</code> 的文件夹。推荐先点「识别项目」，系统会自动选好下面的选项。</p>
            <div v-if="project" class="detected"><span class="check-circle">✓</span><div><strong>{{project.name}}</strong><p>{{project.detection || (project.label || project.framework.toUpperCase())}} · 发现 {{project.scripts.length}} 个脚本 · {{project.envKeys.length}} 个环境变量名</p></div><span class="tag green">已识别</span></div>
            <label class="field-label">你的项目用什么技术？</label><div class="framework-grid five"><button v-for="f in frameworkOptions" :key="f.id" :class="['framework',{selected:config.framework===f.id}]" @click="selectFramework(f.id)"><span :class="['framework-icon',f.id]">{{f.icon}}</span><strong>{{f.name}}</strong><small>{{f.hint}}</small><em class="framework-ssr">{{f.ssr}}</em><span class="radio-mark"></span></button></div>
            <label class="field-label">网站怎么跑在服务器上？</label><div class="mode-cards"><button type="button" :class="['mode-card',{chosen:config.mode==='static'}]" @click="selectMode('static')"><strong>静态网站</strong><span>把网页文件交给 Nginx 直接打开（多数前端项目选这个）</span></button><button type="button" :class="['mode-card',{chosen:config.mode==='node',disabled:modeLockedToStatic}]" :disabled="modeLockedToStatic" @click="selectMode('node')"><strong>动态网站（Node）</strong><span>{{modeLockedToStatic?'Vue / React 请改选 Nuxt / Next':'服务器跑 Node；Nginx 反向代理到该程序'}}</span></button></div>
            <div v-if="guideModeNote" class="tip"><span>!</span><p>{{guideModeNote}}</p></div>
            <div v-if="activeGuide" class="guide-panel">
              <div class="guide-heading"><div><span class="eyebrow">看这里就知道该做什么</span><h3>{{activeGuide.title}}</h3><p>{{activeGuide.summary}}</p></div><span class="tag">{{config.mode==='node'?'动态':'静态'}}</span></div>
              <div class="guide-grid">
                <div><small>① 你在本机先做</small><code>{{activeGuide.build}}</code></div>
                <div><small>② 成功后应出现</small><code>{{activeGuide.output}}</code></div>
                <div><small>③ 后台启动文件</small><code>{{activeGuide.entry}}</code></div>
                <div><small>④ 本工具会怎么部署</small><code>{{activeGuide.deploy}}</code></div>
              </div>
              <ol class="guide-steps"><li v-for="(item,i) in activeGuide.steps" :key="i">{{item}}</li></ol>
              <p v-if="activeGuide.tip" class="guide-tip">{{activeGuide.tip}}</p>
            </div>
            <details class="advanced-block"><summary>高级选项（一般不用改，已按预设填好）</summary>
              <div class="form-grid"><label>用什么命令安装/构建<select v-model="config.buildTool"><option value="auto">自动识别（推荐）</option><option value="npm">npm</option><option value="pnpm">pnpm</option><option value="yarn">yarn</option></select></label><label>构建脚本名<input v-model="config.buildScript" list="build-scripts"/><datalist id="build-scripts"><option v-for="s in project?.scripts" :key="s">{{s}}</option></datalist><span class="field-help">对应 package.json 里 scripts 的名字，如 build / generate</span></label></div>
              <div class="form-grid"><label>产物文件夹名<input v-model="config.output" :placeholder="activeGuide?.output || 'dist'"/><span class="field-help">已按上方预设填好，一般不用改。</span></label><label v-if="config.mode==='node'">Node 启动文件<input v-model="config.entry" :placeholder="activeGuide?.entry || ''"/><span class="field-help">动态网站才需要。Next 会由系统用 next start 启动。</span></label></div>
              <label class="check-row"><input type="checkbox" v-model="config.loadEnv"/><span>使用项目里的 .env<small>不会改你的原文件；每个站点的 SITE_KEY 会单独注入。</small></span></label>
              <details><summary>再补充环境变量（可选）</summary><textarea v-model="config.envText" rows="4" placeholder="SANITY_USE_CDN=true&#10;NODE_ENV=production" spellcheck="false"></textarea><p class="field-help">只用于本次任务，不会存进草稿。名字以 PUBLIC_ / VITE_ 开头的变量可能进浏览器，不要放密钥。</p></details>
            </details>
          </div>
          <div v-if="step===1" class="card-body">
            <div class="form-grid three"><label>服务器 IP 或主机名<input v-model="server.host" placeholder="例如 203.0.113.10"/><span class="field-help">云厂商控制台里的公网 IP</span></label><label>SSH 端口<input type="number" v-model="server.port"/><span class="field-help">默认 22，一般不用改</span></label><label>登录用户名<input v-model="server.username" placeholder="ubuntu"/><span class="field-help">常见：ubuntu / root</span></label></div>
            <label class="field-label">怎么登录服务器？</label><div class="segmented"><button v-for="a in [{id:'key',name:'SSH 私钥（推荐）'},{id:'password',name:'密码'}]" :key="a.id" :class="{chosen:server.auth===a.id}" @click="server.auth=a.id">{{a.name}}</button></div>
            <template v-if="server.auth==='key'"><label>私钥文件路径<div class="input-action"><input :value="server.keyPath" :placeholder="keyPathPlaceholder" @input="onKeyPathInput"/><button v-if="isDesktop" class="button secondary" type="button" @click="pickKeyFile">选择文件</button></div><span class="field-help">从资源管理器复制路径时若带引号，会自动去掉。</span></label><label>私钥口令 <small>多数情况不用填</small><input v-model="server.passphrase" type="password" autocomplete="off" placeholder="只有加密过的私钥才需要"/></label></template>
            <label v-if="server.auth==='password'">SSH 密码<input v-model="server.password" type="password" autocomplete="off" placeholder="仅本次连接使用，不会写入草稿"/></label>
            <div class="tip"><span>◇</span><p><strong>按顺序点下面两个按钮。</strong>「指纹」是一串校验码，用来确认连对了机器。服务器建议 Ubuntu；静态网站需要 Nginx；动态网站还需要 Node 22+ 和 PM2；开 HTTPS 需要 Certbot。</p></div>
            <button class="button secondary" :disabled="!!busy||!server.host" @click="getFingerprint">{{busy==='读取指纹'?'正在读取…':'① 获取服务器指纹'}}</button><div v-if="fingerprint" class="fingerprint"><small>服务器指纹（SHA-256）</small><code>{{fingerprint}}</code><label class="check-row"><input type="checkbox" v-model="trusted"/><span>我已核对，这就是我的服务器</span></label></div><button class="button primary" :disabled="!!busy||!trusted" @click="connect">{{busy==='连接服务器'?'连接中…':'② 测试连接'}}</button>
            <div v-if="requirements" class="req-panel">
              <div class="setting-title"><div><h3>服务器还缺什么软件？</h3><p>{{requirements.distroId}} · {{requirements.osFamily==='debian'?'可一键安装':'需手动安装'}} · {{requirements.hasSudo?'已有免密 sudo':'还不能免密 sudo'}}</p></div><span :class="['tag',requirements.ready?'green':'']">{{requirements.ready?'可以部署':'还需处理'}}</span></div>
              <ul class="req-list"><li v-for="item in requirements.items" :key="item.id"><span :class="['result-icon',item.ok?'deployed':'failed']">{{item.ok?'✓':'!'}}</span><strong>{{item.label}}</strong><small>{{item.ok?(item.detail||'已安装'):(item.required?'部署前必须有':'按你选的模式可能需要')}}</small></li></ul>
              <div v-if="!requirements.hasSudo" class="tip"><span>!</span><p>当前用户还不能免密使用 sudo。请先在服务器上配好，否则无法自动装软件或写入 Nginx 配置。</p></div>
              <div v-else-if="requirements.osFamily!=='debian' && requirements.missing.length" class="tip"><span>!</span><p>一键安装只支持 Ubuntu / Debian。请手动安装：Nginx、Node 22+、PM2、Certbot（含 nginx 插件）。</p></div>
              <button v-if="requirements.canBootstrap" class="button secondary" :disabled="!!busy" @click="bootstrapDeps">{{busy==='安装依赖'?'正在远程安装…':'③ 一键安装缺失项（'+requirements.missing.join('、')+'）'}}</button>
              <details v-if="bootstrapLog" open><summary>安装过程输出</summary><pre class="server-report">{{bootstrapLog}}</pre></details>
            </div>
            <details v-if="report" open><summary><span class="tag green">连接成功</span> 环境检测详情</summary><pre class="server-report">{{report}}</pre></details>
          </div>
          <div v-if="step===2" class="card-body">
            <div class="segmented"><button v-for="m in [{id:'manual',name:'手动添加一个'},{id:'csv',name:'用 CSV 批量导入'}]" :key="m.id" :class="{chosen:importMode===m.id}" @click="importMode=m.id">{{m.name}}</button></div>
            <div v-if="importMode==='manual'" class="manual-entry"><input v-model="newSite.domain" placeholder="域名，如 example.com" aria-label="新站点域名"/><input v-model="newSite.siteKey" placeholder="SITE_KEY（没有可留空）" aria-label="新站点SITE_KEY"/><button class="button secondary" @click="addSite">＋ 添加到清单</button></div>
            <div v-if="importMode==='csv'"><div class="upload-box"><span>↥</span><strong>导入站点清单</strong><p>表格第一行要有「域名」列（也认 domain / 网站 / 网址 / host）。支持 Excel 另存的中文 CSV。</p><input type="file" accept=".csv,text/csv" @change="fileCsv" aria-label="选择CSV文件"/><button class="text-button" @click="download('站点模板.csv','序号,域名,siteKey,Port\n1,example.com,site-a,\n2,example.org,site-b,')">下载空白模板 ↗</button></div><details><summary>或者直接粘贴 CSV 文字</summary><textarea v-model="csv" rows="4" placeholder="序号,域名,siteKey,Port"/><button class="button secondary" :disabled="!!busy" @click="importCsv">导入这段内容</button></details></div>
            <div class="list-toolbar"><strong>站点清单 <span>{{config.sites.length}}</span></strong><div><input type="number" v-model="range.from" aria-label="起始序号"/><span>至</span><input type="number" v-model="range.to" aria-label="结束序号"/><button class="text-button" @click="selectRange">按序号勾选</button></div></div>
            <div class="site-table"><table><thead><tr><th><input type="checkbox" :checked="!!config.sites.length&&selected.length===config.sites.length" @change="config.sites.forEach(s=>s.selected=($event.target as HTMLInputElement).checked)" aria-label="全选站点"/></th><th>序号</th><th>域名</th><th>SITE_KEY</th><th>内部端口</th><th></th></tr></thead><tbody><tr v-for="(s,i) in config.sites" :key="i"><td><input v-model="s.selected" type="checkbox" :aria-label="`选择 ${s.domain}`"/></td><td>{{s.seq}}</td><td><input v-model="s.domain" aria-label="域名"/></td><td><input v-model="s.siteKey" aria-label="SITE_KEY"/></td><td><input v-model="s.port" type="number" placeholder="自动" aria-label="Port"/></td><td><button class="remove" @click="config.sites.splice(i,1)" aria-label="移除站点">×</button></td></tr><tr v-if="!config.sites.length"><td colspan="6" class="empty-cell">还没有站点。先加一个域名，或导入清单。</td></tr></tbody></table></div><div class="table-footer">已勾选 <strong>{{selected.length}}</strong> 个站点 <span>「内部端口」仅动态网站需要；静态网站可留空。</span></div>
            <label class="check-row"><input type="checkbox" v-model="config.requireSiteKey"/><span>每个站点必须填写 SITE_KEY<small>多站点 / CMS 项目常开；普通一个域名的项目可关掉。</small></span></label>
          </div>
          <div v-if="step===3" class="card-body">
            <div class="form-grid"><label>部署方式（与第 1 步一致，如需修改请返回修改）<input :value="overviewModeLabel" readonly/><span class="field-help">反向代理：用户访问你的域名时，由 Nginx 把请求转给后台的 Node 程序。</span></label><label>产物文件夹名<input v-model="config.output" placeholder="dist"/><span class="field-help">应与第 1 步识别结果一致</span></label></div>
            <div v-if="config.mode==='node'" class="form-grid"><label>Node 启动文件<input v-model="config.entry" placeholder="dist/server/entry.mjs"/></label><label>起始内部端口<input type="number" v-model="config.startPort" min="1024" max="65535"/><span class="field-help">给「未填写端口」的站点自动分配；已填过或以前部署过的会优先沿用，不会互相抢。</span></label></div>
            <label v-if="config.mode==='static'" class="check-row"><input type="checkbox" v-model="config.spa"/><span>启用 SPA 路由回退<small>Vue / React 多页面路由通常要开；Astro / Nuxt / Next 静态页通常关。</small></span></label>
            <label>服务器上的存放根目录<input v-model="config.baseDir"/><span class="field-help">每个域名一个子目录；新版本进 releases，current 指向正在用的版本。</span></label>
            <label v-if="config.mode==='node'" class="check-row"><input type="checkbox" v-model="config.runtimeInstall" :disabled="config.framework==='next'"/><span>在服务器上再安装 production 依赖<small>{{config.framework==='next'?'Next.js 动态模式固定开启。':'Astro / Nuxt 完整产物通常不用；普通 Node 项目才需要。'}}</small></span></label>
            <div class="divider"></div><div class="setting-title"><div><h3>HTTPS 证书（推荐开启）</h3><p>自动申请免费证书，并让 http 跳转到 https。</p></div><input class="toggle" type="checkbox" v-model="config.https" aria-label="启用HTTPS证书"/></div>
            <label v-if="config.https">证书通知邮箱<input v-model="config.email" type="email" placeholder="you@example.com"/><span class="field-help">Let's Encrypt 用来发到期提醒，不会用来登录你的站</span></label>
            <label class="field-label">部署成功后检查什么？</label><div class="validation-grid"><button v-for="v in [{id:'minimal',name:'最小检查',desc:'构建、启动、写配置、申请证书'},{id:'http',name:'打开首页看看',desc:'再确认首页能正常打开'},{id:'full',name:'更仔细',desc:'首页、sitemap、跳转等'},{id:'custom',name:'自定义路径',desc:'检查你指定的几个页面'}]" :key="v.id" :class="['validation-option',{selected:config.validation===v.id}]" @click="config.validation=v.id"><strong>{{v.name}} <small v-if="v.id==='minimal'">默认</small></strong><span>{{v.desc}}</span></button></div>
            <label v-if="config.validation==='custom'">要检查的路径（每行一个）<textarea v-model="customPaths" rows="3"/></label>
            <label class="check-row"><input type="checkbox" v-model="config.continueOnError"/><span>某个站点失败时，继续部署后面的站点</span></label>
          </div>
          <div v-if="step===4" class="card-body">
            <div v-if="!plan" class="plan-empty"><div class="large-symbol">◎</div><h3>先生成计划，确认无误再上线。</h3><p>这一步<strong>只会检查配置</strong>，不会构建，也不会改服务器上的任何东西。</p><button class="button primary" :disabled="!!busy" @click="preview">{{busy==='生成执行计划'?'正在检查…':'生成执行计划 →'}}</button></div>
            <template v-else><div class="plan-stats"><div><strong>{{plan.sites.length}}</strong><span>待部署站点</span></div><div><strong>{{plan.https?'HTTPS':'HTTP'}}</strong><span>访问协议</span></div><div><strong>{{plan.mode==='node'?'动态 · Node':'静态 · Nginx'}}</strong><span>运行方式</span></div></div><div class="pipeline"><span v-for="(s,i) in plan.steps" :key="s"><i>{{i+1}}</i>{{s}}</span></div><div class="site-table"><table><thead><tr><th>域名</th><th>内部端口</th><th>服务器目录</th></tr></thead><tbody><tr v-for="s in plan.sites" :key="s.domain"><td>{{s.domain}}</td><td>{{s.port||'静态（无端口）'}}</td><td class="mono">{{plan.baseDir}}/{{s.domain.replaceAll('.','-')}}</td></tr></tbody></table></div><div class="tip"><span>i</span><div><p v-for="n in plan.notes" :key="n">{{n}}</p><p v-if="plan.https">开始部署即表示同意为这些域名申请证书，并接受 <a href="https://letsencrypt.org/repository/" target="_blank" rel="noopener">Let's Encrypt 服务条款</a>。</p></div></div><label class="check-row"><input v-model="acknowledge" type="checkbox"/><span>我已确认服务器、域名范围和设置，可以开始真正部署。</span></label><button class="button primary full" :disabled="!acknowledge||!!busy||job?.status==='running'" @click="start">开始部署 {{plan.sites.length}} 个站点 ↗</button></template>
          </div>
          <div v-if="step===5" class="card-body">
            <template v-if="job"><div class="job-heading"><div><span :class="['tag',job.status==='complete'?'green':'']">{{statusLabel(job.status)}}</span><h3>{{job.current||'部署任务'}}</h3><p>{{job.phase}} · 已处理 {{job.results.length}} / {{job.total}} 个站点<span v-if="lastLogAt"> · 最近日志 {{lastLogAt}}</span></p></div><strong class="progress-number">{{progressHeadline}}<small v-if="showProgressPercent">%</small></strong></div><div class="progress-track"><div :style="{width:(job.status==='running' && !job.results.length ? 8 : progress)+'%'}"></div></div><div class="job-summary"><span><i class="dot green-dot"></i>{{successful}} 成功</span><span><i class="dot red-dot"></i>{{failed}} 失败</span><span>{{job.total-job.results.length}} 还在排队</span></div><div class="job-buttons"><button v-if="job.status==='running'" class="button secondary" :disabled="job.stopRequested||!!busy" @click="stop">{{job.stopRequested?'将在当前站完成后停止':'完成当前站后停止'}}</button><button v-if="failed&&job.status!=='running'" class="button secondary" @click="retryFailed">只重试失败的站点</button><button class="button secondary" @click="exportResults">导出结果 CSV</button><button class="text-button" @click="download('部署日志.txt',job!.logs.map(l=>l.time+' '+l.text).join('\n'))">下载日志</button></div><div class="terminal"><div class="terminal-bar"><span>● ● ●</span><b>部署日志</b><small>{{job.status==='running'?'进行中':'已结束'}}</small></div><div class="terminal-content" aria-live="polite"><p v-for="(l,i) in job.logs.slice(-100)" :key="i"><time>{{l.time.slice(11,19)}}</time><span>{{l.text}}</span></p><p v-if="!job.logs.length">正在准备任务…</p></div></div><div v-if="job.sheetStatus" class="tip">{{job.sheetStatus}}</div><div class="result-list"><div v-for="r in job.results" :key="r.domain"><span :class="['result-icon',r.status]">{{r.status==='deployed'?'✓':'!'}}</span><strong>{{r.domain}}</strong><span>{{r.status==='deployed'?(r.port||'静态'):'未完成'}}</span><small>{{r.error||'本站步骤已完成'}}</small></div></div></template>
            <div v-else class="plan-empty"><div class="large-symbol">↗</div><h3>部署开始后，进度会出现在这里。</h3><p>完成前面的向导并确认执行后，可在此查看每个站点的进度与日志。</p><button class="button primary" @click="newDeploy">从头配置一次部署</button></div><div v-if="history.length" class="history"><h3>最近任务</h3><button v-for="h in history" :key="h.id" @click="openJob(h.id)"><span>{{new Date(h.createdAt).toLocaleString()}}</span><strong>{{h.total}} 个站点</strong><span>{{statusLabel(h.status)}} →</span></button></div>
          </div>
          <footer v-if="step<4" class="card-footer"><button class="text-button" :disabled="step===0" @click="step--">← 上一步</button><span>现在只是在填表，还不会上线</span><button class="button primary" @click="goNext">{{step===3?'去预览计划':'下一步'}} →</button></footer>
        </section>
          <aside class="context-panel"><div class="context-card"><span class="eyebrow">本次部署一览</span><h3>现在选了什么</h3><div class="overview-row"><span>技术栈</span><b>{{(project?.label || config.framework).toString().toUpperCase()}}</b></div><div class="overview-row"><span>运行方式</span><b>{{overviewModeLabel}}</b></div><div class="overview-row"><span>产物文件夹</span><b>{{config.output || '—'}}</b></div><div class="overview-row"><span>目标服务器</span><b>{{server.host||'还没连接'}}</b></div><div class="overview-row"><span>勾选站点数</span><b>{{selected.length}} 个</b></div><div class="overview-row"><span>上线后检查</span><b>{{{minimal:'最小检查',http:'打开首页',full:'更仔细',custom:'自定义路径'}[config.validation]}}</b></div><div class="divider"></div><div class="readiness"><strong>准备进度</strong><span>{{readyCount}} / 4</span></div><div class="readiness-bars"><i v-for="n in 4" :key="n" :class="{filled:n<=readyCount}"></i></div><p class="context-note">{{project?.detection || '识别项目 → 连接服务器 → 勾选域名 → 预览计划 → 确认执行'}}</p></div><div class="help-card"><span class="help-symbol">✧</span><h3>{{stepHelp.title}}</h3><p>{{stepHelp.body}}</p><div class="help-line"></div><small>支持 Vue · React · Astro · Nuxt · Next（静态 / 动态）</small></div><div class="privacy-note">◇ 私钥、密码和环境变量值不会写入浏览器草稿。</div></aside>
      </div><div class="page-bottom"><span>DeployX · 本机部署工作台</span><span>复杂步骤交给工具，最终确认留给你。</span></div>
    </main>
  </div>
</div>
</template>
