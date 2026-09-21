import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProxy, applySystemProxy, readWindowsProxy } from './proxy.mjs'

test('normalizeProxy accepts host:port and scheme lists', () => {
  assert.equal(normalizeProxy('127.0.0.1:7897'), 'http://127.0.0.1:7897')
  assert.equal(normalizeProxy('http://127.0.0.1:7897'), 'http://127.0.0.1:7897')
  assert.equal(normalizeProxy('http=127.0.0.1:7890;https=127.0.0.1:7897'), 'http://127.0.0.1:7897')
  assert.equal(normalizeProxy(''), null)
})

test('applySystemProxy keeps existing env and can read Windows proxy', () => {
  const previous = { https: process.env.HTTPS_PROXY, http: process.env.HTTP_PROXY, all: process.env.ALL_PROXY }
  try {
    process.env.HTTPS_PROXY = 'http://example-proxy:8080'
    delete process.env.HTTP_PROXY
    delete process.env.ALL_PROXY
    assert.equal(applySystemProxy(), 'http://example-proxy:8080')
    assert.equal(process.env.HTTP_PROXY, 'http://example-proxy:8080')
  } finally {
    for (const [key, value] of [['HTTPS_PROXY', previous.https], ['HTTP_PROXY', previous.http], ['ALL_PROXY', previous.all]]) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
  if (process.platform === 'win32') {
    const system = readWindowsProxy()
    assert.ok(system === null || /^https?:\/\//.test(system))
  }
})
