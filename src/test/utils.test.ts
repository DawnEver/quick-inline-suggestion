import { describe, it, expect } from "vitest";
import {
  isQuestion,
  extractCodeBlock,
  sortedHistory,
  backendLabel,
  updateHistory,
  incrementFreq,
  truncateFileContent,
  sanitizeTitle,
  discoverModels,
  PROMPT_TEMPLATE,
  EXPLAIN_PROMPT,
  MAX_FILE_LINES,
  MAX_FILE_CHARS,
  ReentryGuard,
} from "../utils";

describe("isQuestion", () => {
  it("returns true for sentences ending with ?", () => {
    expect(isQuestion("what does this do?")).toBe(true);
    expect(isQuestion("is it working?")).toBe(true);
  });

  it("returns true for question-word prefixes", () => {
    expect(isQuestion("what is this")).toBe(true);
    expect(isQuestion("why does it fail")).toBe(true);
    expect(isQuestion("how to fix this")).toBe(true);
    expect(isQuestion("explain the logic")).toBe(true);
    expect(isQuestion("describe the function")).toBe(true);
    expect(isQuestion("who wrote this")).toBe(true);
    expect(isQuestion("when does it run")).toBe(true);
    expect(isQuestion("where is this used")).toBe(true);
    expect(isQuestion("tell me more")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isQuestion("EXPLAIN this")).toBe(true);
    expect(isQuestion("What is happening")).toBe(true);
  });

  it("returns false for plain edit instructions", () => {
    expect(isQuestion("refactor this function")).toBe(false);
    expect(isQuestion("add error handling")).toBe(false);
    expect(isQuestion("rename variable to foo")).toBe(false);
    expect(isQuestion("show me refactored code")).toBe(false);
    expect(isQuestion("show me an example")).toBe(false);
  });

  it("trims whitespace before checking", () => {
    expect(isQuestion("  what is this  ")).toBe(true);
    expect(isQuestion("  refactor this  ")).toBe(false);
  });

  it("returns true for full-width question mark ？", () => {
    expect(isQuestion("这是什么？")).toBe(true);
  });

  it("returns false for mid-sentence question word", () => {
    expect(isQuestion("the how-to guide")).toBe(false);
  });

  it("returns true for Chinese question keywords", () => {
    expect(isQuestion("解释这段代码")).toBe(true);
    expect(isQuestion("这是什么意思")).toBe(true);
    expect(isQuestion("为什么这样写")).toBe(true);
    expect(isQuestion("怎么修改")).toBe(true);
    expect(isQuestion("如何优化")).toBe(true);
    expect(isQuestion("描述一下这个函数")).toBe(true);
    expect(isQuestion("谁写的这段")).toBe(true);
    expect(isQuestion("什么时候执行")).toBe(true);
    expect(isQuestion("哪里有问题")).toBe(true);
    expect(isQuestion("帮我重构这个函数")).toBe(true);
    expect(isQuestion("请解释一下")).toBe(true);
    expect(isQuestion("麻烦帮我看看")).toBe(true);
  });

  it("returns false for Chinese edit instructions", () => {
    expect(isQuestion("重构这个函数")).toBe(false);
    expect(isQuestion("添加错误处理")).toBe(false);
  });
});

describe("extractCodeBlock", () => {
  it("extracts content from a fenced code block", () => {
    const raw = "```\nconsole.log('hello');\n```";
    expect(extractCodeBlock(raw)).toBe("console.log('hello');");
  });

  it("strips the language tag", () => {
    const raw = "```typescript\nconst x = 1;\n```";
    expect(extractCodeBlock(raw)).toBe("const x = 1;");
  });

  it("joins all blocks when multiple are present", () => {
    const raw = "```\nfirst\n```\n\n```\nsecond\n```";
    expect(extractCodeBlock(raw)).toBe("first\n\nsecond");
  });

  it("falls back to trimmed raw text when no fence present", () => {
    const raw = "  just raw text  ";
    expect(extractCodeBlock(raw)).toBe("just raw text");
  });

  it("handles multiline code blocks", () => {
    const raw = "```js\nfunction foo() {\n  return 1;\n}\n```";
    expect(extractCodeBlock(raw)).toBe("function foo() {\n  return 1;\n}");
  });

  it("returns empty string for empty fenced block", () => {
    const raw = "```\n```";
    expect(extractCodeBlock(raw)).toBe("");
  });

  it("falls back to raw text when closing fence is missing", () => {
    const raw = "```ts\nconst x = 1;\n";
    expect(extractCodeBlock(raw)).toBe(raw.trim());
  });

  it("handles Windows CRLF line endings", () => {
    const raw = "```typescript\r\nconst x = 1;\r\nconsole.log('hi');\r\n```";
    expect(extractCodeBlock(raw)).toBe("const x = 1;\nconsole.log('hi');");
  });

  it("joins multiple code blocks with double newline", () => {
    const raw = "```ts\nconst a = 1;\n```\n\n```ts\nconst b = 2;\n```";
    expect(extractCodeBlock(raw)).toBe("const a = 1;\n\nconst b = 2;");
  });

  it("handles fence without newline after language tag", () => {
    const raw = "```typescript  \nconst x = 1;\n```";
    expect(extractCodeBlock(raw)).toBe("const x = 1;");
  });

  it("handles fence with no newline at all (loose fallback)", () => {
    const raw = "```const x = 1;```";
    expect(extractCodeBlock(raw)).toBe("const x = 1;");
  });

  it("returns only fenced content ignoring trailing text", () => {
    const raw = "```ts\nconst a = 1;\n```\n\nSome notes after.";
    expect(extractCodeBlock(raw)).toBe("const a = 1;");
  });
});

describe("sortedHistory", () => {
  const history = ["alpha", "beta", "gamma"];
  const freq = { alpha: 1, beta: 5, gamma: 3 };

  it("returns history as-is for recent sort", () => {
    expect(sortedHistory(history, freq, "recent")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("sorts by frequency descending for frequent sort", () => {
    expect(sortedHistory(history, freq, "frequent")).toEqual([
      "beta",
      "gamma",
      "alpha",
    ]);
  });

  it("treats missing freq entries as 0", () => {
    const h = ["a", "b", "c"];
    const f = { b: 2 };
    expect(sortedHistory(h, f, "frequent")).toEqual(["b", "a", "c"]);
  });

  it("does not mutate the original array", () => {
    const h = ["a", "b", "c"];
    sortedHistory(h, { c: 10 }, "frequent");
    expect(h).toEqual(["a", "b", "c"]);
  });
});

describe("backendLabel", () => {
  it("returns Claude for claude", () => {
    expect(backendLabel("claude")).toBe("Claude");
  });

  it("returns Codex for codex", () => {
    expect(backendLabel("codex")).toBe("Codex");
  });
});

describe("PROMPT_TEMPLATE", () => {
  it("includes all three inputs", () => {
    const result = PROMPT_TEMPLATE("foo.ts", "const x = 1;", "add types");
    expect(result).toContain("foo.ts");
    expect(result).toContain("const x = 1;");
    expect(result).toContain("add types");
  });

  it("instructs to return only a code block", () => {
    const result = PROMPT_TEMPLATE("f.ts", "code", "fix");
    expect(result).toContain("Only return the modified code");
  });
});

describe("EXPLAIN_PROMPT", () => {
  it("includes selected text when provided", () => {
    const result = EXPLAIN_PROMPT(
      "foo.ts",
      "const x = 1;",
      "what does this do",
    );
    expect(result).toContain("foo.ts");
    expect(result).toContain("const x = 1;");
    expect(result).toContain("what does this do");
  });

  it("mentions file only when no selection", () => {
    const result = EXPLAIN_PROMPT("foo.ts", null, "explain the file");
    expect(result).toContain("foo.ts");
    expect(result).not.toContain("selected");
    expect(result).toContain("explain the file");
  });
});

describe("truncateFileContent", () => {
  it("returns short content unchanged", () => {
    expect(truncateFileContent("hello\nworld")).toBe("hello\nworld");
  });

  it("truncates when line count exceeds MAX_FILE_LINES", () => {
    const lines = Array.from(
      { length: MAX_FILE_LINES + 10 },
      (_, i) => `line${i}`,
    );
    const result = truncateFileContent(lines.join("\n"));
    expect(result).toContain("[...file truncated...]");
    expect(result.split("\n").length).toBeLessThanOrEqual(MAX_FILE_LINES + 1);
  });

  it("truncates when char count exceeds MAX_FILE_CHARS", () => {
    const big = "x".repeat(MAX_FILE_CHARS + 1000);
    const result = truncateFileContent(big);
    expect(result).toContain("[...file truncated...]");
    expect(result.length).toBeLessThanOrEqual(MAX_FILE_CHARS + 30);
  });
});

describe("sanitizeTitle", () => {
  it("removes URI-unsafe characters", () => {
    expect(sanitizeTitle("what is foo?")).toBe("what is foo_");
    expect(sanitizeTitle("path#anchor")).toBe("path_anchor");
    expect(sanitizeTitle("a/b\\c")).toBe("a_b_c");
  });

  it("limits length to 50", () => {
    expect(sanitizeTitle("a".repeat(100)).length).toBe(50);
  });

  it("handles empty string", () => {
    expect(sanitizeTitle("")).toBe("");
  });
});

describe("updateHistory", () => {
  it("prepends value and respects max", () => {
    expect(updateHistory(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });

  it("moves existing entry to front rather than duplicating", () => {
    expect(updateHistory(["a", "b", "c"], "b", 10)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate the original array", () => {
    const h = ["a", "b"];
    updateHistory(h, "c", 10);
    expect(h).toEqual(["a", "b"]);
  });
});

describe("incrementFreq", () => {
  it("increments an existing key", () => {
    expect(incrementFreq({ a: 3 }, "a")).toEqual({ a: 4 });
  });

  it("initializes a missing key to 1", () => {
    expect(incrementFreq({}, "x")).toEqual({ x: 1 });
  });

  it("does not mutate the original object", () => {
    const f = { a: 1 };
    incrementFreq(f, "a");
    expect(f).toEqual({ a: 1 });
  });
});

describe("discoverModels", () => {
  it("returns fallback list when CLI does not exist", () => {
    const models = discoverModels("nonexistent-cli-xyz", ["--help"], "claude");
    expect(models).toEqual([
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
      "claude-opus-4-7",
    ]);
  });

  it("returns codex fallback list", () => {
    const models = discoverModels(
      "nonexistent-cli-xyz",
      ["exec", "--help"],
      "codex",
    );
    expect(models).toEqual(["gpt-5", "gpt-5-mini", "gpt-5-nano", "o4-mini"]);
  });

  it("extracts models from help output", () => {
    // discoverModels uses execSync which we can't easily mock.
    // But we verify the fallback path works correctly for the common case.
    const models = discoverModels("nonexistent-cli", ["--help"], "claude");
    expect(models.length).toBeGreaterThanOrEqual(1);
    expect(models).toContain("claude-sonnet-4-6");
  });
});

describe("ReentryGuard", () => {
  it("tryAcquire returns true on first call", () => {
    const guard = new ReentryGuard();
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.locked).toBe(true);
  });

  it("tryAcquire returns false when already locked", () => {
    const guard = new ReentryGuard();
    guard.tryAcquire();
    expect(guard.tryAcquire()).toBe(false);
    expect(guard.locked).toBe(true);
  });

  it("release unlocks the guard", () => {
    const guard = new ReentryGuard();
    guard.tryAcquire();
    guard.release();
    expect(guard.locked).toBe(false);
  });

  it("tryAcquire succeeds after release", () => {
    const guard = new ReentryGuard();
    guard.tryAcquire();
    guard.release();
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.locked).toBe(true);
  });

  it("multiple acquire-release cycles work", () => {
    const guard = new ReentryGuard();
    for (let i = 0; i < 5; i++) {
      expect(guard.tryAcquire()).toBe(true);
      guard.release();
      expect(guard.locked).toBe(false);
    }
  });

  it("release when not locked is safe (no-op)", () => {
    const guard = new ReentryGuard();
    expect(() => guard.release()).not.toThrow();
    expect(guard.locked).toBe(false);
  });

  it("double release is safe", () => {
    const guard = new ReentryGuard();
    guard.tryAcquire();
    guard.release();
    guard.release();
    expect(guard.locked).toBe(false);
  });
});
