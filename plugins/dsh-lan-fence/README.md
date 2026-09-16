# dsh-lan-fence

**中文** | English below

## Install / 安装

```sh
dsh plugin --profile web add dsh-lan-fence
```

This plugin is a patch layer, not a bundle: after the command above add the entry below to `~/.dsh/profiles/web/cordis.patch.yml` (keep the file a YAML array) and restart dsh. `setup.cmd` of [DSH CyberWorkStation](https://github.com/WZZNNE/DSH-CyberWorkStation) does both steps for you.

这个插件不是 bundle 而是 patch 层：执行上面的命令后，把下面这段加进 `~/.dsh/profiles/web/cordis.patch.yml`（保持文件是 YAML 数组），重启 dsh。DSH CyberWorkStation 的 `setup.cmd` 会自动完成这两步。

```yaml
- insert:
    - id: lan-fence
      name: 'dsh-lan-fence'
```

开手机远程(`@linxin666/dsh-remote-web-ui`,绑 0.0.0.0)时,本体会把本机自动推导出的局域网 IP 授信到 `/api` 防线上——未配对的局域网设备就拿到了完整桌面 API。这个插件在防线读取授信列表的地方**就地剥掉**那些自动推导的 LAN 授权,不改本体一行代码;配对通道 `/remote` 不受影响。

- 只在服务器绑到所有网卡时起作用;`127.0.0.1` / 显式配置的 `trustedHosts` 原样保留。
- 未授信的 LAN 请求拿到的是本体自己的 403,不是本插件的。

---

When the server binds every interface (mobile remote), the core trusts this machine's auto-derived LAN IP literals on the `/api` fence, handing an unpaired LAN device the whole desktop API. This plugin removes exactly those authorities from the list the fence reads — in place, with zero core change; loopback and explicitly configured `trustedHosts` stay. It is a layer of the profile's own `cordis.patch.yml` (written by `launcher/dsh-patch-layers.mjs` from `setup.cmd`), not a bundle.
