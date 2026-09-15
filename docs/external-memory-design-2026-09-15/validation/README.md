# 参考模型验证说明

## 实际结果

本次有限参考模型 37 项检查通过，失败 0，错误 0。环境为 Python 3.12.14、SQLite 3.53.1。机器可读记录见 [results.json](results.json)。

这些检查验证结构化命令和 SQLite 状态，不评估模型意图识别或检索质量。测试包含特定双连接交错及子进程在提交前/提交后直接退出；不包含断电测试、生产负载测试或所有可能的并发调度。

## 已验证的子集

新建和当前读取、双时间查询、明确 CORRECT 回溯、未来开始和区间边界、撤销不生成相反命令、重复撤销不复活、取消未来规则、作用域和租户隔离、只读身份与模型自报约束限制、幂等键冲突、旧版本写入拒绝、outbox 同事务回滚、延迟索引与删除、策略和 ACL epoch、未来时间边界、任务 fence 以及接管保留检查点。

参考模型只处理单一作用域，不实现完整继承/例外解析；只接受显式结构化命令。CORRECT 是明确纠错，未来替换 REPLACE 尚未实现，不可借该结果宣称未来替换的完整产品行为已测试。

## 运行方式

在本目录运行 Python 3 的标准库脚本，不需要安装大模型或第三方数据库服务：

~~~powershell
python test_reference.py
~~~

当前工作站可使用已配置的 bundled Python 完整路径运行相同脚本。测试只在临时目录建库，不读取或改写真实用户记忆。生成的结果会更新本目录 results.json。

契约文件可以通过以下脚本重新生成：

~~~powershell
python build_contracts.py
~~~

契约检查包括 JSON 生成、内部引用和样例基本字段；不是完整 OpenAPI 合规验证。接口文件没有启动 HTTP/MCP 服务。

## 尚未验证

- LLM intent accuracy
- embedding recall
- HTTP/MCP
- scope inheritance and exception resolution
- complete context compilation and receipt authenticity
- future replacement
- real action dispatch
- full erasure/backups
- power-loss durability
- production concurrency/performance
- academic novelty

完整验收方法见 [创新与评测](../04-创新定位与评测方案.md)，真实接入步骤见 [实施路线](../05-实施路线与决策记录.md)。
