# dsh-lan-fence

**中文** | English below

开手机远程(`@linxin666/dsh-remote-web-ui`,绑 0.0.0.0)时,本体会把本机自动推导出的局域网 IP 授信到 `/api` 防线上——未配对的局域网设备就拿到了完整桌面 API。这个插件在防线读取授信列表的地方**就地剥掉**那些自动推导的 LAN 授权,不改本体一行代码;配对通道 `/remote` 不受影响。

- 只在服务器绑到所有网卡时起作用;`127.0.0.1` / 显式配置的 `trustedHosts` 原样保留。
- 未授信的 LAN 请求拿到的是本体自己的 403,不是本插件的。

## 安装(不是 bundle)

它就地编辑本体的连接防线,没有 `dsh.bundle.patch`,是 profile 自己 `cordis.patch.yml` 的一层(`setup.cmd` 经 `launcher/dsh-patch-layers.mjs` 幂等写入):

```yaml
- insert:
    - id: lan-fence
      name: 'dsh-lan-fence'
```

启动器「自检」按 patch 文件识别它。

## 测试

`node --test .local/tests/dsh-lan-fence/*.mjs` — 授信列表剥离用例(loopback 保留、LAN 字面量移除、显式 trustedHosts 不动)。

---

When the server binds every interface (mobile remote), the core trusts this machine's auto-derived LAN IP literals on the `/api` fence, handing an unpaired LAN device the whole desktop API. This plugin removes exactly those authorities from the list the fence reads — in place, with zero core change; loopback and explicitly configured `trustedHosts` stay. It is a layer of the profile's own `cordis.patch.yml` (written by `launcher/dsh-patch-layers.mjs` from `setup.cmd`), not a bundle.
