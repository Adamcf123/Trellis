function dedupeReferences(entries) {
  const seen = new Set()
  const results = []

  for (const entry of entries) {
    if (seen.has(entry.path)) {
      continue
    }
    seen.add(entry.path)
    results.push(entry)
  }

  return results
}

function createReferencesBlock(title, entries) {
  const deduped = dedupeReferences(entries)
  if (deduped.length === 0) {
    return null
  }

  return {
    kind: "references",
    title,
    entries: deduped,
  }
}

function createDocumentBlock(title, path, content) {
  if (!content) {
    return null
  }

  return {
    kind: "document",
    title,
    path,
    content,
  }
}

function renderReferenceEntry(entry) {
  return entry.reason
    ? `- \`${entry.path}\` - ${entry.reason}`
    : `- \`${entry.path}\``
}

export function renderContextBlocks(blocks) {
  return blocks
    .filter(Boolean)
    .map(block => {
      if (block.kind === "document") {
        return `=== ${block.path} (${block.title}) ===\n${block.content}`
      }

      return [
        `## ${block.title}`,
        "",
        "Read these files on demand before changing related code. They are references only; full contents are not preloaded.",
        "",
        ...block.entries.map(renderReferenceEntry),
      ].join("\n")
    })
    .join("\n\n")
}

export function buildImplementContextBlocks(ctx, taskDir) {
  return [
    createReferencesBlock(
      "Relevant References",
      ctx.readJsonlEntries(joinPath(taskDir, "implement.jsonl")),
    ),
    createDocumentBlock(
      "Requirements",
      joinPath(taskDir, "prd.md"),
      ctx.readProjectFile(joinPath(taskDir, "prd.md")),
    ),
    createDocumentBlock(
      "Technical Design",
      joinPath(taskDir, "info.md"),
      ctx.readProjectFile(joinPath(taskDir, "info.md")),
    ),
  ].filter(Boolean)
}

export function buildCheckContextBlocks(ctx, taskDir) {
  return [
    createReferencesBlock(
      "Relevant References",
      ctx.readJsonlEntries(joinPath(taskDir, "check.jsonl")),
    ),
    createDocumentBlock(
      "Requirements",
      joinPath(taskDir, "prd.md"),
      ctx.readProjectFile(joinPath(taskDir, "prd.md")),
    ),
  ].filter(Boolean)
}

function joinPath(taskDir, filename) {
  return `${taskDir}/${filename}`
}
