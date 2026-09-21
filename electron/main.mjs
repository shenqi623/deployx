import { app, BrowserWindow, dialog, shell } from 'electron'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { access } from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PREFERRED_PORT = Number(process.env.DEPLOYX_PORT || 4318)

let mainWindow = null
let apiProcess = null
let stopping = false
let apiBase = `http://127.0.0.1:${PREFERRED_PORT}`
let apiLogs = ''

function isPackaged() {
  return app.isPackaged
}

function appRoot() {
  if (isPackaged()) return path.join(process.resourcesPath, 'app')
  return path.resolve(__dirname, '..')
}

function resolveNodeBinary() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  }
  if (process.env.npm_node_execpath) return process.env.npm_node_execpath
  return process.platform === 'win32' ? 'node.exe' : 'node'
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function appendLog(chunk) {
  const text = String(chunk || '')
  apiLogs = (apiLogs + text).slice(-8000)
  process.stdout.write(text)
}

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = port => {
      if (port > startPort + 40) {
        reject(new Error(`找不到可用端口（已尝试 ${startPort}-${startPort + 40}）`))
        return
      }
      const server = net.createServer()
      server.unref()
      server.once('error', () => tryPort(port + 1))
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(port))
      })
    }
    tryPort(startPort)
  })
}

async function waitForApi(port, child, timeoutMs = 45000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (!child || child.exitCode != null) {
      const detail = apiLogs.trim() || `进程提前退出（代码 ${child?.exitCode ?? 'unknown'}）`
      throw new Error(`本地服务未能启动。\n\n${detail}`)
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return
    } catch {
      /* retry */
    }
    await sleep(250)
  }
  const detail = apiLogs.trim()
  throw new Error(
    `本地服务启动超时（端口 ${port}）。\n\n` +
      (detail || '没有捕获到服务日志。若刚关闭过 DeployX / pnpm dev，请等几秒再开，或重启电脑后再试。'),
  )
}

async function startApi() {
  apiLogs = ''
  const root = appRoot()
  const nodeBin = resolveNodeBinary()
  const entry = path.join(root, 'server', 'index.mjs')
  await access(entry)

  const port = await findFreePort(PREFERRED_PORT)
  apiBase = `http://127.0.0.1:${port}`

  const dataDir = path.join(app.getPath('userData'), 'data')
  const env = {
    ...process.env,
    PORT: String(port),
    DEPLOYX_DATA_DIR: dataDir,
    NODE_USE_ENV_PROXY: '1',
  }

  apiProcess = spawn(nodeBin, [entry], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  apiProcess.stdout?.on('data', appendLog)
  apiProcess.stderr?.on('data', appendLog)
  apiProcess.on('error', error => appendLog(`启动失败：${error.message}\n`))
  apiProcess.on('exit', code => {
    const proc = apiProcess
    apiProcess = null
    if (!stopping && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('DeployX', `本地服务已退出（代码 ${code ?? 'unknown'}）。\n\n${apiLogs.trim() || '无更多日志'}`)
    }
    void proc
  })

  await waitForApi(port, apiProcess)
}

function stopApi() {
  stopping = true
  if (!apiProcess || apiProcess.killed) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(apiProcess.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    apiProcess.kill('SIGTERM')
  }
  apiProcess = null
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'DeployX',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  await mainWindow.loadURL(apiBase)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    try {
      await startApi()
      await createWindow()
    } catch (error) {
      dialog.showErrorBox('DeployX 启动失败', error instanceof Error ? error.message : String(error))
      stopApi()
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    stopApi()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => stopApi())

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        stopping = false
        if (!apiProcess) await startApi()
        await createWindow()
      } catch (error) {
        dialog.showErrorBox('DeployX 启动失败', error instanceof Error ? error.message : String(error))
      }
    }
  })
}
