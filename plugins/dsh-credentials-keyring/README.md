# dsh-credentials-keyring

**中文** | English below

## Install / 安装

```sh
dsh plugin --profile web add dsh-credentials-keyring
```

This plugin is a patch layer, not a bundle: after the command above add the entry below to `~/.dsh/profiles/web/cordis.patch.yml` (keep the file a YAML array) and restart dsh. `setup.cmd` of [DSH CyberWorkStation](https://github.com/WZZNNE/DSH-CyberWorkStation) does both steps for you.

这个插件不是 bundle 而是 patch 层：执行上面的命令后，把下面这段加进 `~/.dsh/profiles/web/cordis.patch.yml`（保持文件是 YAML 数组），重启 dsh。DSH CyberWorkStation 的 `setup.cmd` 会自动完成这两步。

```yaml
- id: credentials
  disabled: true
- insert:
    - id: credentials-keyring
      name: 'dsh-credentials-keyring'
```

把 dsh 的凭据存进 **Windows 凭据管理器**,替换本体默认的明文 `.credentials.yaml` 提供者(同一个 `credentials` 服务,其它插件无感)。

- 记录名 `dsh:<引用名>`(如 `dsh:OPENROUTER_API_KEY`);环境变量仍然优先;写入即迁移(第一次在任何面板「保存密钥」时,该引用从旧文件搬进钥匙串);钥匙串故障一律记警告、回退只读。
- 凭据中心页(启动器 / dsh 设置)里「来源:windows-credential-manager」就是它。

## 安装(不是 bundle)

这个插件**没有** `dsh.bundle.patch`:它要替换本体的 `credentials` 提供者,必须先把本体那条禁用,所以只能作为 profile 自己 `cordis.patch.yml` 的一层。`setup.cmd` 通过 `launcher/dsh-patch-layers.mjs` 幂等地写入这两段(手工亦可):

```yaml
- id: credentials
  disabled: true
- insert:
    - id: credentials-keyring
      name: 'dsh-credentials-keyring'
```

启动器「自检」按 profile 的 patch 文件识别它(bundles 列表里不会有它,这是正常的)。


---

Stores dsh credentials in the **Windows Credential Manager** (`dsh:<reference>` records) instead of the stock plaintext file; environment variables still win, secrets migrate on the first write, and a keyring failure degrades to read-only with a warning. It replaces the stock `credentials` provider, so it is a layer of the profile's own `cordis.patch.yml` (written idempotently by `launcher/dsh-patch-layers.mjs` from `setup.cmd`), not a bundle; the launcher self-check reads that file to find it.
