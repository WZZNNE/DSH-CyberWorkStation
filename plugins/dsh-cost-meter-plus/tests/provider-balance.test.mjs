import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyProvider, detectProviders, isLocalEndpoint, openRouterPriceEntry, perMillion } from '../lib/provider-balance.js'

test('isLocalEndpoint recognizes local hosts', () => {
  for (const url of ['http://localhost:1234/v1', 'http://127.0.0.1:11434', 'http://192.168.1.5:8000/v1', 'http://host.docker.internal:1234', 'http://my-box.local:1234']) {
    assert.equal(isLocalEndpoint(url), true, url)
  }
  for (const url of ['https://openrouter.ai/api/v1', 'https://api.openai.com/v1', 'not a url']) {
    assert.equal(isLocalEndpoint(url), false, url)
  }
})

test('classifyProvider by host first, id fallback', () => {
  assert.equal(classifyProvider('x', 'https://api.deepseek.com'), 'deepseek')
  assert.equal(classifyProvider('x', 'https://openrouter.ai/api/v1'), 'openrouter')
  assert.equal(classifyProvider('x', 'https://api.openai.com/v1'), 'openai')
  assert.equal(classifyProvider('lmstudio', undefined), 'local')
  assert.equal(classifyProvider('openrouter', undefined), 'openrouter')
  assert.equal(classifyProvider('x', 'http://127.0.0.1:1234/v1'), 'local')
  assert.equal(classifyProvider('mystery', 'https://api.example.com'), 'custom')
})

test('detectProviders reads llm-deepseek and llm-pi-ai sections', () => {
  const settings = {
    get: name => name === 'llm-pi-ai'
      ? { providers: { openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY', models: [{ id: 'ai21/jamba-large-1.7' }, { id: 'amazon/nova-2-lite-v1' }] }, lmstudio: { baseURL: 'http://localhost:1234/v1' } } }
      : undefined,
  }
  const providers = detectProviders(settings)
  assert.equal(providers.length, 2)
  const or = providers.find(p => p.id === 'openrouter')
  assert.equal(or.kind, 'openrouter')
  assert.deepEqual(or.modelIds, ['ai21/jamba-large-1.7', 'amazon/nova-2-lite-v1'])
  assert.equal(providers.find(p => p.id === 'lmstudio').kind, 'local')
})

test('detectProviders tolerates missing settings service', () => {
  assert.deepEqual(detectProviders(undefined), [])
})

test('perMillion converts USD/token strings', () => {
  assert.equal(perMillion('0.0000015'), 1.5)
  assert.equal(perMillion(0.0000005), 0.5)
  assert.equal(perMillion('nonsense'), null)
  assert.equal(perMillion(-1), null)
})

test('openRouterPriceEntry maps pricing rows', () => {
  const entry = openRouterPriceEntry({ id: 'x', pricing: { prompt: '0.0000015', completion: '0.0000045', input_cache_read: '0.00000005' } })
  assert.equal(entry.input, 1.5)
  assert.equal(entry.output, 4.5)
  assert.equal(entry.cachedInput, 0.05)
  assert.equal(entry.billingMode, 'flat')
  assert.equal(openRouterPriceEntry({ id: 'x', pricing: null }), null)
  assert.equal(openRouterPriceEntry({ id: 'x', pricing: { prompt: 'abc', completion: '1' } }), null)
})
