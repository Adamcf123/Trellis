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

补充：在非交互终端里直接执行 `trellis update` 会因为无法确认更新而报错；默认使用 `trellis update --yes`。
