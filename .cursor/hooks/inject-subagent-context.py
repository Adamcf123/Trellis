#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Multi-Platform Sub-Agent Context Injection Hook

Injects task-specific context when sub-agents (implement, check, research) are spawned.

Core Design Philosophy:
- Hook injects full task documents plus ordered JSONL references
- Each agent has a dedicated jsonl file defining its reference list
- No resume needed, no segmentation, behavior controlled by code not prompt

Trigger: PreToolUse (before Task tool call)

Context Source: .trellis/.current-task points to task directory
- implement.jsonl - Implement agent dedicated context
- check.jsonl     - Check agent dedicated context
- prd.md          - Requirements document
- info.md         - Technical design
- codex-review-output.txt - Code Review results
"""

# IMPORTANT: Suppress all warnings FIRST
import warnings
warnings.filterwarnings("ignore")

import json
import os
import sys
from pathlib import Path

# IMPORTANT: Force stdout to use UTF-8 on Windows
# This fixes UnicodeEncodeError when outputting non-ASCII characters
if sys.platform == "win32":
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(sys.stdout.detach(), encoding="utf-8", errors="replace")  # type: ignore[union-attr]


# =============================================================================
# Path Constants (change here to rename directories)
# =============================================================================

DIR_WORKFLOW = ".trellis"
DIR_SPEC = "spec"
FILE_CURRENT_TASK = ".current-task"
FILE_TASK_JSON = "task.json"

# =============================================================================
# Subagent Constants (change here to rename subagent types)
# =============================================================================

AGENT_IMPLEMENT = "implement"
AGENT_CHECK = "check"
AGENT_RESEARCH = "research"

# Agents that require a task directory
AGENTS_REQUIRE_TASK = (AGENT_IMPLEMENT, AGENT_CHECK)
# All supported agents
AGENTS_ALL = (AGENT_IMPLEMENT, AGENT_CHECK, AGENT_RESEARCH)


def find_repo_root(start_path: str) -> str | None:
    """
    Find git repo root from start_path upwards

    Returns:
        Repo root path, or None if not found
    """
    current = Path(start_path).resolve()
    while current != current.parent:
        if (current / ".git").exists():
            return str(current)
        current = current.parent
    return None


def get_current_task(repo_root: str) -> str | None:
    """
    Read current task directory path from .trellis/.current-task

    Returns:
        Task directory relative path (relative to repo_root)
        None if not set
    """
    current_task_file = os.path.join(repo_root, DIR_WORKFLOW, FILE_CURRENT_TASK)
    if not os.path.exists(current_task_file):
        return None

    try:
        with open(current_task_file, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if not content:
                return None
            normalized = content.replace("\\", "/")
            while normalized.startswith("./"):
                normalized = normalized[2:]
            if normalized.startswith("tasks/"):
                normalized = f".trellis/{normalized}"
            return normalized
    except Exception:
        return None


def read_file_content(base_path: str, file_path: str) -> str | None:
    """Read file content, return None if file doesn't exist"""
    full_path = os.path.join(base_path, file_path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            return None
    return None


def read_jsonl_references(base_path: str, jsonl_path: str) -> list[dict[str, str]]:
    """Read JSONL context entries as ordered references only."""
    full_path = os.path.join(base_path, jsonl_path)
    if not os.path.exists(full_path):
        return []

    results: list[dict[str, str]] = []
    try:
        with open(full_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                    file_path = item.get("file") or item.get("path")
                    entry_type = "directory" if item.get("type") == "directory" else "file"
                    reason = item.get("reason")

                    if not file_path:
                        continue

                    full_entry_path = os.path.join(base_path, file_path)
                    if not os.path.exists(full_entry_path):
                        continue

                    results.append(
                        {
                            "path": file_path,
                            "type": entry_type,
                            "reason": reason.strip() if isinstance(reason, str) else "",
                        }
                    )
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass

    return results


def dedupe_references(entries: list[dict[str, str]]) -> list[dict[str, str]]:
    """Deduplicate references by path while preserving first occurrence order."""
    seen: set[str] = set()
    deduped: list[dict[str, str]] = []

    for entry in entries:
        entry_path = entry["path"]
        if entry_path in seen:
            continue
        seen.add(entry_path)
        deduped.append(entry)

    return deduped


def build_references_block(title: str, entries: list[dict[str, str]]) -> dict | None:
    """Create a references block when entries are present."""
    deduped = dedupe_references(entries)
    if not deduped:
        return None

    return {"kind": "references", "title": title, "entries": deduped}


def build_document_block(title: str, path: str, content: str | None) -> dict | None:
    """Create a full document block when content is present."""
    if not content:
        return None

    return {"kind": "document", "title": title, "path": path, "content": content}


def render_context_blocks(blocks: list[dict | None]) -> str:
    """Render context blocks into prompt text."""
    rendered: list[str] = []

    for block in blocks:
        if not block:
            continue

        if block["kind"] == "document":
            rendered.append(f"=== {block['path']} ({block['title']}) ===\n{block['content']}")
            continue

        lines = [
            f"## {block['title']}",
            "",
            "Read these files on demand before changing related code. They are references only; full contents are not preloaded.",
            "",
        ]
        for entry in block["entries"]:
            reason = entry.get("reason", "")
            if reason:
                lines.append(f"- `{entry['path']}` - {reason}")
            else:
                lines.append(f"- `{entry['path']}`")

        rendered.append("\n".join(lines))

    return "\n\n".join(rendered)


def get_implement_context(repo_root: str, task_dir: str) -> str:
    """
    Complete context for Implement Agent

    Read order:
    1. Ordered references from implement.jsonl
    2. prd.md (requirements)
    3. info.md (technical design)
    """
    return render_context_blocks(
        [
            build_references_block(
                "Relevant References",
                read_jsonl_references(repo_root, f"{task_dir}/implement.jsonl"),
            ),
            build_document_block(
                "Requirements",
                f"{task_dir}/prd.md",
                read_file_content(repo_root, f"{task_dir}/prd.md"),
            ),
            build_document_block(
                "Technical Design",
                f"{task_dir}/info.md",
                read_file_content(repo_root, f"{task_dir}/info.md"),
            ),
        ]
    )


def get_check_context(repo_root: str, task_dir: str) -> str:
    """
    Context for Check Agent: check.jsonl + prd.md
    """
    return render_context_blocks(
        [
            build_references_block(
                "Relevant References",
                read_jsonl_references(repo_root, f"{task_dir}/check.jsonl"),
            ),
            build_document_block(
                "Requirements",
                f"{task_dir}/prd.md",
                read_file_content(repo_root, f"{task_dir}/prd.md"),
            ),
        ]
    )


def get_finish_context(repo_root: str, task_dir: str) -> str:
    """
    Context for Finish phase: reuses check.jsonl + prd.md
    (Finish is a final check, same context source.)
    """
    return get_check_context(repo_root, task_dir)



def build_implement_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Implement"""
    return f"""# Implement Agent Task

You are the Implement Agent in the Multi-Agent Pipeline.

## Your Context

Task documents are included below. Referenced files are listed separately and must be read on demand:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Understand references** - Relevant spec/code paths are listed above; read what you need on demand
2. **Understand requirements** - Read requirements document and technical design
3. **Implement feature** - Implement following specs and design
4. **Self-check** - Ensure code quality against check specs

## Important Constraints

- Do NOT execute git commit, only code modifications
- Referenced files are NOT preloaded in full; read the relevant files before changing code
- Report list of modified/created files when done"""


def build_check_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Check"""
    return f"""# Check Agent Task

You are the Check Agent in the Multi-Agent Pipeline (code and cross-layer checker).

## Your Context

Task documents are included below. Referenced files are listed separately and must be read on demand:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Get changes** - Run `git diff --name-only` and `git diff` to get code changes
2. **Check against references** - Read the relevant referenced files and verify item by item
3. **Self-fix** - Fix issues directly, don't just report
4. **Run verification** - Run project's lint and typecheck commands

## Important Constraints

- Fix issues yourself, don't just report
- Must execute complete checklist in check specs
- Referenced files are NOT preloaded in full; read the relevant files before checking changes
- Pay special attention to impact radius analysis (L1-L5)"""


def build_finish_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Finish (final check before PR)"""
    return f"""# Finish Agent Task

You are performing the final check before creating a PR.

## Your Context

Task documents are included below. Referenced files are listed separately and must be read on demand:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Review changes** - Run `git diff --name-only` to see all changed files
2. **Verify requirements** - Check each requirement in prd.md is implemented
3. **Spec sync** - Analyze whether changes introduce new patterns, contracts, or conventions
   - If new pattern/convention found: read target spec file → update it → update index.md if needed
   - If infra/cross-layer change: follow the 7-section mandatory template from update-spec.md
   - If pure code fix with no new patterns: skip this step
4. **Run final checks** - Execute lint and typecheck
5. **Confirm ready** - Ensure code is ready for PR

## Important Constraints

- You MAY update spec files when gaps are detected (use update-spec.md as guide)
- MUST read the target spec file BEFORE editing (avoid duplicating existing content)
- Do NOT update specs for trivial changes (typos, formatting, obvious fixes)
- If critical CODE issues found, report them clearly (fix specs, not code)
- Verify all acceptance criteria in prd.md are met
- Referenced files are NOT preloaded in full; read the relevant files before verifying behavior"""



def get_research_context(repo_root: str, task_dir: str | None) -> str:
    """
    Context for Research Agent — project structure overview for spec directories.
    """
    context_parts = []

    # 1. Project structure overview (dynamically discover spec directories)
    spec_path = f"{DIR_WORKFLOW}/{DIR_SPEC}"
    spec_root = Path(repo_root) / DIR_WORKFLOW / DIR_SPEC

    # Build spec tree dynamically
    tree_lines = [f"{spec_path}/"]
    if spec_root.is_dir():
        pkg_dirs = sorted(d for d in spec_root.iterdir() if d.is_dir())
        for i, pkg_dir in enumerate(pkg_dirs):
            is_last = i == len(pkg_dirs) - 1
            prefix = "└── " if is_last else "├── "
            layers = sorted(d.name for d in pkg_dir.iterdir() if d.is_dir())
            layer_info = f" ({', '.join(layers)})" if layers else ""
            tree_lines.append(f"{prefix}{pkg_dir.name}/{layer_info}")

    spec_tree = "\n".join(tree_lines)

    project_structure = f"""## Project Spec Directory Structure

```
{spec_tree}
```

To get structured package info, run: `python3 ./{DIR_WORKFLOW}/scripts/get_context.py --mode packages`

## Search Tips

- Spec files: `{spec_path}/**/*.md`
- Code search: Use Glob and Grep tools
- Tech solutions: Use mcp__exa__web_search_exa or mcp__exa__get_code_context_exa"""

    context_parts.append(project_structure)

    return "\n\n".join(context_parts)


def build_research_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Research"""
    return f"""# Research Agent Task

You are the Research Agent in the Multi-Agent Pipeline (search researcher).

## Core Principle

**You do one thing: find and explain information.**

You are a documenter, not a reviewer.

## Project Info

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Understand query** - Determine search type (internal/external) and scope
2. **Plan search** - List search steps for complex queries
3. **Execute search** - Execute multiple independent searches in parallel
4. **Organize results** - Output structured report

## Search Tools

| Tool | Purpose |
|------|---------|
| Glob | Search by filename pattern |
| Grep | Search by content |
| Read | Read file content |
| mcp__exa__web_search_exa | External web search |
| mcp__exa__get_code_context_exa | External code/doc search |

## Strict Boundaries

**Only allowed**: Describe what exists, where it is, how it works

**Forbidden** (unless explicitly asked):
- Suggest improvements
- Criticize implementation
- Recommend refactoring
- Modify any files

## Report Format

Provide structured search results including:
- List of files found (with paths)
- Code pattern analysis (if applicable)
- Related spec documents
- External references (if any)"""


def _parse_hook_input(input_data: dict) -> tuple[str, str, dict]:
    """Parse hook input across different platform formats.

    Returns (subagent_type, original_prompt, tool_input).
    Handles:
    - Claude Code / Qoder / CodeBuddy / Droid: tool_name=Task|Agent, tool_input.subagent_type
    - Cursor: tool_name=Task, tool_input.subagent_type
    - Copilot CLI: toolName=task (camelCase key, lowercase value)
    - Gemini CLI: tool_name IS the agent name (BeforeTool matcher already filtered)
    - Kiro: agentSpawn hook, agent_name field at top level
    """
    tool_input = input_data.get("tool_input", {})

    # Standard format: Task/Agent tool with subagent_type
    tool_name = input_data.get("tool_name", "") or input_data.get("toolName", "")
    if tool_name.lower() in ("task", "agent"):
        return (
            tool_input.get("subagent_type", ""),
            tool_input.get("prompt", ""),
            tool_input,
        )

    # Kiro: agentSpawn hook passes agent_name at top level
    agent_name = input_data.get("agent_name", "")
    if agent_name:
        return agent_name, tool_input.get("prompt", input_data.get("prompt", "")), tool_input

    # Gemini CLI: BeforeTool where tool_name IS the agent name
    # (matcher already ensured it's one of our agents)
    if tool_name in AGENTS_ALL:
        return tool_name, tool_input.get("prompt", ""), tool_input

    # Copilot CLI: toolName field (camelCase), value might be the agent name
    tool_name_camel = input_data.get("toolName", "")
    if tool_name_camel in AGENTS_ALL:
        return tool_name_camel, input_data.get("toolArgs", ""), tool_input

    return "", "", tool_input


def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    subagent_type, original_prompt, tool_input = _parse_hook_input(input_data)
    cwd = input_data.get("cwd", os.getcwd())

    # Only handle subagent types we care about
    if subagent_type not in AGENTS_ALL:
        sys.exit(0)

    # Find repo root
    repo_root = find_repo_root(cwd)
    if not repo_root:
        sys.exit(0)

    # Get current task directory (research doesn't require it)
    task_dir = get_current_task(repo_root)

    # implement/check need task directory
    if subagent_type in AGENTS_REQUIRE_TASK:
        if not task_dir:
            sys.exit(0)
        # Check if task directory exists
        task_dir_full = os.path.join(repo_root, task_dir)
        if not os.path.exists(task_dir_full):
            sys.exit(0)

    # Check for [finish] marker in prompt (check agent with finish context)
    is_finish_phase = "[finish]" in original_prompt.lower()

    # Get context and build prompt based on subagent type
    if subagent_type == AGENT_IMPLEMENT:
        assert task_dir is not None  # validated above
        context = get_implement_context(repo_root, task_dir)
        new_prompt = build_implement_prompt(original_prompt, context)
    elif subagent_type == AGENT_CHECK:
        assert task_dir is not None  # validated above
        if is_finish_phase:
            # Finish phase: use finish context (lighter, focused on final verification)
            context = get_finish_context(repo_root, task_dir)
            new_prompt = build_finish_prompt(original_prompt, context)
        else:
            # Regular check phase: use check context (full specs for self-fix loop)
            context = get_check_context(repo_root, task_dir)
            new_prompt = build_check_prompt(original_prompt, context)
    elif subagent_type == AGENT_RESEARCH:
        # Research can work without task directory
        context = get_research_context(repo_root, task_dir)
        new_prompt = build_research_prompt(original_prompt, context)
    else:
        sys.exit(0)

    if not context:
        sys.exit(0)

    # Return updated input — use a multi-format output that covers all platforms.
    # Most platforms ignore unrecognized fields, so we include multiple formats.
    # The platform picks whichever fields it understands.
    updated = {**tool_input, "prompt": new_prompt}
    output = {
        # Claude Code / Qoder / CodeBuddy / Droid format
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": updated,
        },
        # Cursor format
        "permission": "allow",
        "updated_input": updated,
        # Gemini format
        "updatedInput": updated,
    }

    print(json.dumps(output, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
