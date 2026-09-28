import { redact } from './core.mjs'

const GENERIC_STEPS = ['展开下方「原始错误信息」，查看最后几行英文报错。', '点「复制错误信息」，连同任务日志一起发给技术人员。']

const RULES = [
  {
    test: /服务器指纹不一致/,
    title: '服务器身份和之前确认的不一致，连接已停止',
    reasons: ['服务器重装过系统，或这个 IP 现在指向了另一台机器', '网络中有人冒充服务器（少见，但需要警惕）'],
    steps: ['如果你确定刚重装过系统 / 换过服务器：回到「连接服务器」，重新点「获取指纹」并确认。', '如果没有做过这些操作：不要继续，先联系服务器管理员核实。'],
  },
  {
    test: /before handshake/i,
    title: 'SSH 还没握手，服务器就主动断开了连接（已自动重试 3 次）',
    reasons: ['本机开了 VPN / 代理（尤其是 Clash TUN 模式），SSH 流量被转发到代理节点，节点断开了 22 端口', '短时间内连接次数太多，被服务器限流（sshd MaxStartups / fail2ban）', '填写的端口不是 SSH 端口', '云服务器防火墙只允许特定 IP 连接 SSH'],
    steps: ['先关闭 VPN / 代理的 TUN 模式再试；或在代理规则里把服务器 IP 设为 DIRECT（直连）。', '等 1 分钟后再点「测试连接」。', '确认 SSH 端口（一般是 22）；云控制台防火墙里 22 端口来源设为「任何 IP」。'],
  },
  {
    test: /Timed out while waiting for handshake|ETIMEDOUT|connect timeout/i,
    title: '连接服务器超时，一直没有响应（已自动重试 3 次）',
    reasons: ['服务器关机或卡死', '云服务器防火墙 / 安全组没有放行 SSH 端口', 'IP 地址填错了', '本机网络或代理不稳定'],
    steps: ['在云控制台确认服务器处于「运行中」。', '在防火墙 / 安全组里放行 22 端口（或你的 SSH 端口）。', '核对服务器公网 IP；关闭 VPN / 代理后重试。'],
  },
  {
    test: /ECONNREFUSED/i,
    title: '服务器拒绝了连接：这个端口上没有 SSH 服务',
    reasons: ['SSH 端口填错了', '服务器上的 SSH 服务没有启动'],
    steps: ['核对 SSH 端口（一般是 22）。', '通过云控制台的网页终端登录服务器，执行 sudo systemctl start ssh。'],
  },
  {
    test: /ENOTFOUND|EAI_AGAIN|getaddrinfo/i,
    title: '找不到这个服务器地址',
    reasons: ['服务器地址拼写错误', '填的是域名，但域名还没有解析，或本机 DNS 异常'],
    steps: ['建议直接填写服务器公网 IP（云控制台里可以看到）。', '如果填的是域名，确认它已解析到服务器 IP。'],
  },
  {
    test: /EHOSTUNREACH|ENETUNREACH/i,
    title: '本机网络到不了这台服务器',
    reasons: ['本机没有联网或网络受限', 'IP 地址填错（例如填了内网 IP 172.x / 10.x）', 'VPN / 代理路由异常'],
    steps: ['确认本机能上网。', '使用服务器的「公网 IP」，不要用内网 IP。', '关闭 VPN / 代理后重试。'],
  },
  {
    test: /ECONNRESET|socket hang up|EPIPE/i,
    title: '连接被中途重置（已自动重试 3 次）',
    reasons: ['VPN / 代理（TUN 模式）中断了连接', '服务器防火墙或网络不稳定'],
    steps: ['关闭 VPN / 代理的 TUN 模式，或把服务器 IP 设为直连后重试。', '稍等片刻再试。'],
  },
  {
    test: /All configured authentication methods failed|Authentication failure|Permission denied \(publickey/i,
    title: 'SSH 登录被拒绝：用户名、私钥或密码不对',
    reasons: ['用户名不对（AWS / Lightsail Ubuntu 一般是 ubuntu，阿里云 / 腾讯云常见是 root）', '选的私钥不是这台服务器对应的那一把', '密码输错'],
    steps: ['核对用户名。', '确认私钥文件就是创建服务器时下载的那一个（.pem 或 id_ed25519，不是 .pub）。', '如果用密码登录，确认服务器允许密码登录。'],
  },
  {
    test: /Encrypted private OpenSSH key detected|no passphrase given|Bad passphrase|bad decrypt/i,
    title: '私钥有密码保护，但密码为空或不正确',
    reasons: ['这把私钥设置了口令（passphrase）'],
    steps: ['在「私钥密码」一栏填写生成私钥时设置的口令。'],
  },
  {
    test: /Cannot parse privateKey|Unsupported key format|privateKey value does not contain|Malformed OpenSSH private key/i,
    title: '选择的文件不是有效的 SSH 私钥',
    reasons: ['选成了公钥（.pub 文件）', '文件内容不完整或被修改过', 'PuTTY 的 .ppk 格式不支持'],
    steps: ['选择不带 .pub 后缀的私钥文件，内容以 -----BEGIN ... PRIVATE KEY----- 开头。', '如果是 .ppk，用 PuTTYgen 导出为 OpenSSH 格式。'],
  },
  {
    test: /找不到私钥文件/,
    title: '找不到私钥文件',
    reasons: ['私钥文件被移动、改名或删除'],
    steps: ['点「选择文件」重新选择私钥。'],
  },
  {
    test: /sudo: a password is required|sudo: a terminal is required|sudo: no tty|需先安装 Nginx，并为当前用户配置免密 sudo/i,
    title: '当前 SSH 用户不能免密使用 sudo',
    reasons: ['部署需要安装 Nginx、写配置、申请证书，这些都需要 sudo 权限'],
    steps: ['推荐使用云服务器默认用户（ubuntu / root），它们通常已支持免密 sudo。', '或在服务器执行 sudo visudo，添加一行：用户名 ALL=(ALL) NOPASSWD:ALL'],
  },
  {
    test: /Could not get lock|dpkg frontend lock|Unable to acquire the dpkg/i,
    title: '服务器正在自动更新系统，安装软件被暂时锁住',
    reasons: ['Ubuntu 开机后会在后台自动更新（unattended-upgrades），期间不能安装软件'],
    steps: ['等 5–10 分钟后再点「一键安装」。'],
  },
  {
    test: /No space left on device|ENOSPC/i,
    title: '磁盘空间不足',
    reasons: ['服务器或本机磁盘已满'],
    steps: ['在服务器执行 df -h 查看空间；清理旧的 releases 目录或日志。', '检查本机系统盘是否还有空间。'],
  },
  {
    test: /conflicting server name/i,
    title: 'Nginx 里已经有别的配置在使用这个域名',
    reasons: ['以前手动或用其他工具部署过同一个域名'],
    steps: ['在服务器执行 grep -rn "你的域名" /etc/nginx/sites-enabled/ 找到旧配置。', '确认旧配置不再需要后删除，再执行 sudo nginx -t && sudo systemctl reload nginx，然后重新部署。'],
  },
  {
    test: /nginx: \[emerg\]|nginx: configuration file .* test failed/i,
    title: 'Nginx 配置检查没有通过',
    reasons: ['服务器上已有的某个 Nginx 配置文件写错了（不一定是本次部署的）'],
    steps: ['在服务器执行 sudo nginx -t，按提示的文件和行号修复。', '修复后重新部署。'],
  },
  {
    test: /too many certificates|rateLimited|rate limit/i,
    title: 'HTTPS 证书申请次数超过限制',
    reasons: ["Let's Encrypt 对同一域名每周有申请次数上限"],
    steps: ['先关闭 HTTPS 部署，等几天后再开启。', '不要短时间内反复重试申请证书。'],
  },
  {
    test: /DNS problem|NXDOMAIN|Invalid response from|Type:\s*unauthorized|Timeout during connect \(likely firewall problem\)|Some challenges have failed|Certbot failed/i,
    title: 'HTTPS 证书申请失败：证书机构访问不到你的域名',
    reasons: ['域名还没有解析到这台服务器（或刚改完解析还没生效）', '云服务器防火墙没有放行 80 / 443 端口', '域名开了 CDN 代理（如 Cloudflare 小黄云）'],
    steps: ['用 ping 你的域名 确认解析到的是服务器公网 IP。', '云控制台防火墙放行 80 和 443 端口。', '暂时关闭 CDN 代理，或先关闭 HTTPS 部署，确认 HTTP 能访问后再开。'],
  },
  {
    test: /端口 \d+ 已占用|EADDRINUSE|address already in use|已被其他服务占用/i,
    title: '服务器上这个端口已经被别的程序占用',
    reasons: ['别的网站或服务正在使用这个端口'],
    steps: ['在站点清单里把 Port 留空让系统自动分配，或换一个端口。'],
  },
  {
    test: /pm2: command not found|pm2: not found/i,
    title: '服务器上没有安装 PM2',
    reasons: ['动态网站（Node 模式）需要 PM2 来运行'],
    steps: ['回到「连接服务器」，点「一键安装」补齐依赖。'],
  },
  {
    test: /(node|npm): (command )?not found/i,
    title: '服务器上没有安装 Node.js',
    reasons: ['动态网站（Node 模式）需要服务器安装 Node 22+'],
    steps: ['回到「连接服务器」，点「一键安装」补齐依赖。'],
  },
  {
    test: /目录不属于此控制台/,
    title: '服务器上已有同名目录，但不是 DeployX 创建的，为防止覆盖已停止',
    reasons: ['这个域名以前手动部署过，或部署根目录选到了别的程序的目录'],
    steps: ['在「部署设置」里换一个部署根目录（例如 /var/www/deployx）。', '或确认旧目录不再需要后，在服务器上手动删除它。'],
  },
  {
    test: /Nginx 配置冲突/,
    title: '服务器上已有同名的 Nginx 配置，但不是 DeployX 创建的',
    reasons: ['这个域名以前用别的方式部署过'],
    steps: ['在服务器 /etc/nginx/sites-available/ 下找到 lp- 开头的同名配置，确认不需要后删除再重试。'],
  },
  {
    test: /spawn .*ENOENT|is not recognized as an internal or external command|不是内部或外部命令|command not found: (pnpm|npm|yarn)/i,
    title: '本机找不到构建工具（npm / pnpm / yarn）',
    reasons: ['本机没有安装 Node.js，或项目使用的包管理器（如 pnpm）没有安装'],
    steps: ['到 nodejs.org 安装 Node.js LTS。', '如果项目用 pnpm：在终端执行 npm i -g pnpm。', '安装后完全退出并重新打开 DeployX。'],
  },
  {
    test: /Cannot find module|ERR_MODULE_NOT_FOUND|Cannot find package|ENOENT[^\n]*node_modules/i,
    title: '项目依赖没有安装，本机构建失败',
    reasons: ['项目文件夹里缺少 node_modules'],
    steps: ['在项目文件夹打开终端，执行 npm install（或 pnpm install）。', '安装完成后重新部署。'],
  },
  {
    test: /本地命令退出码|本地命令执行超时/,
    title: '本机构建项目失败',
    reasons: ['项目代码有错误，或缺少环境变量 / 依赖'],
    steps: ['查看任务日志「构建」段落里的红色报错。', '在项目文件夹打开终端执行 npm run build，确认本地能构建成功后再部署。'],
  },
  {
    test: /找不到这个项目文件夹|找不到指定的文件或文件夹/,
    title: '找不到项目文件夹',
    reasons: ['文件夹被移动、改名或删除'],
    steps: ['点「选择文件夹」重新选择项目。'],
  },
  {
    test: /连接会话已过期|连接会话已失效/,
    title: '服务器连接已失效',
    reasons: ['本地服务重启过，或距离上次连接超过 8 小时'],
    steps: ['回到「连接服务器」，重新点「测试连接」。'],
  },
  {
    test: /SSH 连接中断/,
    title: '部署过程中 SSH 连接断开了',
    reasons: ['网络 / VPN 不稳定', '服务器负载太高或重启了'],
    steps: ['先在任务日志里看最后执行到哪一步。', '网络稳定后点「只重试失败的站点」。'],
  },
  {
    test: /远程步骤超时/,
    title: '服务器上的步骤执行太久，已超时',
    reasons: ['服务器网络慢（安装依赖 / 申请证书卡住）', '服务器配置太低、负载过高'],
    steps: ['稍后重试；如反复出现，登录服务器检查 top / 网络状态。'],
  },
  {
    test: /返回 HTTP \d+|fetch failed|canonical|未正确跳转 HTTPS/i,
    title: '网站已部署，但上线后检查没有通过',
    reasons: ['域名还没有解析到服务器', '证书还没生效，或 CDN 缓存', '网站本身返回了错误页'],
    steps: ['用浏览器直接打开域名看看效果。', '如果只是检查太严格，可在「部署设置」把上线后检查改为「最小检查」。'],
  },
]

function firstLine(text) {
  return String(text).split('\n').map(s => s.trim()).find(Boolean) || '未知错误'
}

export function explainError(error, secrets = []) {
  const message = String(error?.message || error || '')
  const raw = redact(String(error?.raw || message), secrets).slice(-3000)
  const haystack = `${message}\n${raw}`
  const rule = RULES.find(r => r.test.test(haystack))
  if (rule) return { title: rule.title, reasons: rule.reasons, steps: rule.steps, raw }
  const remoteExit = message.match(/^远程命令退出码 (\d+)/)
  if (remoteExit) {
    return {
      title: `服务器上的部署步骤执行失败（退出码 ${remoteExit[1]}）`,
      reasons: ['具体原因在下方原始信息的最后几行'],
      steps: GENERIC_STEPS,
      raw,
    }
  }
  const title = firstLine(redact(message, secrets)).slice(0, 200)
  const isChinese = /[\u4e00-\u9fa5]/.test(title)
  return { title, reasons: [], steps: isChinese ? [] : GENERIC_STEPS, raw: raw === title ? '' : raw }
}

export function formatExplanation(detail) {
  const lines = [`✖ ${detail.title}`]
  if (detail.reasons.length) lines.push('可能原因：', ...detail.reasons.map(r => `  · ${r}`))
  if (detail.steps.length) lines.push('怎么解决：', ...detail.steps.map((s, i) => `  ${i + 1}. ${s}`))
  if (detail.raw) lines.push('原始错误信息：', detail.raw)
  return lines.join('\n') + '\n'
}
