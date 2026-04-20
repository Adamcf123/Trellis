import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { getOpenCodeTemplatePath } from "../templates/extract.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import { resolveCommands, resolveSkills } from "./shared.js";

const EXCLUDE_PATTERNS = [
  ".d.ts",
  ".d.ts.map",
  ".js.map",
  "__pycache__",
  "node_modules",
  "bun.lock",
  ".gitignore",
];

function shouldExclude(filename: string): boolean {
  for (const pattern of EXCLUDE_PATTERNS) {
    if (filename.endsWith(pattern) || filename === pattern) {
      return true;
    }
  }
  return false;
}

async function copyDirFiltered(
  src: string,
  dest: string,
  skipDirs: string[] = [],
): Promise<void> {
  ensureDir(dest);

  for (const entry of readdirSync(src)) {
    if (shouldExclude(entry) || skipDirs.includes(entry)) {
      continue;
    }

    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      await copyDirFiltered(srcPath, destPath);
    } else {
      const content = readFileSync(srcPath, "utf-8");
      await writeFile(destPath, content);
    }
  }
}

function collectDirFiltered(
  src: string,
  destRoot: string,
  files: Map<string, string>,
  skipDirs: string[] = [],
  relativeDir = "",
): void {
  for (const entry of readdirSync(src)) {
    if (shouldExclude(entry) || skipDirs.includes(entry)) {
      continue;
    }

    const srcPath = path.join(src, entry);
    const relativePath = relativeDir ? path.join(relativeDir, entry) : entry;
    const destPath = path.join(destRoot, relativePath).replace(/\\/g, "/");
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      collectDirFiltered(srcPath, destRoot, files, [], relativePath);
      continue;
    }

    files.set(destPath, readFileSync(srcPath, "utf-8"));
  }
}

export function collectOpenCodeTemplates(): Map<string, string> {
  const sourcePath = getOpenCodeTemplatePath();
  const destRoot = ".opencode";
  const ctx = AI_TOOLS.opencode.templateContext;
  const files = new Map<string, string>();

  collectDirFiltered(sourcePath, destRoot, files, ["commands"]);

  for (const cmd of resolveCommands(ctx)) {
    files.set(`.opencode/commands/trellis/${cmd.name}.md`, cmd.content);
  }

  for (const skill of resolveSkills(ctx)) {
    files.set(`.opencode/skills/${skill.name}/SKILL.md`, skill.content);
  }

  return files;
}

/**
 * Configure OpenCode:
 * - agents/, plugins/, lib/, package.json from platform-specific templates
 * - commands/trellis/ from common templates (resolved with OpenCode context)
 */
export async function configureOpenCode(cwd: string): Promise<void> {
  const sourcePath = getOpenCodeTemplatePath();
  const destPath = path.join(cwd, ".opencode");
  const ctx = AI_TOOLS.opencode.templateContext;

  await copyDirFiltered(sourcePath, destPath, ["commands"]);

  // start + finish-work as slash commands
  const commandsDir = path.join(destPath, "commands", "trellis");
  ensureDir(commandsDir);
  for (const cmd of resolveCommands(ctx)) {
    await writeFile(path.join(commandsDir, `${cmd.name}.md`), cmd.content);
  }

  // Other 5 as skills
  const skillsDir = path.join(destPath, "skills");
  ensureDir(skillsDir);
  for (const skill of resolveSkills(ctx)) {
    const skillDir = path.join(skillsDir, skill.name);
    ensureDir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content);
  }
}
