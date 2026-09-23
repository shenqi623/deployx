import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { access } from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PREFERRED_PORT = Number(process.env.DEPLOYX_PORT || 4318)
const PORT_SPAN = 40

let mainWindow = null
let apiProcess = null
let stopping = false
let allowClose = false
let apiBase = `http://127.0.0.1:${PREFERRED_PORT}`
let apiLogs = ''
let startingApi = false

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

function isAddrInUse(text) {
  return /EADDRINUSE|address already in use|端口 .+ 已被占用/i.test(String(text || ''))
}

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = port => {
      if (port > startPort + PORT_SPAN) {
        reject(new Error('BUSY'))
        return
      }
      const server = net.createServer()
      server.unref()
      server.once('error', () => tryPort(port + 1))
      server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
        server.close(err => (err ? tryPort(port + 1) : resolve(port)))
      })
    }
    tryPort(startPort)
  })
}

function killChild(child) {
  if (!child || child.killed || child.exitCode != null) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child.exitCode == null) child.kill('SIGKILL')
      }, 1500).unref?.()
    }
  } catch {
    /* ignore */
  }
}

async function waitForApi(port, child, timeoutMs = 45000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (!child || child.exitCode != null) {
      const detail = apiLogs.trim()
      const err = new Error(isAddrInUse(detail) ? 'EADDRINUSE' : 'EXIT')
      err.detail = detail
      err.code = isAddrInUse(detail) ? 'EADDRINUSE' : 'EXIT'
      throw err
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return
    } catch {
      /* retry */
    }
    await sleep(250)
  }
  const err = new Error('TIMEOUT')
  err.code = 'TIMEOUT'
  err.detail = apiLogs.trim()
  throw err
}

function spawnApi(nodeBin, entry, root, port, dataDir) {
  const env = {
    ...process.env,
    PORT: String(port),
    DEPLOYX_DATA_DIR: dataDir,
    NODE_USE_ENV_PROXY: '1',
    DEPLOYX_DESKTOP: '1',
  }
  const child = spawn(nodeBin, [entry], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.on('data', appendLog)
  child.stderr?.on('data', appendLog)
  child.on('error', error => appendLog(`启动失败：${error.message}\n`))
  return child
}

async function startApi() {
  if (apiProcess && apiProcess.exitCode == null) return
  startingApi = true
  apiLogs = ''
  const root = appRoot()
  const nodeBin = resolveNodeBinary()
  const entry = path.join(root, 'server', 'index.mjs')
  await access(entry)

  const dataDir = path.join(app.getPath('userData'), 'data')
  let nextPort = PREFERRED_PORT
  let lastError = null

  try {
    for (let attempt = 0; attempt <= PORT_SPAN; attempt++) {
      let port
      try {
        port = await findFreePort(nextPort)
      } catch {
        break
      }

      apiLogs = ''
      apiBase = `http://127.0.0.1:${port}`
      const child = spawnApi(nodeBin, entry, root, port, dataDir)
      apiProcess = child

      const onExit = code => {
        if (apiProcess !== child) return
        apiProcess = null
        if (!stopping && !startingApi && mainWindow && !mainWindow.isDestroyed()) {
          dialog.showErrorBox(
            'DeployX',
            '本地服务意外退出。请重新打开 DeployX；若仍不行，可先完全退出后再开，或重启电脑。',
          )
          void code
        }
      }
      child.on('exit', onExit)

      try {
        await waitForApi(port, child)
        child.removeListener('exit', onExit)
        child.on('exit', onExit)
        return
      } catch (error) {
        lastError = error
        child.removeListener('exit', onExit)
        if (apiProcess === child) apiProcess = null
        killChild(child)
        await sleep(150)

        if (error?.code === 'EADDRINUSE') {
          nextPort = port + 1
          continue
        }
        break
      }
    }

    const detail = (lastError?.detail || apiLogs || '').trim().slice(-1200)
    const friendly =
      lastError?.code === 'EADDRINUSE' || lastError?.message === 'BUSY'
        ? '无法启动 DeployX：本机临时通道都被占用了。\n\n请完全退出所有 DeployX 窗口后重试；仍不行请重启电脑后再打开。'
        : lastError?.code === 'TIMEOUT'
          ? '启动超时。请再试一次；若刚关闭过 DeployX，请稍等几秒后再开。'
          : '无法启动本地服务。请重新打开 DeployX；仍不行请重启电脑后再试。'
    throw new Error(detail ? `${friendly}\n\n详情：\n${detail}` : friendly)
  } finally {
    startingApi = false
  }
}

function stopApi() {
  stopping = true
  const child = apiProcess
  apiProcess = null
  killChild(child)
}

async function fetchActiveJobId() {
  try {
    const res = await fetch(`${apiBase}/api/health`)
    if (!res.ok) return null
    const data = await res.json()
    return data.activeJob || null
  } catch {
    return null
  }
}

async function requestStopJob(jobId) {
  try {
    await fetch(`${apiBase}/api/jobs/${jobId}/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DeployX-Client': 'local-ui',
      },
      body: '{}',
    })
  } catch {
    /* ignore */
  }
}

function forceCloseWindow() {
  allowClose = true
  stopApi()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
  mainWindow = null
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
      preload: path.join(__dirname, 'preload.cjs'),
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

  mainWindow.on('close', e => {
    if (allowClose || stopping) return
    e.preventDefault()
    void (async () => {
      const jobId = await fetchActiveJobId()
      if (!jobId) {
        forceCloseWindow()
        if (process.platform !== 'darwin') app.quit()
        return
      }
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['继续等待', '停止任务并退出'],
        defaultId: 0,
        cancelId: 0,
        title: '部署仍在进行',
        message: '现在还有部署任务在跑。',
        detail:
          '关闭窗口会中断本机对任务的监控；服务器上的命令可能还在执行。\n\n建议等任务完成，或选择「停止任务并退出」（会请求完成当前站点后停止）。',
      })
      if (response !== 1) return
      await requestStopJob(jobId)
      forceCloseWindow()
      if (process.platform !== 'darwin') app.quit()
    })()
  })

  await mainWindow.loadURL(apiBase)
}

ipcMain.handle('deployx:pick-directory', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow
  const result = await dialog.showOpenDialog(win, {
    title: '选择本地项目文件夹',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('deployx:pick-file', async (_event, filters) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow
  const result = await dialog.showOpenDialog(win, {
    title: '选择文件',
    properties: ['openFile'],
    filters: Array.isArray(filters) && filters.length
      ? filters
      : [
          { name: '私钥', extensions: ['pem', 'key', 'pub', '*'] },
          { name: '所有文件', extensions: ['*'] },
        ],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

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
    if (process.platform !== 'darwin') {
      stopApi()
      app.quit()
    }
  })

  app.on('before-quit', () => {
    allowClose = true
    stopApi()
  })

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        stopping = false
        allowClose = false
        if (!apiProcess) await startApi()
        await createWindow()
      } catch (error) {
        dialog.showErrorBox('DeployX 启动失败', error instanceof Error ? error.message : String(error))
      }
    }
  })
}
