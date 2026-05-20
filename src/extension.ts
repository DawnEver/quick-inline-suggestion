import * as vscode from "vscode";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const PROMPT_TEMPLATE = (
  fileName: string,
  selectedText: string,
  instruction: string,
) => `\
Only return the modified code wrapped in a single \`\`\`code block. No explanation, no surrounding text.
File: ${fileName}
Selected code:
${selectedText}
Instruction: ${instruction}`;

const EXPLAIN_PROMPT = (
  fileName: string,
  selectedText: string | null,
  instruction: string,
) => {
  const context = selectedText
    ? `The user selected the following code from ${fileName}:\n${selectedText}`
    : `The user is working in the file ${fileName}`;
  return `${context}\n\nQuestion: ${instruction}`;
};

function isQuestion(input: string): boolean {
  const q = input.trim();
  if (q.endsWith("?")) return true;
  return /^(what|why|how|explain|describe|who|when|where|is it|does it|tell me|show me)\b/i.test(
    q,
  );
}

function extractCodeBlock(raw: string): string {
  const match = raw.match(/```(?:\w+)?\n([\s\S]*?)```/);
  return match ? match[1].trim() : raw.trim();
}

type Backend = "claude" | "codex";

function getBackend(): Backend {
  const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
  return config.get<Backend>("backend") ?? "claude";
}

function backendLabel(backend: Backend): string {
  return backend === "claude" ? "Claude" : "Codex";
}

// Pipes prompt via stdin to claude -p (print/non-interactive mode).
// Avoids arg-length limits, shell injection, and ps leakage.
function askClaude(
  promptText: string,
  cwd: string,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "claude",
      ["-p", "--output-format", "text", "--allowedTools", "Read"],
      {
        cwd,
        env: { ...process.env },
      },
    );

    signal.addEventListener("abort", () => {
      proc.kill();
      reject(new Error("Cancelled"));
    });

    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d));
    proc.stderr.on("data", (d: Buffer) => (err += d));
    proc.on("close", (code: number | null) => {
      if (signal.aborted) return;
      if (code === 0) resolve(out);
      else
        reject(
          new Error(
            err.trim() || `claude exited with code ${code ?? "unknown"}`,
          ),
        );
    });
    proc.on("error", (e: Error) => reject(e));

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
function askCodex(
  promptText: string,
  cwd: string,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(
      os.tmpdir(),
      `quick-inline-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );

    const proc = spawn(
      "codex",
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-last-message",
        tmpFile,
      ],
      {
        cwd,
        env: { ...process.env },
      },
    );

    signal.addEventListener("abort", () => {
      proc.kill();
      cleanup();
      reject(new Error("Cancelled"));
    });

    let err = "";
    proc.stderr.on("data", (d: Buffer) => (err += d));

    const cleanup = () => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // best-effort cleanup
      }
    };

    proc.on("close", (code: number | null) => {
      if (signal.aborted) return;
      if (code !== 0) {
        cleanup();
        reject(
          new Error(
            err.trim() || `codex exited with code ${code ?? "unknown"}`,
          ),
        );
        return;
      }
      try {
        const out = fs.readFileSync(tmpFile, "utf8").trim();
        cleanup();
        resolve(out);
      } catch (e: any) {
        cleanup();
        reject(new Error(`Failed to read codex output: ${e.message}`));
      }
    });

    proc.on("error", (e: Error) => {
      cleanup();
      reject(e);
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

async function askAI(
  promptText: string,
  cwd: string,
  signal: AbortSignal,
): Promise<{ result: string; backend: Backend }> {
  const primary = getBackend();
  const fallback: Backend = primary === "codex" ? "claude" : "codex";
  const run = (b: Backend) =>
    b === "codex"
      ? askCodex(promptText, cwd, signal)
      : askClaude(promptText, cwd, signal);

  try {
    return { result: await run(primary), backend: primary };
  } catch (e: any) {
    if (signal.aborted) throw e;
    vscode.window.showWarningMessage(
      `${backendLabel(primary)} failed — falling back to ${backendLabel(fallback)}.`,
    );
    return { result: await run(fallback), backend: fallback };
  }
}

async function inlineEdit(editor: vscode.TextEditor) {
  const doc = editor.document;
  const selection = editor.selection;
  const selectedText = selection.isEmpty ? null : doc.getText(selection);
  const fileName = path.basename(doc.fileName);
  const configuredBackend = getBackend();
  const configuredLabel = backendLabel(configuredBackend);

  const instruction = await vscode.window.showInputBox({
    prompt: selectedText
      ? `What should ${configuredLabel} do with this code?`
      : `Ask ${configuredLabel} anything about this file`,
    placeHolder: "e.g. convert to async/await, or ask a question",
  });
  if (!instruction) return;

  const cwd =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    path.dirname(doc.fileName);

  const isExplain = isQuestion(instruction);
  const promptText = isExplain
    ? EXPLAIN_PROMPT(fileName, selectedText ?? doc.getText(), instruction)
    : PROMPT_TEMPLATE(fileName, selectedText ?? doc.getText(), instruction);

  const abort = new AbortController();

  let raw: string;
  let label: string;
  try {
    const { result, backend } = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: isExplain ? `${configuredLabel} is thinking…` : "Editing…",
        cancellable: true,
      },
      (_progress, token) => {
        token.onCancellationRequested(() => abort.abort());
        return askAI(promptText, cwd, abort.signal);
      },
    );
    raw = result;
    label = backendLabel(backend);
  } catch (e: any) {
    if (e.message !== "Cancelled") {
      vscode.window.showErrorMessage(`${configuredLabel} failed: ${e.message}`);
    }
    return;
  }

  if (isExplain) {
    const title = `Answer: ${instruction}`.slice(0, 60);
    const untitled = vscode.Uri.parse(`untitled:${title}.md`);
    const newDoc = await vscode.workspace.openTextDocument(untitled);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(untitled, new vscode.Position(0, 0), raw.trim());
    await vscode.workspace.applyEdit(edit);
    await vscode.window.showTextDocument(newDoc);
    return;
  }

  // Edit mode: diff selected region (original) vs replacement in a temp doc
  const sel = selection.isEmpty
    ? new vscode.Selection(
        0,
        0,
        doc.lineAt(doc.lineCount - 1).lineNumber,
        doc.lineAt(doc.lineCount - 1).text.length,
      )
    : selection;
  const originalText = doc.getText(sel);
  const replacement = extractCodeBlock(raw);

  const originalDoc = await vscode.workspace.openTextDocument({
    content: originalText,
    language: doc.languageId,
  });
  const modifiedDoc = await vscode.workspace.openTextDocument({
    content: replacement,
    language: doc.languageId,
  });

  await vscode.commands.executeCommand(
    "vscode.diff",
    originalDoc.uri,
    modifiedDoc.uri,
    `Quick edit (${label}) — accept or discard`,
  );

  const action = await vscode.window.showInformationMessage(
    `Apply ${label}'s suggestion?`,
    "Apply",
    "Discard",
  );

  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  if (action === "Apply") {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, sel, replacement);
    await vscode.workspace.applyEdit(edit);
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      "quick-inline-suggestion.inlineEdit",
      inlineEdit,
    ),
  );
}

export function deactivate() {}
