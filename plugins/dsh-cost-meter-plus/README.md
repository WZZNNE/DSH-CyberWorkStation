# dsh-cost-meter-plus

> Fork of [Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) 1.5.19 (MIT), maintained as part of [DSH CyberWorkStation](https://github.com/WZZNNE/DSH-CyberWorkStation). The upstream README documents the base plugin in full; this page covers the fork's differences and how to install it.

## 安装 / Install

```sh
dsh plugin --profile web add dsh-cost-meter-plus
```

重启 dsh。不要和上游 `dsh-cost-meter` 同时安装，两者注册同一个插件 id。在 DSH CyberWorkStation 里由 `setup.cmd` 自动注册。
Restart dsh afterwards. Do not install the upstream `dsh-cost-meter` beside it: both register the same plugin id.

## 上游提供 / From upstream

本会话、当日、本月、累计费用，预算与超支提示，官方账户余额，Coding Plan 额度，90 多个模型的价格目录与官方价格同步，历史记录，中英双语界面。
Per-session, daily, monthly and all-time cost; budgets and overspend hints; the official account balance; Coding Plan quotas; a price catalog of 90-odd models with official price sync; history; a zh / en UI.

## 这个分支加的 / Added in this fork

- 多厂商余额：DeepSeek 官方、OpenRouter credits、本地端点（只提示 token）、OpenAI（说明无余额接口）；余额符号跟随接口币种。
- 启动时按路由配置自动同步 OpenRouter 模型价格（USD / 1M tokens，只补缺、不覆盖手改）。
- 侧栏的峰谷条换成缓存命中条：命中 / 未命中两段加今日命中率，悬停看今日、近 7 天、本月、累计。
- 会话行显示 总 tokens · 命中 · 未命中 · 输出；指向本机地址的路由不计费，除非该路由配置的是付费厂商的凭据。
- 设置页把余额和费用放到最上面。

Multi-vendor balances (DeepSeek, OpenRouter credits, local endpoints, OpenAI), automatic OpenRouter price sync at start, a cache-hit bar in the sidebar instead of the peak/off-peak bar, a per-session token split, free local routes, and balance and cost at the top of the settings page.

## 计费与数据 / Billing and data

- 价格单位为美元 / 1M tokens；成本 = 未命中输入 × cache-miss + 输出 × output + 缓存读写 × cache-hit；账本恒以美元存储，币种与汇率只影响显示。
- 账本在 `$DSH_HOME/storages/cost-meter/ledger.json`（原子写入）；删除文件即清零，或在设置页「清除全部历史」。
- 预算超支只提醒，不阻止调用。

## 版本 / Versions

分支从 1.6.0 起自行编号（基于上游 1.5.19），与上游后续版本号无关，不能按数字比较新旧。The fork numbers its own releases from 1.6.0 (based on upstream 1.5.19); the numbers are unrelated to later upstream versions.

## License

MIT, inherited from upstream; see `LICENSE`.
