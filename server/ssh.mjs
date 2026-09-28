import ssh2 from 'ssh2'
const { Client } = ssh2
import { readFile } from 'node:fs/promises'
import { assert, unwrapPath } from './core.mjs'

export async function connect(server, discover = false) {
  assert(typeof server.host === 'string' && /^[A-Za-z0-9.:-]+$/.test(server.host), '服务器地址无效')
  assert(/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(server.username), 'SSH 用户名无效')
  assert(Number.isInteger(Number(server.port)) && Number(server.port) > 0 && Number(server.port) <= 65535, 'SSH 端口无效')
  const config = { host: server.host, port: Number(server.port), username: server.username, readyTimeout: 45000, keepaliveInterval: 10000, keepaliveCountMax: 6, hostHash: 'sha256' }
  if (!discover) {
    assert(/^[a-f0-9]{64}$/.test(server.fingerprint || ''), '先获取并确认服务器指纹')
    if (server.auth === 'key') {
      assert(server.keyPath, '请选择 SSH 私钥文件')
      try { config.privateKey = await readFile(unwrapPath(server.keyPath)) }
      catch { throw new Error(`找不到私钥文件：${server.keyPath}`) }
      config.passphrase = server.passphrase || undefined
    }
    else if (server.auth === 'password') { assert(server.password, '请输入 SSH 密码'); config.password = server.password }
    else if (server.auth === 'agent') { config.agent = server.agent || process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined); assert(config.agent, '未找到 SSH Agent，请填写 socket 路径') }
    else throw new Error('认证方式无效')
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await connectOnce(config, server, discover)
    } catch (error) {
      if (!TRANSIENT.test(error.raw || '') || attempt >= CONNECT_ATTEMPTS) throw error
      await new Promise(r => setTimeout(r, attempt * 1500))
    }
  }
}

const CONNECT_ATTEMPTS = 3
const TRANSIENT = /before handshake|ECONNRESET|Timed out|ETIMEDOUT|timeout|socket hang up|EPIPE/i

function connectOnce(config, server, discover) {
  return new Promise((resolve, reject) => {
    const client = new Client(); let fingerprint
    config.hostVerifier = hash => { fingerprint = hash; return !discover && hash === server.fingerprint }
    client.once('ready', () => resolve(client))
    client.on('error', error => {
      if (discover && fingerprint) { client.end(); resolve(fingerprint); return }
      if (fingerprint && fingerprint !== server.fingerprint) {
        reject(new Error('服务器指纹不一致，连接已停止，请核实服务器身份'))
        return
      }
      const raw = String(error?.message || error || '')
      reject(Object.assign(new Error(`SSH 连接失败：${raw}`), { raw }))
    })
    try { client.connect(config) }
    catch (error) { reject(Object.assign(new Error(`SSH 连接失败：${error.message}`), { raw: String(error.message) })) }
  })
}
export function remote(client, command, onData = () => {}, timeout = 900000) {
  return new Promise((resolve, reject) => {
    let output = ''; let done = false
    const finish = (error) => { if (done) return; done = true; clearTimeout(timer); client.off('close', closed); error ? reject(error) : resolve(output) }
    const closed = () => finish(new Error('SSH 连接中断；远程步骤可能仍在运行，请先查看任务日志再重试'))
    client.once('close', closed)
    const timer = setTimeout(() => { client.end(); finish(new Error('远程步骤超时；请核实服务器状态')) }, timeout)
    client.exec(command, (err, stream) => {
      if (err) return finish(err)
      const data = b => { const s = b.toString(); output = (output + s).slice(-100000); onData(s) }
      stream.on('data', data); stream.stderr.on('data', data)
      stream.once('error', finish)
      stream.once('close', code => finish(code === 0 ? null : Object.assign(new Error(`远程命令退出码 ${code}：${output.slice(-1500)}`), { raw: output.slice(-3000) })))
    })
  })
}
const UPLOAD_STALL_MS = 60000

export function upload(client, local, destination, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    let done = false, sftp, lastMove = Date.now()
    const finish = error => {
      if (done) return
      done = true
      clearInterval(watchdog)
      client.off('close', closed)
      try { sftp?.end() } catch {}
      if (error) { client.end(); reject(error) } else resolve()
    }
    const closed = () => finish(Object.assign(new Error('上传时 SSH 连接中断'), { raw: 'ECONNRESET during upload' }))
    const watchdog = setInterval(() => {
      if (Date.now() - lastMove > UPLOAD_STALL_MS) finish(Object.assign(new Error('上传卡住：60 秒没有任何进度'), { raw: 'upload stalled' }))
    }, 5000)
    client.once('close', closed)
    client.sftp((e, s) => {
      if (e) return finish(e)
      sftp = s
      sftp.once('error', finish)
      sftp.fastPut(local, destination, {
        mode: 0o600,
        step: (transferred, _chunk, total) => { lastMove = Date.now(); onProgress(transferred, total) },
      }, error => finish(error || null))
    })
  })
}
