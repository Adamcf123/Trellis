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

## Trellis 源码更新后的应用方式

修改 Trellis 源代码后，不要直接去改目标 repo 里的 `.trellis/`、`.codex/`、`.agents/` 等生成物。正确动作是：先重新构建 CLI，再更新全局命令，然后在目标 repo 中执行 `trellis update`。

标准流程如下：

```bash
# 1. 在 Trellis 源码仓库中重新构建
pnpm build

# 2. 把当前源码安装到全局
npm install -g /home/adam/projects/Hello-Adam/github-base-repos/Trellis/packages/cli

# 3. 确认全局命令已指向最新安装
command -v trellis
trellis --version

# 4. 在目标 repo 中应用更新
trellis update
```

<!-- FIND-DIFFERENCES:START -->
## Inferred Editing Principles

The user's edits favor radical compression. They keep the top-level structure, then strip most procedure, examples, fallback handling, and judgment criteria. The document shifts from an operating manual toward a lightweight prompt scaffold.

At a high level, the user prefers short directives over full specification, fewer explicit constraints, and just enough structure to keep the skill recognizable.

At a low level, the user repeatedly deletes qualifiers, exceptions, examples, schema-like output sections, and whole explanatory blocks. They collapse detailed lists into short headings and reduce templates to minimal markers.

The user is likely optimizing for scanability, lower prompt weight, and less over-steering. The edits also suggest an assumption that the model can reconstruct missing tactics without explicit step-by-step guidance.
<!-- FIND-DIFFERENCES:END -->
