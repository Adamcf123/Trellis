/* global process */
/**
 * Trellis Session Start Plugin
 *
 * Injects context when user sends the first message in a session.
 * Uses OpenCode's chat.message hook directly so the context persists in history.
 */

import { existsSync, readFileSync, statSync } from "fs"
import { basename, join } from "path"
import { execFileSync } from "child_process"
import { platform } from "os"
import { TrellisContext, contextCollector, debugLog } from "../lib/trellis-context.js"

const PYTHON_CMD = platform() === "win32" ? "python" : "python3"
const SUBAGENT_TYPES = ["implement", "check", "research"]


/**
 * Check current task status and return structured status string.
 * JavaScript equivalent of _get_task_status in Claude's session-start.py.
 */
function getTaskStatus(ctx) {
  const taskRef = ctx.getCurrentTask()
  if (!taskRef) {
    return "Status: NO ACTIVE TASK\nNext: Describe what you want to work on"
  }

  const taskDir = ctx.resolveTaskDir(taskRef)

  if (!taskDir || !existsSync(taskDir)) {
    return `Status: STALE POINTER\nTask: ${taskRef}\nNext: Task directory not found. Run: python3 ./.trellis/scripts/task.py finish`
  }

  let taskData = {}
  const taskJsonPath = join(taskDir, "task.json")
  if (existsSync(taskJsonPath)) {
    try {
      taskData = JSON.parse(readFileSync(taskJsonPath, "utf-8"))
    } catch {
      // Ignore parse errors
    }
  }

  const taskTitle = taskData.title || taskRef
  const taskStatus = taskData.status || "unknown"

  if (taskStatus === "completed") {
    const dirName = basename(taskDir)
    return `Status: COMPLETED\nTask: ${taskTitle}\nNext: Archive with \`python3 ./.trellis/scripts/task.py archive ${dirName}\` or start a new task`
  }

  let hasContext = false
  for (const jsonlName of ["implement.jsonl", "check.jsonl"]) {
    const jsonlPath = join(taskDir, jsonlName)
    if (existsSync(jsonlPath)) {
      try {
        const st = statSync(jsonlPath)
        if (st.size > 0) {
          hasContext = true
          break
        }
      } catch {
        // Ignore stat errors
      }
    }
  }

  const hasPrd = existsSync(join(taskDir, "prd.md"))

  if (!hasPrd) {
    return `Status: NOT READY\nTask: ${taskTitle}\nMissing: prd.md not created\nNext: Write PRD, then research → init-context → start`
  }

  if (!hasContext) {
    return `Status: NOT READY\nTask: ${taskTitle}\nMissing: Context not configured (no jsonl files)\nNext: Complete Phase 2 (research → init-context → start) before implementing`
  }

  return `Status: READY\nTask: ${taskTitle}\nNext: Continue with implement or check`
}

/**
 * Load Trellis config for session-start decisions.
 * Calls get_context.py --mode packages --json for reliable config data.
 */
function loadTrellisConfig(directory) {
  const scriptPath = join(directory, ".trellis", "scripts", "get_context.py")
  if (!existsSync(scriptPath)) {
    return { isMonorepo: false, packages: {}, specScope: null, activeTaskPackage: null, defaultPackage: null }
  }
  try {
    const output = execFileSync(PYTHON_CMD, [scriptPath, "--mode", "packages", "--json"], {
      cwd: directory,
      timeout: 5000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    const data = JSON.parse(output)
    if (data.mode !== "monorepo") {
      return { isMonorepo: false, packages: {}, specScope: null, activeTaskPackage: null, defaultPackage: null }
    }
    const pkgDict = {}
    for (const pkg of (data.packages || [])) {
      pkgDict[pkg.name] = pkg
    }
    return {
      isMonorepo: true,
      packages: pkgDict,
      specScope: data.specScope || null,
      activeTaskPackage: data.activeTaskPackage || null,
      defaultPackage: data.defaultPackage || null,
    }
  } catch (e) {
    debugLog("session", "loadTrellisConfig error:", e.message)
    return { isMonorepo: false, packages: {}, specScope: null, activeTaskPackage: null, defaultPackage: null }
  }
}


/**
 * Check for legacy spec directory structure in monorepo.
 */
function checkLegacySpec(directory, config) {
  if (!config.isMonorepo || Object.keys(config.packages).length === 0) {
    return null
  }

  const specDir = join(directory, ".trellis", "spec")
  if (!existsSync(specDir)) return null

  let hasLegacy = false
  for (const name of ["backend", "frontend"]) {
    if (existsSync(join(specDir, name, "index.md"))) {
      hasLegacy = true
      break
    }
  }
  if (!hasLegacy) return null

  const pkgNames = Object.keys(config.packages).sort()
  const missing = pkgNames.filter(name => !existsSync(join(specDir, name)))

  if (missing.length === 0) return null

  if (missing.length === pkgNames.length) {
    return (
      `[!] Legacy spec structure detected: found \`spec/backend/\` or \`spec/frontend/\` ` +
      `but no package-scoped \`spec/<package>/\` directories.\n` +
      `Monorepo packages: ${pkgNames.join(", ")}\n` +
      `Please reorganize: \`spec/backend/\` -> \`spec/<package>/backend/\``
    )
  }
  return (
    `[!] Partial spec migration detected: packages ${missing.join(", ")} ` +
    `still missing \`spec/<pkg>/\` directory.\n` +
    `Please complete migration for all packages.`
  )
}


/**
 * Build session context for injection.
 *
 * All injected content is wrapped in a single <trellis-context> block.
 * The text OUTSIDE this block is the user's first message.
 *
 * We inject ONLY:
 *   - Project state summary (git, tasks)
 *   - Current task status
 *   - Imperative next-action instruction
 *
 * Workflow guide and spec guidelines are NOT injected here — they are
 * too long for session-start. The agent should read them on demand via
 * the per-turn workflow-state breadcrumb or by reading files directly.
 */
function buildSessionContext(ctx) {
  const directory = ctx.directory
  const trellisDir = join(directory, ".trellis")

  const parts = []

  // Header — imperative voice, clearly states that content outside the tag
  // is the user's first message.
  parts.push(`<trellis-context>
You are an AI assistant working in a Trellis-managed project.
The text OUTSIDE this XML block is the user's first message to you.
`)

  // Legacy migration warning (brief, inline)
  const config = loadTrellisConfig(directory)
  const legacyWarning = checkLegacySpec(directory, config)
  if (legacyWarning) {
    parts.push(`## Migration Warning
${legacyWarning}
`)
  }

  // Project state — dynamic data from get_context.py
  const contextScript = join(trellisDir, "scripts", "get_context.py")
  if (existsSync(contextScript)) {
    const output = ctx.runScript(contextScript)
    if (output) {
      parts.push("## Project State")
      parts.push(output)
      parts.push("")
    }
  }

  // Task status + imperative next action
  const taskStatus = getTaskStatus(ctx)
  parts.push("## Task Status")
  parts.push(taskStatus)
  parts.push("")

  // Imperative instruction based on status
  const statusLower = taskStatus.toLowerCase()
  if (statusLower.includes("no active task")) {
    parts.push(
      "Wait for the user's message. " +
      "If they describe multi-step work, load the trellis-brainstorm skill " +
      "to clarify requirements and create a task. " +
      "For simple one-off questions or trivial edits, answer directly."
    )
  } else if (statusLower.includes("stale pointer")) {
    parts.push(
      "The current task pointer is stale. " +
      "Ask the user whether to archive the old task or start a new one."
    )
  } else if (statusLower.includes("not ready")) {
    parts.push(
      "The active task is not ready for implementation. " +
      "Guide the user through Phase 1: complete the PRD, then run init-context."
    )
  } else if (statusLower.includes("completed")) {
    parts.push(
      "The active task is completed. " +
      "Ask the user whether to archive it or start a new task."
    )
  } else {
    parts.push(
      "An active task is ready. " +
      "Check conversation history and git status to determine the current step, " +
      "then continue implementing. Do NOT skip the check step."
    )
  }

  parts.push("</trellis-context>")

  return parts.join("\n")
}

function getTrellisMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return {}
  }

  const trellis = metadata.trellis
  if (!trellis || typeof trellis !== "object") {
    return {}
  }

  return trellis
}

function markPartAsSessionStart(part) {
  const metadata = part.metadata && typeof part.metadata === "object"
    ? part.metadata
    : {}
  part.metadata = {
    ...metadata,
    trellis: {
      ...getTrellisMetadata(metadata),
      sessionStart: true,
    },
  }
}

function hasSessionStartMarker(part) {
  if (!part || part.type !== "text" || typeof part.text !== "string") {
    return false
  }

  return getTrellisMetadata(part.metadata).sessionStart === true
}

export function hasInjectedTrellisContext(messages) {
  if (!Array.isArray(messages)) {
    return false
  }

  return messages.some(message => {
    if (!message?.info || message.info.role !== "user" || !Array.isArray(message.parts)) {
      return false
    }

    return message.parts.some(hasSessionStartMarker)
  })
}

async function hasPersistedInjectedContext(client, directory, sessionID) {
  try {
    const response = await client.session.messages({
      path: { id: sessionID },
      query: { directory },
      throwOnError: true,
    })
    return hasInjectedTrellisContext(response.data || [])
  } catch (error) {
    debugLog(
      "session",
      "Failed to read session history for dedupe:",
      error instanceof Error ? error.message : String(error),
    )
    return false
  }
}

export default {
  id: "trellis.session-start",
  server: async ({ directory, client }) => {
    const ctx = new TrellisContext(directory)
    debugLog("session", "Plugin loaded, directory:", directory)

    return {
      // Clear in-memory dedupe after compaction so context can be re-injected.
      event: ({ event }) => {
        try {
          if (event?.type === "session.compacted" && event?.properties?.sessionID) {
            const sessionID = event.properties.sessionID
            contextCollector.clear(sessionID)
            debugLog("session", "Cleared processed flag after compaction for session:", sessionID)
          }
        } catch (error) {
          debugLog(
            "session",
            "Error in event hook:",
            error instanceof Error ? error.message : String(error),
          )
        }
      },

      // chat.message - triggered when user sends a message.
      // Modify the message in-place so the context is persisted with updateMessage/updatePart.
      "chat.message": async (input, output) => {
        try {
          const sessionID = input.sessionID
          const agent = input.agent || "unknown"
          debugLog("session", "chat.message called, sessionID:", sessionID, "agent:", agent)

          if (SUBAGENT_TYPES.includes(agent)) {
            debugLog("session", "Skipping - subagent session")
            return
          }

          // Skip in non-interactive mode
          if (process.env.OPENCODE_NON_INTERACTIVE === "1") {
            debugLog("session", "Skipping - non-interactive mode")
            return
          }

          // Only inject on first message
          if (contextCollector.isProcessed(sessionID)) {
            // Memory says processed, but undo may have deleted the injected
            // message. Verify persisted state is still valid before skipping.
            if (await hasPersistedInjectedContext(client, ctx.directory, sessionID)) {
              debugLog("session", "Skipping - session already processed and persisted")
              return
            }
            contextCollector.clear(sessionID)
            debugLog("session", "Cleared processed flag - persisted context missing (likely undo)")
          }

          if (await hasPersistedInjectedContext(client, ctx.directory, sessionID)) {
            contextCollector.markProcessed(sessionID)
            debugLog("session", "Skipping - session already contains persisted Trellis context")
            return
          }

          // Build context
          const context = buildSessionContext(ctx)
          debugLog("session", "Built context, length:", context.length)

          // Inject context directly into output.parts so it gets persisted by updatePart
          const parts = output?.parts || []
          const textPartIndex = parts.findIndex(
            p => p.type === "text" && p.text !== undefined
          )

          if (textPartIndex !== -1) {
            const originalText = parts[textPartIndex].text || ""
            parts[textPartIndex].text = `${context}\n\n---\n\n${originalText}`
            markPartAsSessionStart(parts[textPartIndex])
            debugLog("session", "Injected context into chat.message text part, length:", context.length)
          } else {
            // No existing text part: prepend a new one
            const injectedPart = { type: "text", text: context }
            markPartAsSessionStart(injectedPart)
            parts.unshift(injectedPart)
            debugLog("session", "Prepended new text part with context, length:", context.length)
          }

          contextCollector.markProcessed(sessionID)

        } catch (error) {
          debugLog("session", "Error in chat.message:", error.message, error.stack)
        }
      }
    }
  }
}
