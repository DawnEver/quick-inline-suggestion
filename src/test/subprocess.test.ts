import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import * as fs from "fs";
import { askClaude, askCodex, askAI, SpawnFn } from "../subprocess";
import type { Backend } from "../utils";

function makeMockProc(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {};
  proc.stdin = {
    write: (_d: string, _e: string) => {},
    end: () => {
      setImmediate(() => {
        if (opts.stdout) proc.stdout.emit("data", Buffer.from(opts.stdout));
        if (opts.stderr) proc.stderr.emit("data", Buffer.from(opts.stderr));
        proc.emit("close", opts.exitCode ?? 0);
      });
    },
  };
  return proc;
}

function claudeSpawn(stdout: string, exitCode = 0, stderr = ""): SpawnFn {
  return (() =>
    makeMockProc({ stdout, stderr, exitCode })) as unknown as SpawnFn;
}

function codexSpawn(output: string, exitCode = 0): SpawnFn {
  return ((_cmd: string, args: string[]) => {
    const idx = (args as string[]).indexOf("--output-last-message");
    const tmpFile = idx >= 0 ? args[idx + 1] : undefined;
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    proc.stdin = {
      write: () => {},
      end: () => {
        setImmediate(() => {
          if (exitCode === 0 && tmpFile) fs.writeFileSync(tmpFile, output);
          proc.emit("close", exitCode);
        });
      },
    };
    return proc;
  }) as unknown as SpawnFn;
}

describe("askClaude", () => {
  it("resolves with stdout on exit 0", async () => {
    const signal = new AbortController().signal;
    const result = await askClaude(
      "prompt",
      "/tmp",
      signal,
      "",
      claudeSpawn("hello output"),
    );
    expect(result).toContain("hello output");
  });

  it("passes --model flag when model is set", async () => {
    const signal = new AbortController().signal;
    let capturedArgs: string[] = [];
    const captureSpawn: SpawnFn = ((_cmd: string, args: string[]) => {
      capturedArgs = args as string[];
      return makeMockProc({ stdout: "ok" });
    }) as unknown as SpawnFn;
    await askClaude("prompt", "/tmp", signal, "claude-haiku-4-5", captureSpawn);
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("claude-haiku-4-5");
  });

  it("rejects with stderr message on exit 1", async () => {
    const signal = new AbortController().signal;
    await expect(
      askClaude(
        "prompt",
        "/tmp",
        signal,
        "",
        claudeSpawn("", 1, "claude error"),
      ),
    ).rejects.toThrow("claude error");
  });

  it("rejects with fallback message when stderr is empty and exit non-zero", async () => {
    const signal = new AbortController().signal;
    await expect(
      askClaude("prompt", "/tmp", signal, "", claudeSpawn("", 2, "")),
    ).rejects.toThrow(/claude exited with code 2/);
  });

  it("handles stdout arriving in multiple chunks", async () => {
    const signal = new AbortController().signal;
    const chunkSpawn: SpawnFn = (() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {};
      proc.stdin = {
        write: () => {},
        end: () => {
          setImmediate(() => {
            proc.stdout.emit("data", Buffer.from("chunk1 "));
            proc.stdout.emit("data", Buffer.from("chunk2"));
            proc.emit("close", 0);
          });
        },
      };
      return proc;
    }) as unknown as SpawnFn;
    const result = await askClaude("prompt", "/tmp", signal, "", chunkSpawn);
    expect(result).toBe("chunk1 chunk2");
  });

  it("rejects when spawn emits error event", async () => {
    const signal = new AbortController().signal;
    const errorSpawn: SpawnFn = (() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {};
      proc.stdin = {
        write: () => {},
        end: () => {
          setImmediate(() => {
            proc.emit("error", new Error("ENOENT spawn error"));
          });
        },
      };
      return proc;
    }) as unknown as SpawnFn;
    await expect(
      askClaude("prompt", "/tmp", signal, "", errorSpawn),
    ).rejects.toThrow("ENOENT spawn error");
  });

  it("rejects with Cancelled when aborted before process completes", async () => {
    const ac = new AbortController();
    const hangingSpawn: SpawnFn = (() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {};
      proc.stdin = { write: () => {}, end: () => {} }; // never resolves
      return proc;
    }) as unknown as SpawnFn;

    const promise = askClaude("prompt", "/tmp", ac.signal, "", hangingSpawn);
    ac.abort();
    await expect(promise).rejects.toThrow("Cancelled");
  });
});

describe("askCodex", () => {
  it("resolves with tmpFile content on exit 0", async () => {
    const signal = new AbortController().signal;
    const result = await askCodex(
      "prompt",
      "/tmp",
      signal,
      "",
      codexSpawn("codex output"),
    );
    expect(result).toBe("codex output");
  });

  it("passes --model flag when model is set", async () => {
    const signal = new AbortController().signal;
    let capturedArgs: string[] = [];
    const captureSpawn: SpawnFn = ((_cmd: string, args: string[]) => {
      capturedArgs = args as string[];
      // codexSpawn writes tmpFile; use its approach inline
      const idx = (args as string[]).indexOf("--output-last-message");
      const tmpFile = idx >= 0 ? args[idx + 1] : undefined;
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {};
      proc.stdin = {
        write: () => {},
        end: () => {
          setImmediate(() => {
            if (tmpFile) fs.writeFileSync(tmpFile, "ok");
            proc.emit("close", 0);
          });
        },
      };
      return proc;
    }) as unknown as SpawnFn;
    await askCodex("prompt", "/tmp", signal, "gpt-5-mini", captureSpawn);
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("gpt-5-mini");
  });

  it("rejects on non-zero exit", async () => {
    const signal = new AbortController().signal;
    await expect(
      askCodex("prompt", "/tmp", signal, "", codexSpawn("", 1)),
    ).rejects.toThrow();
  });

  it("rejects with error message from stderr on failure", async () => {
    const failSpawn: SpawnFn = ((_cmd: string, _args: string[]) => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {};
      proc.stdin = {
        write: () => {},
        end: () => {
          setImmediate(() => {
            proc.stderr.emit("data", Buffer.from("codex stderr error"));
            proc.emit("close", 1);
          });
        },
      };
      return proc;
    }) as unknown as SpawnFn;

    const signal = new AbortController().signal;
    await expect(
      askCodex("prompt", "/tmp", signal, "", failSpawn),
    ).rejects.toThrow("codex stderr error");
  });

  it("rejects when spawn emits error event", async () => {
    const errorSpawn: SpawnFn = ((_cmd: string, _args: string[]) => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {};
      proc.stdin = {
        write: () => {},
        end: () => {
          setImmediate(() => {
            proc.emit("error", new Error("ENOENT codex error"));
          });
        },
      };
      return proc;
    }) as unknown as SpawnFn;
    const signal = new AbortController().signal;
    await expect(
      askCodex("prompt", "/tmp", signal, "", errorSpawn),
    ).rejects.toThrow("ENOENT codex error");
  });
});

describe("askAI", () => {
  it("returns primary backend result when primary succeeds", async () => {
    const signal = new AbortController().signal;
    const { result, backend } = await askAI(
      "prompt",
      "/tmp",
      signal,
      () => "claude" as Backend,
      () => "",
      () => "",
      () => {},
      claudeSpawn("primary result"),
    );
    expect(result).toContain("primary result");
    expect(backend).toBe("claude");
  });

  it("falls back to codex when claude fails", async () => {
    const signal = new AbortController().signal;
    const warnings: string[] = [];
    let callCount = 0;

    const alternatingSpawn: SpawnFn = ((_cmd: string, args: string[]) => {
      callCount++;
      if (callCount === 1) {
        return makeMockProc({ exitCode: 1, stderr: "claude failed" });
      }
      const idx = (args as string[]).indexOf("--output-last-message");
      const tmpFile = idx >= 0 ? args[idx + 1] : undefined;
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {};
      proc.stdin = {
        write: () => {},
        end: () => {
          setImmediate(() => {
            if (tmpFile) fs.writeFileSync(tmpFile, "codex fallback result");
            proc.emit("close", 0);
          });
        },
      };
      return proc;
    }) as unknown as SpawnFn;

    const { result, backend } = await askAI(
      "prompt",
      "/tmp",
      signal,
      () => "claude" as Backend,
      () => "",
      () => "",
      (msg: string) => warnings.push(msg),
      alternatingSpawn,
    );

    expect(backend).toBe("codex");
    expect(result).toBe("codex fallback result");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("falling back");
  });

  it("throws when both backends fail", async () => {
    const signal = new AbortController().signal;
    await expect(
      askAI(
        "prompt",
        "/tmp",
        signal,
        () => "claude" as Backend,
        () => "",
        () => "",
        () => {},
        claudeSpawn("", 1, "both fail"),
      ),
    ).rejects.toThrow();
  });

  it("passes correct model to each backend", async () => {
    const signal = new AbortController().signal;
    let claudeArgs: string[] = [];
    let codexArgs: string[] = [];
    let callCount = 0;

    const capturingSpawn: SpawnFn = ((_cmd: string, args: string[]) => {
      callCount++;
      if (callCount === 1) {
        claudeArgs = [...(args as string[])];
        return makeMockProc({ exitCode: 1, stderr: "claude failed" });
      }
      codexArgs = [...(args as string[])];
      const idx = (args as string[]).indexOf("--output-last-message");
      const tmpFile = idx >= 0 ? args[idx + 1] : undefined;
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {};
      proc.stdin = {
        write: () => {},
        end: () => {
          setImmediate(() => {
            if (tmpFile) fs.writeFileSync(tmpFile, "codex fallback");
            proc.emit("close", 0);
          });
        },
      };
      return proc;
    }) as unknown as SpawnFn;

    const { result, backend } = await askAI(
      "prompt",
      "/tmp",
      signal,
      () => "claude" as Backend,
      () => "claude-haiku-4-5",
      () => "gpt-5-nano",
      () => {},
      capturingSpawn,
    );

    expect(backend).toBe("codex");
    expect(result).toBe("codex fallback");
    expect(claudeArgs).toContain("--model");
    expect(claudeArgs).toContain("claude-haiku-4-5");
    expect(codexArgs).toContain("--model");
    expect(codexArgs).toContain("gpt-5-nano");
  });

  it("does not attempt fallback when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const warnings: string[] = [];

    await expect(
      askAI(
        "prompt",
        "/tmp",
        ac.signal,
        () => "claude" as Backend,
        () => "",
        () => "",
        (msg: string) => warnings.push(msg),
        claudeSpawn("", 1, "error"),
      ),
    ).rejects.toThrow();

    expect(warnings).toHaveLength(0);
  });
});
