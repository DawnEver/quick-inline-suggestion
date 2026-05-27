import { exec } from "child_process";

export type Backend = "claude" | "codex";
export type Model = string;

export const DEFAULT_TIMEOUT_MS = 120_000;

export interface FileContext {
  /** Bare filename, e.g. "main.ts" */
  fileName: string;
  /** Path relative to workspace root, e.g. "src/components/main.ts" */
  relativePath: string;
  /** The code content (selected text or full file) */
  content: string;
  /** 1-based start line */
  startLine: number;
  /** 1-based end line */
  endLine: number;
  /** Whether content was truncated */
  isTruncated: boolean;
  /** Whether content is a user selection (vs whole file) */
  isSelection: boolean;
}

const FALLBACK_MODELS: Record<Backend, string[]> = {
  claude: ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-7"],
  codex: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "o4-mini"],
};

/** Run a CLI --help and extract model names from the --model option description. */
export async function discoverModels(
  cli: string,
  args: string[],
  fallback: Backend,
): Promise<string[]> {
  try {
    const out = await new Promise<string>((resolve, reject) => {
      exec(
        `${cli} ${args.join(" ")} 2>&1`,
        {
          timeout: 5000,
          encoding: "utf8",
          shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
        },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        },
      );
    });
    const m = out.match(/--model[= ]*[<\w>-]*\s+.*?\(([^)]+)\)/i);
    if (m) {
      return m[1]
        .split(/,\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    // CLI not available or help format changed
  }
  return FALLBACK_MODELS[fallback] ?? [];
}

export const MAX_FILE_LINES = 500;
export const MAX_FILE_CHARS = 20_000;

export function truncateFileContent(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= MAX_FILE_LINES && text.length <= MAX_FILE_CHARS)
    return text;
  const truncated = lines
    .slice(0, MAX_FILE_LINES)
    .join("\n")
    .slice(0, MAX_FILE_CHARS);
  return truncated + "\n[...file truncated...]";
}

export const PROMPT_TEMPLATE = (ctx: FileContext, instruction: string) => {
  const truncNote = ctx.isTruncated
    ? " (file was truncated, only the first portion is shown)"
    : "";
  const label = ctx.isSelection ? "Selected code" : "File content";
  return `\
Only return the modified code wrapped in a single \`\`\`code block. No explanation, no surrounding text.
File: ${ctx.relativePath}:${ctx.startLine}-${ctx.endLine}${truncNote}
${label}:
${ctx.content}
Instruction: ${instruction}`;
};

export const EXPLAIN_PROMPT = (ctx: FileContext, instruction: string) => {
  const truncNote = ctx.isTruncated ? " (truncated)" : "";
  const context = ctx.isSelection
    ? `The user selected lines ${ctx.startLine}-${ctx.endLine} from ${ctx.relativePath}${truncNote}:\n${ctx.content}`
    : `The user is working in ${ctx.relativePath}${truncNote}.\nFile content:\n${ctx.content}`;
  return `${context}\n\nQuestion: ${instruction}`;
};

export function isQuestion(input: string): boolean {
  const q = input.trim();
  if (q.endsWith("?") || q.endsWith("？")) return true;
  if (
    /^(what|why|how|explain|describe|who|when|where|is it|does it|tell me)\b/i.test(
      q,
    )
  )
    return true;
  return /(解释|为什么|怎么|如何|描述|谁|何时|什么时候|哪里|什么地方|帮我|请|麻烦|什么)/.test(
    q,
  );
}

export function extractCodeBlock(raw: string): string {
  const re = /```(?:\w+)?[ \t]*\r?\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    blocks.push(m[1].replace(/\r\n/g, "\n").trim());
  }
  if (blocks.length > 0) return blocks.join("\n\n");
  // Try without requiring newline after opening fence
  const loose = raw.match(/```\s*([\s\S]*?)```/);
  return loose ? loose[1].replace(/\r\n/g, "\n").trim() : raw.trim();
}

export function backendLabel(backend: Backend): string {
  return backend === "claude" ? "Claude" : "Codex";
}

export function sortedHistory(
  history: string[],
  freq: Record<string, number>,
  sortBy: "frequent" | "recent",
): string[] {
  if (sortBy === "recent") return history;
  return [...history].sort((a, b) => (freq[b] ?? 0) - (freq[a] ?? 0));
}

export function updateHistory(
  history: string[],
  value: string,
  max: number,
): string[] {
  return [value, ...history.filter((h) => h !== value)].slice(0, max);
}

export function incrementFreq(
  freq: Record<string, number>,
  value: string,
): Record<string, number> {
  return { ...freq, [value]: (freq[value] ?? 0) + 1 };
}
