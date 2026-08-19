# DSH Launcher — DeepSeek Harness 可视化管理工作台

参考秋叶(秋葉aaaki)ComfyUI 整合包启动器的功能形态(一键启动/版本与插件管理/更新/界面美化)为 dsh 定制。零依赖(仅 Node ≥18),双击 `start-launcher.cmd` 或 `node server.mjs` 启动,浏览器打开 http://127.0.0.1:3090。

## 功能

| 分节 | 内容 |
|---|---|
| 仪表盘 | dsh 一键启动 / 退出 / 打开 Web UI / 实时状态 / dsh 输出尾巴 |
| 插件管理 | profile 插件列表(版本/来源/bundle 层)、npm 或 link: 一键安装、卸载 |
| Skill 管理 | 用户 Skills(~/.dsh/skills)+ 仓库官方 skills 列表、一键打开文件夹 |
| 对话管理 | 会话日志列表(大小/时间)、一键跳转文件夹 |
| 存储空间 | 9 个关键目录占用统计(60s 缓存)+ 资源管理器一键跳转 |
| 更新推送 | 本体(git pull+install+build)与插件(pnpm update)一键后台更新 + 实时输出 |
| Tokens 统计 | 按日 / 按模型表格(调用、命中、未命中、输出、费用;数据源 cost-meter 账本) |
| 外观皮肤 | 启动器皮肤与前端皮肤**分开**导入 / 切换;前端可一键恢复原生 |
| 内部日志 | 启动器日志(logs/launcher-日期.log,全动作记录)、dsh 输出、两路更新日志 |

## 皮肤机制

- **启动器皮肤**:`skins/launcher/*.css`,覆盖 `--lc-*` 变量;切换即时生效。内置 `default` 与 `cyberpunk-2077`(骇客风:霓虹黄 #fcee0a × 电子青 #00f0ff、扫描线、切角卡片、故障动画)。
- **前端皮肤**:`skins/frontend/*.css`,覆盖 dsh 的 `--dsw-alias-*` 令牌(浅色 `:root` + 深色 `body[data-ds-dark-theme]` 双组,依据 `packages/client/ui-theme/src/styles/design-platform.css`)。切换 = 拷贝到 `~/.dsh/frontend-skin.css`,由 `dsh-skin-loader` 插件(H:\dsh-plugins\dsh-skin-loader)经 `ctx.webServer.register` 路由 + 浏览器 style 注入加载;刷新 dsh 页面生效,「(无)」恢复原生。

## 安全边界

- 仅绑 127.0.0.1;文件夹跳转走白名单;插件安装参数过滤 shell 元字符;皮肤名清洗、CSS ≤500KB。
- 不提供会话删除(只读列表 + 跳转,删除请自行在资源管理器操作)。
