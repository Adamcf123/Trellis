import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contextCollector, TrellisContext } from "../../src/templates/opencode/lib/trellis-context.js";
import {
  buildPrompt,
  getImplementContext,
} from "../../src/templates/opencode/plugins/inject-subagent-context.js";
import { hasInjectedTrellisContext } from "../../src/templates/opencode/plugins/session-start.js";

interface TestContextCollector {
  processed: Set<string>;
  markProcessed(directory: string, sessionID: string): void;
  isProcessed(directory: string, sessionID: string): boolean;
  clear(directory: string, sessionID: string): void;
}

describe("opencode session context dedupe", () => {
  let collector: TestContextCollector;

  beforeEach((): void => {
    collector = contextCollector as TestContextCollector;
  });

  afterEach((): void => {
    collector.clear("session-a");
    collector.clear("session-b");
    collector.processed.clear();
  });

  it("tracks processed sessions in memory for the active process", () => {
    expect(collector.isProcessed("session-a")).toBe(false);

    collector.markProcessed("session-a");
    expect(collector.isProcessed("session-a")).toBe(true);

    collector.clear("session-a");

    expect(collector.isProcessed("session-a")).toBe(false);
  });

  it("does not treat a different session id as already processed", () => {
    collector.markProcessed("session-a");

    expect(collector.isProcessed("session-b")).toBe(false);
  });
});

describe("opencode session-start history detection", () => {
  it("detects persisted Trellis context from metadata", () => {
    const messages = [
      {
        info: { role: "user" },
        parts: [
          {
            type: "text",
            text: "hello",
            metadata: {
              trellis: {
                sessionStart: true,
              },
            },
          },
        ],
      },
    ];

    expect(hasInjectedTrellisContext(messages)).toBe(true);
  });

  it("ignores unrelated user messages", () => {
    const messages = [
      {
        info: { role: "user" },
        parts: [
          {
            type: "text",
            text: "normal prompt",
          },
        ],
      },
    ];

    expect(hasInjectedTrellisContext(messages)).toBe(false);
  });
});

describe("opencode subagent context injection", () => {
  let tmpDir: string;

  beforeEach((): void => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-opencode-"));
  });

  afterEach((): void => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeProjectFile(relativePath: string, content: string): void {
    const absPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf-8");
  }

  it("renders JSONL references without inlining file bodies", () => {
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "implement.jsonl"),
      [
        '{"file":"src/example.ts","reason":"runtime regression"}',
        '{"file":"src/example.ts","reason":"duplicate should be ignored"}',
        '{"file":"docs/specs/","type":"directory","reason":"spec directory"}',
        '{"file":"src/no-reason.ts"}',
      ].join("\n"),
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "prd.md"),
      "# PRD\nPRD_CANARY\n",
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "info.md"),
      "# Info\nINFO_CANARY\n",
    );
    writeProjectFile(path.join("src", "example.ts"), "SPEC_CANARY_BODY\n");
    writeProjectFile(path.join("src", "no-reason.ts"), "NO_REASON_BODY\n");
    writeProjectFile(path.join("docs", "specs", "guide.md"), "GUIDE_BODY\n");

    const ctx = new TrellisContext(tmpDir);
    const context = getImplementContext(ctx, ".trellis/tasks/issue-106");
    const prompt = buildPrompt("implement", "do work", context);

    expect(context).toContain("## Relevant References");
    expect(context).toContain("`src/example.ts` - runtime regression");
    expect((context.match(/`src\/example\.ts`/g) ?? []).length).toBe(1);
    expect(context).toContain("`docs/specs/` - spec directory");
    expect(context).toContain("`src/no-reason.ts`");
    expect(context).not.toContain("No reason provided");
    expect(context).not.toContain("SPEC_CANARY_BODY");
    expect(context).not.toContain("NO_REASON_BODY");
    expect(context).not.toContain("GUIDE_BODY");
    expect(context).not.toContain("docs/specs/guide.md");
    expect(context).toContain("PRD_CANARY");
    expect(context).toContain("INFO_CANARY");

    expect(prompt).toContain("Referenced files are NOT preloaded in full");
    expect(prompt).not.toContain("All dev specs are injected above");
  });
});
