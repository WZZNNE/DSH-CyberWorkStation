# dsh-drop-files

**中文** | English below

把任意文件拖进 dsh 对话(文件落到工作区;智能体用文件工具读取——它只能读文本,PDF / Office / 压缩包会落盘但读不出内容,拖入时会提示)。

- core 的拖放只收图片(附件栏)。这个插件在 capture 阶段接管带有非图片文件的拖放:文件保存到**当前会话工作区**的 `.dsh-uploads/` 目录(同名自动 `-2 / -3`,单个 ≤ 25 MB),然后在输入框里写入 `@.dsh-uploads/<文件名>`,智能体用它本来就有权限的文件工具读取。
- 只拖图片时不介入,仍走 core 的附件栏;图片与其他文件混拖时一律按文件放入工作区。
- 没有工作区的会话提示"文件无处可放";临时对话(dsh-temp-chat)有自己的 scratch 目录,文件会落在那里的 `.dsh-uploads/`。
- 路由:`POST /dsh-drop-files/upload {workspace, sessionId?, name, base64}`(套件统一的本机 + 同源防线)。服务端不信任浏览器报的目录:先看 `sessionId` 指的会话(在线的,或持久化快照里的),再看有没有任何会话的工作区就是这个目录,都没有则 403 `unknown-workspace`(刚从列表打开、还没发过消息的会话可能遇到,浏览器端会提示先发一条消息或重开会话)。文件名做安全清洗(分隔符、Windows 保留字符、控制字节、结尾的点和空格),永远只写在 `.dsh-uploads/` 里,该目录自带 `.gitignore`(`*`),上传物不会进你的仓库。

---

Drop any file onto the DeepSeek Harness chat. The core's drop only accepts images; this plugin takes drops carrying other files, saves them under the current session workspace's `.dsh-uploads/` folder (clashes get `-2`, `-3`, ≤ 25 MB each) and inserts `@.dsh-uploads/<name>` into the composer so the agent reads them with the file tools it already has. Image-only drops still go to the core's attachment rail.

## 测试

`node --test .local/tests/dsh-drop-files/*.mjs` — 9 条维护者用例:文件名清洗、重名编号、经假 Cordis 上下文走上传路由(写入、各种拒绝、大小上限、卸载)。
