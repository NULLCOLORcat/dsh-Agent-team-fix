# dsh-Smarter-Subagent-level

为 DSH 原生子智能体选模增加「困难任务模型」建议。主会话可以按任务难度自主决定是否选模、选哪个模型；如果官方白名单已授权，也可以为子智能体选择比主会话更适合处理难题的模型。

插件不设置固定等级，不改变官方授权，不接管默认路由。没有指定模型时，仍由 DSH 按原生规则处理。

## 举个例子

主会话使用 GPT-6.2-Sol，在官方白名单中允许 GPT-6.1-Terra 和 GPT-6.2-Astra，并把 Astra 勾选为困难任务模型。主会话可以请 Terra 整理资料，请 Astra 排查难题，也可以按实际情况另选白名单中的模型。这里只举例，不限定模型或供应商。

## 使用

1. 进入 **插件 → 内置插件配置 → 子智能体**。
2. 在上方「模型选择」中开启选模，勾选**总授权名单**，点击官方表单的「保存」。
3. 在同一页下方勾选要推荐给困难任务的模型，点击「保存困难任务模型」。这份名单可留空；当前会话没有符合授权的困难候选时，插件不会提供难度建议。

> 官方白名单仍授权两组模型，未标为困难候选的模型也可按需选择。DSH 0.2.2-rc.5 记录的是会话创建时的授权。修改官方白名单后，请新建会话再试；插件不会扩大旧会话的权限。

<details>
<summary>安装与升级</summary>

**适用宿主：DSH 0.2.2-rc.5。** 不要强行放行未声明兼容的宿主版本。

- **npm 安装（推荐）：** 在 DSH 的插件安装界面，输入 `dsh-agent-team-fix`。请确认安装版本为 **0.4.0**；旧版行为不同。查看 [npm 版本](https://www.npmjs.com/package/dsh-agent-team-fix)。
- **从 GitHub 安装：** 在同一界面输入 `https://github.com/NULLCOLORcat/dsh-Smarter-Subagent-level`，或运行 `dsh plugin --profile web add github:NULLCOLORcat/dsh-Smarter-Subagent-level`。
- **本地验证：** 运行 `npm pack --ignore-scripts`，再从 DSH 插件管理器指定生成的包。升级前保留原版以便回滚，不要同时启用旧版路由器。
- **从 0.3.x 升级：** 展示名改为 **Smarter-Subagent-level**，包名不变，保留已保存的 `smartModels`。旧版日常名单、默认模型、默认推理与回退开关不再生效，也不会写入官方设置。旧困难名单中的未授权模型不参与推荐，可在设置页移除。

</details>

<details>
<summary>行为边界与开发</summary>

- 难度是给主会话的选模建议，不是模型评分。插件不要求某个难度一定用某个模型，也不保证降低成本或改善任务结果。
- 推荐不会放行服务商不可用的模型、对团队模式另设规则，或影响已创建的子智能体。实际可用的创建工具、选模、推理强度及拒绝行为由 DSH 和服务商决定。
- `npm test` 运行测试；`npm pack --dry-run` 检查安装包内容。参见[包清单](./package.json)和[发布与市场收录步骤](./docs/PUBLISHING.zh-CN.md)。

</details>

本项目采用 [MIT 许可证](./LICENSE)。
