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
    if (server.auth === 'key') { config.privateKey = await readFile(unwrapPath(server.keyPath)); config.passphrase = server.passphrase || undefined }
    else if (server.auth === 'password') { assert(server.password, '请输入 SSH 密码'); config.password = server.password }
    else if (server.auth === 'agent') { config.agent = server.agent || process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined); assert(config.agent, '未找到 SSH Agent，请填写 socket 路径') }
    else throw new Error('认证方式无效')
  }
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
      let tip = `SSH 连接失败：${raw}`
      if (/Timed out|ETIMEDOUT|timeout/i.test(raw)) tip = 'SSH 连接超时。请检查服务器是否开机、安全组是否放行 22 端口，以及本机网络是否稳定后重试。'
      else if (/ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH/i.test(raw)) tip = '无法连上服务器。请确认 IP/端口正确，服务器防火墙已放行，并稍后再试。'
      else if (/All configured authentication methods failed|Authentication failure/i.test(raw)) tip = 'SSH 认证失败。请核对用户名、私钥或密码是否正确。'
      reject(new Error(tip))
    })
    client.connect(config)
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
      stream.once('close', code => finish(code === 0 ? null : new Error(`远程命令退出码 ${code}：${output.slice(-1500)}`)))
    })
  })
}
export function upload(client, local, destination) {
  return new Promise((resolve, reject) => client.sftp((e, sftp) => {
    if (e) return reject(e)
    sftp.fastPut(local, destination, { mode: 0o600 }, error => { sftp.end(); error ? reject(error) : resolve() })
  }))
}
