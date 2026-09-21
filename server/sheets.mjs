import { createSign } from 'node:crypto'
import { assert, columnName, sitesFromRows } from './core.mjs'

async function googleFetch(url, options) {
  try {
    return await fetch(url, options)
  } catch (error) {
    const detail = error?.cause?.code || error?.cause?.message || error?.message || '网络错误'
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
    throw new Error(`无法连接 Google API（${detail}）。${proxy ? `当前代理：${proxy}。` : '本机似乎未配置 Node 可用的 HTTPS_PROXY。'}请确认代理软件已开启，或在终端设置 HTTPS_PROXY 后重启 pnpm dev。`)
  }
}

async function accessToken(account) {
  assert(account.client_email && account.private_key, '请提供有效的 Google 服务账号 JSON')
  const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url')
  const r = await googleFetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }), signal: AbortSignal.timeout(20000) })
  const body = await r.json(); assert(r.ok, 'Google 授权失败，请确认服务账号及系统时间'); return body.access_token
}
async function api(id, suffix, account, body) {
  assert(/^[a-zA-Z0-9_-]+$/.test(id), 'Google 表格 ID 无效')
  const token = await accessToken(account)
  const r = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${suffix}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
  const json = await r.json()
  if (!r.ok) {
    const message = json.error?.message || String(r.status)
    if (/does not have permission|permission denied|forbidden/i.test(message)) {
      assert(false, 'Google Sheets：没有访问权限。请打开该表格 → 共享，把服务账号 JSON 中的 client_email 加为“编辑者”，保存后再试。')
    }
    if (/has not been used|is disabled|API has not been/i.test(message)) {
      assert(false, `Google Sheets：请先在 Google Cloud 为此项目启用 Sheets API，等待几分钟后再试。详情：${message}`)
    }
    assert(false, `Google Sheets：${message}`)
  }
  return json
}
export async function loadSheet({ id, tab, account }) {
  const meta = await api(id, '?fields=sheets.properties', account)
  const sheet = meta.sheets.find(s => s.properties.title === tab)
  assert(sheet, '未找到此工作表名称，请输入底部标签的准确名称')
  const range = `'${tab.replaceAll("'", "''")}'!A1:Z1000`
  const result = await api(id, `/values/${encodeURIComponent(range)}`, account)
  const parsed = sitesFromRows(result.values || [])
  assert(parsed.portColumn >= 0, '表格需要包含 Port/端口 列，才能在部署后回填')
  return parsed
}
export async function writePorts(source, results) {
  const fresh = await loadSheet(source)
  const data = []
  for (const result of results.filter(r => r.status === 'deployed' && r.port)) {
    const matches = fresh.sites.filter(s => s.domain === result.domain && s.siteKey === result.siteKey)
    assert(matches.length === 1, `${result.domain} 在表格中不存在或有重复，停止回填`)
    const target = matches[0]
    assert(!target.port || target.port === result.port, `${result.domain} 的 Port 已被修改，请人工核对`)
    data.push({ range: `'${source.tab.replaceAll("'", "''")}'!${columnName(fresh.portColumn)}${target.sourceRow}`, values: [[result.port]] })
  }
  if (data.length) {
    await api(source.id, '/values:batchUpdate', source.account, { valueInputOption: 'RAW', data })
    const verified = await loadSheet(source)
    for (const r of results.filter(r => r.status === 'deployed' && r.port)) assert(verified.sites.some(s => s.domain === r.domain && s.siteKey === r.siteKey && s.port === r.port), `${r.domain} Port 读回不一致`)
  }
  return data.length
}
