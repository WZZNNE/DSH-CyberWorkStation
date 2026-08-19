// 对抗测试:safe-guard 规则的绕过尝试与误杀边界。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluate } from '../lib/rules.js'

const deny = cmd => assert.equal(evaluate(cmd).verdict, 'deny', 'should DENY: ' + cmd)
const allow = cmd => assert.equal(evaluate(cmd).verdict, 'allow', 'should ALLOW: ' + cmd)

test('rm: chained and sudo variants are caught per-segment', () => {
  deny('echo ok && rm -rf /')
  deny('true; sudo rm -fr ~')
  deny('rm -Rf "C:\\"') // 大写 R + 引号盘根
  deny('ls | rm -rf *')
})

test('rm: legitimate recursive deletes are not false-positived', () => {
  allow('rm -rf ./node_modules')
  allow('rm -rf /tmp/build-cache')
  allow('rm -rf dist')
  // 点号开头但非纯 "." 或 "..":合法
  allow('rm -rf .cache')
})

test('git push --force: caught, but --force-with-lease and pathspec lookalikes pass', () => {
  deny('git push --force origin main')
  deny('git push -f')
  allow('git push --force-with-lease origin main')
  allow('git push origin feature/force-ui') // 分支名含 force 不误杀
})

test('windows wipe: format/del/rd drive-root variants, mixed case', () => {
  deny('FORMAT D:')
  deny('del /S /Q C:\\')
  deny('rd /s /q "D:\\"')
  deny('Remove-Item -Recurse -Force C:\\')
  allow('del /s /q .\\build') // 相对目录合法
  allow('rd /s /q node_modules')
})

test('device write and mkfs: caught across separators', () => {
  deny('dd if=/dev/zero of=/dev/sda bs=1M')
  deny('echo x > /dev/nvme0n1')
  deny('yes | mkfs.ext4 /dev/sdb1')
  allow('dd if=in.img of=./out.img') // 普通文件 dd 合法
})

test('fork bomb exact shape caught; harmless colon functions pass', () => {
  deny(':(){ :|:& };:')
  allow('echo ":(){}" # just a string')
})
