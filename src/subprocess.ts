import { spawn as nodeSpawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Backend, backendLabel, DEFAULT_TIMEOUT_MS } from "./utils";

// On Windows, VS Code GUI launches don't inherit the user's shell PATH, so
// CLIs installed via npm (claude, codex) can't be found by spawn.
// Using shell:true delegates resolution to cmd.exe which reads the registry PATH.
// All spawn args are hardcoded literals; prompt goes via stdin — no injection risk.
const USE_SHELL = process.platform === "win32";

export type SpawnFn = typeof nodeSpawn;

// Pipes prompt via stdin to claude -p (print/non-interactive mode).
// Avoids arg-length limits, shell injection, and ps leakage.
export function askClaude(
  promptText: string,
  cwd: string,
  signal: AbortSignal,
  model: string = "",
  spawnFn: SpawnFn = nodeSpawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  if (signal.aborted) return Promise.reject(new Error("Cancelled"));
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "text", "--allowedTools", "Read"];
    if (model) args.push("--model", model);
    const proc = spawnFn("claude", args, {
      cwd,
      shell: USE_SHELL,
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Timed out waiting for Claude"));
    }, timeoutMs);

    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };

    signal.addEventListener("abort", () => {
      done(() => {
        proc.kill();
        reject(new Error("Cancelled"));
      });
    });

    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d));
    proc.stderr.on("data", (d: Buffer) => (err += d));
    proc.on("close", (code: number | null) => {
      if (signal.aborted) return;
      done(() => {
        if (code === 0) resolve(out);
        else
          reject(
            new Error(
              err.trim() || `claude exited with code ${code ?? "unknown"}`,
            ),
          );
      });
    });
    proc.on("error", (e: Error) => done(() => reject(e)));

    if (proc.stdin) {
      proc.stdin.write(promptText, "utf8");
      proc.stdin.end();
    } else {
      proc.kill();
      reject(new Error("Failed to open claude stdin"));
    }
  });
}

// Uses codex exec --output-last-message for clean response extraction.
// Codex writes session metadata to stderr; the last message goes to a temp file.
export function askCodex(
  promptText: string,
  cwd: string,
  signal: AbortSignal,
  model: string = "",
  spawnFn: SpawnFn = nodeSpawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  if (signal.aborted) return Promise.reject(new Error("Cancelled"));
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(
      os.tmpdir(),
      `quick-inline-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );

    const args = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--output-last-message",
      tmpFile,
    ];
    if (model) args.push("--model", model);
    const proc = spawnFn("codex", args, {
      cwd,
      shell: USE_SHELL,
    });

    const cleanup = () => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* best-effort */
      }
    };

    const timer = setTimeout(() => {
      proc.kill();
      cleanup();
      reject(new Error("Timed out waiting for Codex"));
    }, timeoutMs);

    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };

    signal.addEventListener("abort", () => {
      done(() => {
        proc.kill();
        cleanup();
        reject(new Error("Cancelled"));
      });
    });

    let err = "";
    proc.stderr.on("data", (d: Buffer) => (err += d));

    proc.on("close", (code: number | null) => {
      if (signal.aborted) return;
      if (code !== 0) {
        done(() => {
          cleanup();
          reject(
            new Error(
              err.trim() || `codex exited with code ${code ?? "unknown"}`,
            ),
          );
        });
        return;
      }
      try {
        const out = fs.readFileSync(tmpFile, "utf8").trim();
        done(() => {
          cleanup();
          resolve(out);
        });
      } catch (e: any) {
        done(() => {
          cleanup();
          reject(new Error(`Failed to read codex output: ${e.message}`));
        });
      }
    });

    proc.on("error", (e: Error) => {
      done(() => {
        cleanup();
        reject(e);
      });
    });

    if (proc.stdin) {
      proc.stdin.write(promptText, "utf8");
      proc.stdin.end();
    } else {
      proc.kill();
      cleanup();
      reject(new Error("Failed to open codex stdin"));
    }
  });
}

export async function askAI(
  promptText: string,
  cwd: string,
  signal: AbortSignal,
  getBackend: () => Backend,
  getClaudeModel: () => string,
  getCodexModel: () => string,
  warn: (msg: string) => void,
  spawnFn: SpawnFn = nodeSpawn,
): Promise<{ result: string; backend: Backend }> {
  const primary = getBackend();
  const fallback: Backend = primary === "codex" ? "claude" : "codex";
  const run = (b: Backend) =>
    b === "codex"
      ? askCodex(promptText, cwd, signal, getCodexModel(), spawnFn)
      : askClaude(promptText, cwd, signal, getClaudeModel(), spawnFn);

  try {
    return { result: await run(primary), backend: primary };
  } catch (e: any) {
    if (signal.aborted) throw e;
    warn(
      `${backendLabel(primary)} failed — falling back to ${backendLabel(fallback)}.`,
    );
    try {
      return { result: await run(fallback), backend: fallback };
    } catch (e2: any) {
      if (signal.aborted) throw e2;
      const fallbackMsg =
        e2.code === "ENOENT"
          ? `${backendLabel(fallback)} CLI not found in PATH. Is it installed?`
          : e2.message;
      const msg = `${backendLabel(primary)}: ${e.message}; ${backendLabel(fallback)}: ${fallbackMsg}`;
      const err = new Error(msg) as Error & { backend: Backend };
      err.backend = fallback;
      throw err;
    }
  }
}
