import { spawn } from 'node:child_process'
import { applySystemProxy } from '../server/proxy.mjs'

const proxyUrl = applySystemProxy()
if (proxyUrl) console.log(`DeployX outbound proxy: ${proxyUrl}`)
process.env.NODE_USE_ENV_PROXY = '1'

const children = [
  spawn(process.execPath, ['--watch', 'server/index.mjs'], { stdio: 'inherit', windowsHide: true, env: process.env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: 'inherit', windowsHide: true, env: process.env }),
]

let stopping = false
function killTree(child) {
  if (!child?.pid || child.exitCode != null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
}
const stop = () => {
  if (stopping) return
  stopping = true
  children.forEach(killTree)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
children.forEach(c => {
  c.on('error', e => { console.error(e.message); stop(); process.exitCode = 1 })
  c.on('exit', code => { stop(); if (code) process.exitCode = code })
})
