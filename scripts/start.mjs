import { spawn } from 'node:child_process'
import { applySystemProxy } from '../server/proxy.mjs'

const proxyUrl = applySystemProxy()
if (proxyUrl) console.log(`DeployX outbound proxy: ${proxyUrl}`)
process.env.NODE_USE_ENV_PROXY = '1'

const child = spawn(process.execPath, ['server/index.mjs'], {
  stdio: 'inherit',
  windowsHide: true,
  env: process.env,
})
child.on('exit', code => process.exit(code ?? 0))
child.on('error', error => {
  console.error(error.message)
  process.exit(1)
})
