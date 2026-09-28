import test from 'node:test'
import assert from 'node:assert/strict'
import { explainError, formatExplanation } from './errors.mjs'

const explain = (message, raw) => explainError(Object.assign(new Error(message), raw ? { raw } : {}))

test('SSH 握手前断开给出 VPN / 限流说明', () => {
  const d = explain('SSH 连接失败：Connection lost before handshake', 'Connection lost before handshake')
  assert.match(d.title, /握手/)
  assert.ok(d.reasons.some(r => /VPN|TUN/.test(r)))
  assert.ok(d.steps.length > 0)
})

test('认证失败提示核对用户名和私钥', () => {
  const d = explain('SSH 连接失败：All configured authentication methods failed')
  assert.match(d.title, /登录被拒绝/)
})

test('远程脚本输出中的 certbot 错误被识别', () => {
  const d = explain('远程命令退出码 1：...', 'Certbot failed to authenticate some domains\nType: unauthorized\nDetail: Invalid response from http://a.com')
  assert.match(d.title, /证书/)
})

test('sudo 需要密码被识别', () => {
  assert.match(explain('远程命令退出码 1：sudo: a password is required').title, /sudo/)
})

test('未知远程退出码保留原始输出', () => {
  const d = explain('远程命令退出码 7：something weird', 'something weird')
  assert.match(d.title, /退出码 7/)
  assert.equal(d.raw, 'something weird')
})

test('本机构建失败', () => {
  assert.match(explain('本地命令退出码 1', 'error TS2322: Type string').title, /本机构建/)
})

test('已是中文的业务错误原样作为标题', () => {
  const d = explain('请先核实并确认服务器指纹')
  assert.equal(d.title, '请先核实并确认服务器指纹')
  assert.equal(d.steps.length, 0)
})

test('错误说明会隐藏密码', () => {
  const d = explainError(Object.assign(new Error('远程命令退出码 1'), { raw: 'pw=hunter22 leaked' }), ['hunter22'])
  assert.ok(!d.raw.includes('hunter22'))
  assert.match(formatExplanation(d), /原始错误信息/)
})
