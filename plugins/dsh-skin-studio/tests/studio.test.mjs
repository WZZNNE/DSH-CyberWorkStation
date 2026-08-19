import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BG_PLACEHOLDER, assertTarget, buildCss, imageToDataUri, sanitizeSkinName } from '../lib/studio.js'

test('sanitizeSkinName: whitelists, rejects empty', () => {
  assert.equal(sanitizeSkinName('墨绿-matte_01'), '墨绿-matte_01')
  assert.equal(sanitizeSkinName('a/b\\c:d'), 'abcd')
  assert.throws(() => sanitizeSkinName('///'), /非法/)
  assert.equal(sanitizeSkinName('x'.repeat(60)).length, 40)
})

test('assertTarget: only launcher|frontend', () => {
  assert.equal(assertTarget('launcher'), 'launcher')
  assert.equal(assertTarget('frontend'), 'frontend')
  assert.throws(() => assertTarget('web'), /target/)
})

test('imageToDataUri: magic sniffing per format, rejects fakes and oversize', () => {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(8)])
  assert.match(imageToDataUri('x.png', () => png), /^data:image\/png;base64,/)
  const jpg = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(8)])
  assert.match(imageToDataUri('x.jpg', () => jpg), /^data:image\/jpeg;base64,/)
  const webp = Buffer.concat([Buffer.from('52494646', 'hex'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1')])
  assert.match(imageToDataUri('x.webp', () => webp), /^data:image\/webp;base64,/)
  assert.throws(() => imageToDataUri('x.txt', () => Buffer.from('hello world!')), /不是可识别的图片/)
  assert.throws(() => imageToDataUri('big.png', () => Buffer.alloc(26 * 1048576)), /25MB/)
})

test('buildCss: placeholder replacement, auto-append, guard rails', () => {
  const uri = 'data:image/png;base64,AAAA'
  // 占位符替换(多处)
  const withPh = `.a{background:url(${BG_PLACEHOLDER})}.b{background:url(${BG_PLACEHOLDER})}`
  const out = buildCss(withPh, 'frontend', uri)
  assert.equal(out.includes(BG_PLACEHOLDER), false)
  assert.equal(out.split(uri).length - 1, 2)
  // 无占位符 + 有图 → 追加 body 规则(frontend 带 attachment 全套,launcher 简写)
  assert.match(buildCss('.x{color:red}', 'frontend', uri), /body\{background-image:url\(data:.*background-attachment:fixed/)
  assert.match(buildCss('.x{color:red}', 'launcher', uri), /body\{background:url\(data:.*center\/cover fixed no-repeat\}/)
  // 无图:原样通过;但写了占位符没给图必须报错
  assert.equal(buildCss('.x{color:red}', 'launcher', undefined), '.x{color:red}')
  assert.throws(() => buildCss(`.x{background:url(${BG_PLACEHOLDER})}`, 'launcher', undefined), /background_image_path/)
  assert.throws(() => buildCss('   ', 'launcher', undefined), /css 不能为空/)
})
