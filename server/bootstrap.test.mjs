import test from 'node:test'
import assert from 'node:assert/strict'
import { buildInstallScript, missingPackages, parseReport, requirementsFromReport } from './bootstrap.mjs'

const blankDebian = `SYSTEM Linux
DISTRO_ID ubuntu
DISTRO_LIKE debian
NODE 
NGINX 
PM2 
CERTBOT 
SUDO yes

PORTS
`

const readyDebian = `SYSTEM Linux
DISTRO_ID debian
DISTRO_LIKE 
NODE v22.14.0
NGINX /usr/sbin/nginx
PM2 /usr/bin/pm2
CERTBOT /usr/bin/certbot
SUDO yes

PORTS
`

test('parseReport detects debian family and missing tools', () => {
  const parsed = parseReport(blankDebian)
  assert.equal(parsed.osFamily, 'debian')
  assert.equal(parsed.hasSudo, true)
  assert.equal(parsed.hasNginx, false)
  assert.equal(parsed.hasNode22, false)
  assert.deepEqual(missingPackages(parsed), ['nginx', 'node', 'pm2', 'certbot'])
})

test('parseReport accepts Node 22+ and rejects older Node', () => {
  assert.equal(parseReport(readyDebian).hasNode22, true)
  assert.equal(parseReport(readyDebian.replace('v22.14.0', 'v20.11.0')).hasNode22, false)
})

test('requirementsFromReport exposes bootstrap eligibility', () => {
  const req = requirementsFromReport(blankDebian)
  assert.equal(req.canBootstrap, true)
  assert.equal(req.ready, false)
  assert.ok(req.items.some(i => i.id === 'nginx' && !i.ok))
  assert.equal(requirementsFromReport(readyDebian).ready, true)
  assert.equal(requirementsFromReport(readyDebian).canBootstrap, false)
})

test('buildInstallScript installs only requested missing packages', () => {
  const parsed = parseReport(blankDebian)
  const all = buildInstallScript(undefined, parsed)
  assert.deepEqual(all.packages, ['nginx', 'node', 'pm2', 'certbot'])
  assert.match(all.script, /apt-get install -y nginx/)
  assert.match(all.script, /nodesource\.com\/node_22\.x/)
  assert.match(all.script, /npm install -g pm2/)
  assert.match(all.script, /python3-certbot-nginx/)
  assert.match(all.script, /DEBIAN_FRONTEND=noninteractive/)

  const partial = buildInstallScript(['nginx', 'certbot'], parsed)
  assert.deepEqual(partial.packages, ['nginx', 'certbot'])
  assert.match(partial.script, /nginx/)
  assert.doesNotMatch(partial.script, /node_22/)
  assert.doesNotMatch(partial.script, /pm2/)
})

test('buildInstallScript rejects non-debian, missing sudo, and empty work', () => {
  assert.throws(() => buildInstallScript(['nginx'], parseReport(blankDebian.replace('ubuntu', 'fedora').replace('debian', 'fedora'))), /Ubuntu \/ Debian/)
  assert.throws(() => buildInstallScript(['nginx'], parseReport(blankDebian.replace('SUDO yes', 'SUDO no'))), /免密 sudo/)
  assert.throws(() => buildInstallScript(['nginx'], parseReport(readyDebian)), /没有需要安装/)
  assert.throws(() => buildInstallScript(['redis'], parseReport(blankDebian)), /不支持安装/)
})
