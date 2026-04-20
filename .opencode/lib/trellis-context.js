/**
 * Trellis Context Manager
 *
 * Utility class for OpenCode plugins providing project detection,
 * file reading, and JSONL reference parsing capabilities.
 */

import { existsSync, readFileSync, appendFileSync } from "fs"
import { isAbsolute, join } from "path"
import { platform } from "os"
import { execSync } from "child_process"

const PYTHON_CMD = platform() === "win32" ? "python" : "python3"
// Debug logging
const DEBUG_LOG = "/tmp/trellis-plugin-debug.log"

function debugLog(prefix, ...args) {
  const timestamp = new Date().toISOString()
  const msg = `[${timestamp}] [${prefix}] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(" ")}\n`
  try {
    appendFileSync(DEBUG_LOG, msg)
  } catch {
    // ignore
  }
}

/**
 * Trellis Context Manager
 */
export class TrellisContext {
  constructor(directory) {
    this.directory = directory
    debugLog("context", "TrellisContext initialized", { directory })
  }

  // ============================================================
  // Trellis Project Detection
  // ============================================================

  isTrellisProject() {
    return existsSync(join(this.directory, ".trellis"))
  }

  /**
   * Get current task directory from .trellis/.current-task
   */
  getCurrentTask() {
    try {
      const currentTaskPath = join(this.directory, ".trellis", ".current-task")
      if (!existsSync(currentTaskPath)) {
        return null
      }
      const taskRef = readFileSync(currentTaskPath, "utf-8").trim()
      const normalized = this.normalizeTaskRef(taskRef)
      return normalized || null
    } catch {
      return null
    }
  }

  normalizeTaskRef(taskRef) {
    if (!taskRef) {
      return ""
    }

    if (isAbsolute(taskRef)) {
      return taskRef.trim()
    }

    let normalized = taskRef.trim().replace(/\\/g, "/")
    while (normalized.startsWith("./")) {
      normalized = normalized.slice(2)
    }

    if (normalized.startsWith("tasks/")) {
      return `.trellis/${normalized}`
    }

    return normalized
  }

  resolveTaskDir(taskRef) {
    const normalized = this.normalizeTaskRef(taskRef)
    if (!normalized) {
      return null
    }

    if (isAbsolute(normalized)) {
      return normalized
    }

    if (normalized.startsWith(".trellis/")) {
      return join(this.directory, normalized)
    }

    return join(this.directory, ".trellis", "tasks", normalized)
  }

  // ============================================================
  // File Reading Utilities
  // ============================================================

  readFile(filePath) {
    try {
      if (existsSync(filePath)) {
        return readFileSync(filePath, "utf-8")
      }
    } catch {
      // Ignore read errors
    }
    return null
  }

  readProjectFile(relativePath) {
    return this.readFile(join(this.directory, relativePath))
  }

  runScript(scriptPath, cwd = null) {
    try {
      const result = execSync(`${PYTHON_CMD} "${scriptPath}"`, {
        cwd: cwd || this.directory,
        timeout: 10000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      })
      return result || ""
    } catch {
      return ""
    }
  }

  readJsonlEntries(jsonlPath) {
    const results = []
    const fullJsonlPath = isAbsolute(jsonlPath)
      ? jsonlPath
      : join(this.directory, jsonlPath)
    const content = this.readFile(fullJsonlPath)
    if (!content) return results

    for (const line of content.split("\n")) {
      if (!line.trim()) continue
      try {
        const item = JSON.parse(line)
        const file = item.file || item.path
        const entryType = item.type === "directory" ? "directory" : "file"
        const reason = typeof item.reason === "string" ? item.reason.trim() : ""

        if (!file) continue

        const fullPath = join(this.directory, file)
        if (existsSync(fullPath)) {
          results.push({ path: file, type: entryType, reason })
        }
      } catch {
        // Ignore parse errors for individual lines
      }
    }
    return results
  }
}

// ============================================================
// Context Collector (for session deduplication)
// ============================================================

class ContextCollector {
  constructor() {
    this.processed = new Set()
  }

  markProcessed(sessionID) {
    this.processed.add(sessionID)
  }

  isProcessed(sessionID) {
    return this.processed.has(sessionID)
  }

  clear(sessionID) {
    this.processed.delete(sessionID)
  }
}

// Singleton instance
export const contextCollector = new ContextCollector()

// Export debug log for plugins
export { debugLog }
