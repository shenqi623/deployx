import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const staging = path.join(root, 'desktop-staging')
const appDir = path.join(staging, 'app')
const nodeDir = path.join(staging, 'node')
const NODE_VERSION = process.env.DEPLOYX_NODE_VERSION || 'v22.18.0'

function run(command, args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
      shell: options.shell === true,
      ...options,
      // Windows: .cmd/.bat 必须 shell:true，否则 Node 20+ 会报 spawn EINVAL
      ...(process.platform === 'win32' && /\.(cmd|bat)$/i.test(command) ? { shell: true } : {}),
    })
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} failed (${code})`))))
    child.on('error', reject)
  })
}

async function npmInstall(cwd) {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (await pathExists(npmCli)) {
    await run(process.execPath, [npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund', '--foreground-scripts'], cwd)
    return
  }
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  await run(npmCmd, ['install', '--omit=dev', '--no-audit', '--no-fund', '--foreground-scripts'], cwd)
}

async function pathExists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败 ${url}（HTTP ${res.status}）`)
  await pipeline(res.body, createWriteStream(dest))
}

async function extractZip(zipPath, destDir) {
  // Use PowerShell on Windows for reliable zip extract; unzip via tar on others.
  if (process.platform === 'win32') {
    await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`], root)
    return
  }
  await run('tar', ['-xf', zipPath, '-C', destDir], root)
}

async function prepareApp() {
  if (!(await pathExists(path.join(root, 'dist', 'index.html')))) {
    throw new Error('缺少 dist/。请先运行 pnpm build')
  }

  await rm(appDir, { recursive: true, force: true })
  await mkdir(path.join(appDir, 'server'), { recursive: true })
  await cp(path.join(root, 'dist'), path.join(appDir, 'dist'), { recursive: true })

  for (const name of await readdir(path.join(root, 'server'))) {
    if (!name.endsWith('.mjs') || name.endsWith('.test.mjs')) continue
    await cp(path.join(root, 'server', name), path.join(appDir, 'server', name))
  }

  const pkg = createRequire(import.meta.url)(path.join(root, 'package.json'))
  const desktopPkg = {
    name: 'deployx',
    version: pkg.version,
    private: true,
    type: 'module',
    dependencies: {
      ssh2: pkg.dependencies.ssh2,
    },
  }
  await writeFile(path.join(appDir, 'package.json'), JSON.stringify(desktopPkg, null, 2))
  await writeFile(path.join(appDir, '.npmrc'), 'ignore-scripts=false\n')
  await npmInstall(appDir)
}

async function prepareNode() {
  const platform = process.platform
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    throw new Error(`暂不支持为 ${platform} 打包内置 Node`)
  }

  const osName = platform === 'win32' ? 'win' : platform === 'darwin' ? 'darwin' : 'linux'
  const ext = platform === 'win32' ? 'zip' : 'tar.gz'
  const folder = `node-${NODE_VERSION}-${osName}-${arch}`
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${folder}.${ext}`
  const archive = path.join(staging, `${folder}.${ext}`)

  await rm(nodeDir, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })

  if (!(await pathExists(archive))) {
    console.log(`下载 Node ${NODE_VERSION} …`)
    await download(url, archive)
  } else {
    console.log(`复用已下载的 Node 包：${archive}`)
  }

  const extractRoot = path.join(staging, 'node-extract')
  await rm(extractRoot, { recursive: true, force: true })
  await mkdir(extractRoot, { recursive: true })

  if (ext === 'zip') {
    await extractZip(archive, extractRoot)
  } else {
    await run('tar', ['-xzf', archive, '-C', extractRoot], root)
  }

  const extracted = path.join(extractRoot, folder)
  await mkdir(nodeDir, { recursive: true })
  if (platform === 'win32') {
    await cp(path.join(extracted, 'node.exe'), path.join(nodeDir, 'node.exe'))
  } else {
    await cp(path.join(extracted, 'bin', 'node'), path.join(nodeDir, 'node'))
    await run('chmod', ['+x', path.join(nodeDir, 'node')], root)
  }
  await rm(extractRoot, { recursive: true, force: true })
  console.log(`内置 Node 已就绪：${nodeDir}`)
}

await mkdir(staging, { recursive: true })
await prepareApp()
await prepareNode()
console.log('desktop-staging 准备完成')
