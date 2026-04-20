<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

Use the `/trellis:start` command when starting a new session to:
- Initialize your developer identity
- Understand current project context
- Read relevant guidelines

Use `@/.trellis/` to learn:
- Development workflow (`workflow.md`)
- Project structure guidelines (`structure/`)
- Session traces (`agent-traces/`)

If you're using Codex, project-scoped helpers may also live in:
- `.agents/skills/` for reusable Trellis skills
- `.codex/agents/` for optional custom subagents

Keep this managed block so 'trellis update' can refresh the instructions.

<!-- TRELLIS:END -->

## 使用opencode
repo 里的 `.trellis/`、`.agents/`、`.opencode/` 等是生成物，不是源代码；应当改trellis在repo内的源代码，不要修改生成物；生成物不是插件核心

"\\wsl.localhost\Ubuntu\home\adam\projects\opencode"源代码位置；需要任何资料可搜索

## Trellis 源码更新后的应用方式

修改 Trellis 源代码后，不要直接去改目标 repo 里的 `.trellis/`、`.codex/`、`.agents/`、`.opencode/` 等生成物。正确动作是：先重新构建 CLI，再更新全局命令，然后在目标 repo 中执行 `trellis update`。

这里的“安装到全局”只指安装 `trellis` 这个 CLI 命令本身，不是把 Trellis 生成物装到全局。实际被写入的 `.trellis/`、`.codex/`、`.agents/`、`.opencode/` 仍然只会落到你当前执行 `trellis update` 的项目里。

标准流程如下：

```bash
# 1. 在 Trellis 源码仓库中重新构建
pnpm build

# 2. 把当前源码安装到全局
npm install -g /home/adam/projects/Hello-Adam/github-base-repos/Trellis/packages/cli

# 3. 确认全局命令已指向最新安装
command -v trellis
trellis --version

# 4. 在目标 repo 中应用更新（非交互终端默认带 --yes）
trellis update --yes
```

<!-- FIND-DIFFERENCES:START -->
这次编辑是在不改主流程的前提下，继续压缩尾部说明。最可能的上一个版本是 `cc1b344` 对应的 `AGENTS.md`，唯一实质差异是删掉了最后那句对非交互终端报错原因的补充解释，只保留命令本身和必要注释。

可以归纳出几个稳定偏好：

1. 优先保留可执行主干，不保留重复解释。命令里已经写明“非交互终端默认带 `--yes`”，后面的补充句就算信息正确，也属于重复。
2. 倾向把文档维持在“拿来就跑”的密度，少讲背景，少讲失败案例，少讲同义复述。
3. 允许读者从上下文自行推出原因，不要求每个操作都显式补足 why；写作重点是动作，不是教学。
4. 对附加说明的容忍度很低。哪怕只多一行，只要不增加新的决策价值，就应删掉。

这说明用户更需要短、硬、可执行的协作约束：先给默认路径，再给最少但完整的命令链；例外和解释只在缺了就会误用时才保留。
<!-- FIND-DIFFERENCES:END -->
