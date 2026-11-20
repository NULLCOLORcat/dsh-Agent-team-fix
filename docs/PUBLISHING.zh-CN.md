# GitHub 发布与 DSH Market 收录

本项目可以从 GitHub 安装；不必先发布 npm。下列 `OWNER` 请替换成有权发布的 GitHub 账号或组织，不是现成的仓库地址。

## 发布自己的仓库

1. 确认仓库名 `dsh-Agent-team-fix`、可见性和许可证。本仓库采用 MIT 许可证，包声明与仓库根目录的许可证正文保持一致。
2. 在专用项目目录运行 `npm test`、`npm pack --dry-run`。检查待提交文件，只包含插件源码、测试、文档和包清单，不提交主机配置、凭据、日志或会话。
3. 在 GitHub 建空仓库，不预生成 README，以本项目为仓库根目录。初始化 `main`，审阅暂存差异后提交，设置 `origin` 为自己的 HTTPS 或 SSH 地址，执行 `git push -u origin main`。不要覆盖已有历史，不把令牌写入仓库 URL。参考 [GitHub 官方说明](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)。
4. 为仓库添加 `dsh-plugin` topic；公开后从干净的兼容 profile 验证 `dsh plugin --profile web add github:OWNER/dsh-Agent-team-fix`。如发 Release，可打相应版本标签、附 `npm pack` 生成的 tgz 并公布校验和。发布仓库、Release、npm、市场投稿是不同操作。

## 申请 dsh-market 收录

[dsh-market 项目](https://github.com/dsh-market/dsh-market#submit-your-plugin)从 [awesome-dsh-plugin 精选目录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)收录。以下按其[贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)整理，提交当日请复核。

1. 确保公开仓库创建已满一天；有真实可用的代码、`dsh-plugin` topic、可安装的 `dsh.bundle` 和对应 patch。本项目是模型路由插件，建议 `category: model`。
2. Fork **精选目录**，新建分支，仅添加 `data/plugins/OWNER__dsh-Agent-team-fix.yml`。不要直接编辑自动生成的 README。

   ```yaml
   url: https://github.com/OWNER/dsh-Agent-team-fix
   name: OWNER/dsh-Agent-team-fix
   category: model
   description:
     en: Routes DSH teammates to daily or difficult-task models with optional inheritance from the lead.
     zh: 为 DSH 团队成员配置日常与困难任务模型，并支持困难任务沿用主窗口模型。
   ```

3. 如确实发布过 GitHub Release，可增加指向该 Release 上 `.tgz` 的 `tarball:`。版本化文件名配固定标签，不要用 `latest/download` 搭配会变化的文件名。
4. 向精选目录的 `main` 提交 PR；等待 CI 检查和维护者人工审阅。若被要求修改，在同一分支修正。合并后站点自动重建，不保证具体上架时间。GitHub 仓库发布不会自动代为提交此 PR。
