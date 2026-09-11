# dsh-credentials-center

**中文** | English below

把 dsh 本体和套件插件用到的所有 API 凭据放到一个页面里看和管:设置页「凭据中心」+ 启动器「凭据中心」页。

- **列什么**:每一个凭据引用(环境变量名,如 `OPENROUTER_API_KEY`),来源:`llm-pi-ai` 各路由的 `apiKeyEnv`、DeepSeek 官方路由、多媒体 API 各类(含"借用 DSH 路由"的情况)、联网搜索各来源、桌宠各宠物的模型来源、记忆向量;再加上你自己起过别名的引用。
- **显示什么**:已配置 / 未配置、值存在哪个来源(凭据服务的 describe)、是否可写、绑定在哪些功能上(带细节)、别名与备注。
- **能做什么**:新增/替换密钥、删除密钥、起别名/写备注、添加新的引用。密钥值只经过 dsh 的凭据服务(`ctx.get('credentials')` 的 set/unset,装了 `dsh-credentials-keyring` 就是 Windows 凭据管理器),别名存在 `~/.dsh/credential-aliases.json`(从不含值)。
- **模型清单**:「刷新模型清单」按钮调用 dsh-provider-sync 的 `POST /dsh-provider-sync/sync`,旁边显示上次同步时间与本次结果(模型数 / 新增 / 刷新 / 带思考档位)。核心的模型选择器不动。
- **备用密钥**:每个引用可以存多把密钥(同一个凭据库里的 `REF__SLOT_<id>` 记录,标签记在别名文件里),「启用」把某一把切成正式密钥,被换下的那把自动留作备用(除非它已经在备用列表里),不会丢;「当前使用」按值比对得出,手工替换过密钥后哪一把都不算当前;还有备用密钥的引用不能「移除引用」;`GET …/slots?ref=`、`POST …/slots/add|keep|use|rename|remove`。启动器「凭据中心」页同样有这组按钮。
- **dsh 默认模型**:先选 API 路由,再选该路由下的模型,写入 settings 命名空间 `agent-default-model`(`GET …/models` 列出各路由与模型,`POST …/default-model {provider, model, allowUnlisted?}` 校验后经设置服务写入,带 revision 重试;`allowUnlisted` 只对有自有清单的 llm-pi-ai 路由有效,清单外的 id 会同时加进该路由清单,deepseek-official 这类固定清单的路由会拒绝)。启动器「凭据中心」页与 dsh 设置区写的是同一处;桌宠面板只读显示。
- **路由**:`GET /dsh-credentials-center/list`、`GET …/models`、`GET …/slots?ref=`,`POST …/slots/add|keep|use|rename|remove`,`POST …/set {ref,value}`、`…/unset {ref}`、`…/alias {ref,alias,note}`、`…/default-model {provider,model}`;全部带套件统一的本机 + 同源防线(外来 Host、跨站、Origin 不符、非 JSON 的 POST 一律 403),本机非浏览器调用(启动器、curl)放行。

---

**Spare keys.** A reference can hold several secrets: each spare is a record of its own in the same credential store (`REF__SLOT_<id>`), its label lives in the aliases file. "Use" makes a spare the secret in force and keeps the one it replaces as a new spare unless a spare already holds it; "keep the current" stores a hand-typed secret before switching; rename / delete. "In use" is derived by comparing values at view time, so a secret typed by hand marks no spare. Writes are serialized; a failed switch withdraws its own copy; a reference that still holds spares cannot be forgotten; a read-only reference (one supplied by the environment) cannot be replaced. Routes: `GET …/slots?ref=`, `POST …/slots/add|keep|use|rename|remove`; values are never returned. The launcher's Credentials page has the same panel through `/api/creds/slots*`.

One page for every API credential the harness and the suite use. Lists each credential reference (env-style name) with where it is bound (model routes, media APIs, web-search vendors, desktop pets, memory embeddings), whether it is configured and where it is stored, an alias and a note; lets you add / replace / delete the secret through the core credential service (never a plain file). A dsh Settings section plus a launcher page.
