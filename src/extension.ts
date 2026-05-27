import * as vscode from "vscode";
import * as path from "path";
import {
  Backend,
  PROMPT_TEMPLATE,
  EXPLAIN_PROMPT,
  isQuestion,
  extractCodeBlock,
  backendLabel,
  sortedHistory,
  updateHistory,
  incrementFreq,
  truncateFileContent,
  discoverModels,
  DEFAULT_TIMEOUT_MS,
  MAX_FILE_LINES,
} from "./utils";
import type { FileContext } from "./utils";
import { askAI } from "./subprocess";

const HISTORY_KEY = "instructionHistory";
const HISTORY_FREQ_KEY = "instructionFrequency";
const DRAFT_KEY = "instructionDraft";
const MAX_HISTORY = 20;

const contentMap = new Map<string, string>();

function rangeAfterReplace(start: vscode.Position, text: string): vscode.Range {
  const lines = text.split("\n");
  const endLine = start.line + lines.length - 1;
  const endChar =
    lines.length === 1
      ? start.character + text.length
      : lines[lines.length - 1].length;
  return new vscode.Range(start, new vscode.Position(endLine, endChar));
}

function getMaxHistoryDisplay(): number {
  const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
  return config.get<number>("maxHistoryDisplay") ?? 3;
}

function getHistorySortBy(): "frequent" | "recent" {
  const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
  return config.get<"frequent" | "recent">("historySortBy") ?? "frequent";
}

function getBackend(): Backend {
  const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
  return config.get<Backend>("backend") ?? "claude";
}

function getClaudeModel(): string {
  const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
  return config.get<string>("claudeModel") ?? "";
}

function getCodexModel(): string {
  const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
  return config.get<string>("codexModel") ?? "";
}

async function getInstruction(
  context: vscode.ExtensionContext,
  placeholder: string,
): Promise<string | undefined> {
  const history: string[] = context.globalState.get(HISTORY_KEY, []);
  const freq: Record<string, number> = context.globalState.get(
    HISTORY_FREQ_KEY,
    {},
  );
  const draft: string = context.globalState.get(DRAFT_KEY, "");
  const maxDisplay = getMaxHistoryDisplay();
  const sortBy = getHistorySortBy();

  const toItems = (list: string[]) =>
    list.slice(0, maxDisplay).map((h) => ({
      label: h,
      description: sortBy === "frequent" && freq[h] ? `×${freq[h]}` : undefined,
    }));

  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick();
    qp.placeholder = placeholder;
    qp.value = draft;
    qp.items = toItems(sortedHistory(history, freq, sortBy));
    qp.canSelectMany = false;

    const clearBtn: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon("clear-all"),
      tooltip: "Clear history",
    };
    if (history.length > 0) {
      qp.buttons = [clearBtn];
    }

    qp.onDidTriggerButton(() => {
      context.globalState.update(HISTORY_KEY, []);
      context.globalState.update(HISTORY_FREQ_KEY, {});
      qp.buttons = [];
      qp.items = [];
    });

    qp.onDidChangeValue((v) => {
      const filtered = v
        ? history.filter((h) => h.toLowerCase().includes(v.toLowerCase()))
        : history;
      qp.items = toItems(sortedHistory(filtered, freq, sortBy));
    });

    let accepted = false;

    const safetyTimer = setTimeout(() => {
      qp.hide();
    }, DEFAULT_TIMEOUT_MS);

    qp.onDidAccept(() => {
      clearTimeout(safetyTimer);
      const value = qp.selectedItems[0]?.label ?? qp.value.trim();
      accepted = true;
      if (value) {
        context.globalState.update(DRAFT_KEY, "");
        resolve(value);
      } else {
        resolve(undefined);
      }
      qp.hide();
    });

    qp.onDidHide(() => {
      clearTimeout(safetyTimer);
      if (!accepted) {
        context.globalState.update(DRAFT_KEY, qp.value);
        resolve(undefined);
      }
      qp.dispose();
    });

    qp.show();
  });
}

async function inlineEdit(
  editor: vscode.TextEditor,
  context: vscode.ExtensionContext,
) {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage(
      "Quick Inline Suggestion requires a trusted workspace to run AI CLI tools.",
    );
    return;
  }

  const doc = editor.document;
  const selection = editor.selection;
  const selectedText = selection.isEmpty ? null : doc.getText(selection);
  const fileName = path.basename(doc.fileName);
  const configuredBackend = getBackend();
  const configuredLabel = backendLabel(configuredBackend);

  const instruction = await getInstruction(
    context,
    selectedText
      ? `What should ${configuredLabel} do with this code?`
      : `Ask ${configuredLabel} anything about this file`,
  );
  if (!instruction) return;

  const cwd =
    vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ??
    path.dirname(doc.fileName);

  // Snapshot selection range and original text before the async AI call
  // to avoid race conditions if the document is edited while waiting.
  const sel = selection.isEmpty
    ? new vscode.Selection(
        0,
        0,
        doc.lineAt(doc.lineCount - 1).lineNumber,
        doc.lineAt(doc.lineCount - 1).text.length,
      )
    : selection;
  const originalText = doc.getText(sel);

  const fullText = doc.getText();
  const fileContent = selectedText ?? truncateFileContent(fullText);
  const isTruncated = !selectedText && fullText !== fileContent;
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri
    .fsPath;
  const relativePath = workspaceRoot
    ? path.relative(workspaceRoot, doc.fileName)
    : fileName;

  const ctx: FileContext = {
    fileName,
    relativePath,
    content: fileContent,
    startLine: selection.isEmpty ? 1 : selection.start.line + 1,
    endLine: selection.isEmpty ? doc.lineCount : selection.end.line + 1,
    isTruncated,
    isSelection: !selection.isEmpty,
  };

  if (isTruncated) {
    vscode.window.showWarningMessage(
      `File exceeds ${MAX_FILE_LINES} lines or 20,000 characters — AI sees truncated content.`,
    );
  }

  const isExplain = isQuestion(instruction);
  const promptText = isExplain
    ? EXPLAIN_PROMPT(ctx, instruction)
    : PROMPT_TEMPLATE(ctx, instruction);

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
        return askAI(
          promptText,
          cwd,
          abort.signal,
          getBackend,
          getClaudeModel,
          getCodexModel,
          (msg) => vscode.window.showWarningMessage(msg),
        );
      },
    );
    raw = result;
    label = backendLabel(backend);
  } catch (e: any) {
    if (e.message !== "Cancelled") {
      const failedLabel = (e as any).backend
        ? backendLabel((e as any).backend)
        : configuredLabel;
      vscode.window.showErrorMessage(`${failedLabel} failed: ${e.message}`);
    }
    return;
  }

  const history: string[] = context.globalState.get(HISTORY_KEY, []);
  const freq: Record<string, number> = context.globalState.get(
    HISTORY_FREQ_KEY,
    {},
  );
  context.globalState.update(
    HISTORY_KEY,
    updateHistory(history, instruction, MAX_HISTORY),
  );

  if (isExplain) {
    const content = [
      `# ${instruction}`,
      ``,
      `**File:** ${ctx.relativePath}`,
      ``,
      `**Context:**`,
      "```",
      fileContent,
      "```",
      ``,
      `---`,
      ``,
      raw.trim(),
    ].join("\n");
    const answerDoc = await vscode.workspace.openTextDocument({
      content,
      language: "markdown",
    });
    await vscode.window.showTextDocument(answerDoc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });
    context.globalState.update(
      HISTORY_FREQ_KEY,
      incrementFreq(freq, instruction),
    );
    return;
  }

  // Edit mode: apply to file directly, show diff of original vs current file
  const replacement = extractCodeBlock(raw);

  const applyEdit = new vscode.WorkspaceEdit();
  applyEdit.replace(doc.uri, sel, replacement);
  const applied = await vscode.workspace.applyEdit(applyEdit);
  if (!applied) {
    vscode.window.showErrorMessage(
      "Failed to apply edit — the file may be read-only.",
    );
    return;
  }

  const appliedRange = rangeAfterReplace(sel.start, replacement);
  const versionAfterApply = doc.version;
  const hadSelection = !selection.isEmpty;
  const key = `quick-inline://original/${Date.now()}/${fileName}`;
  const originalUri = vscode.Uri.parse(key);
  contentMap.set(key, originalText);

  // When user selected text, diff snippet-vs-snippet instead of snippet-vs-full-file
  const modifiedUri = hadSelection
    ? vscode.Uri.parse(`quick-inline://modified/${Date.now()}/${fileName}`)
    : doc.uri;
  if (hadSelection) {
    contentMap.set(modifiedUri.toString(), replacement);
  }

  await vscode.commands.executeCommand(
    "vscode.diff",
    originalUri,
    modifiedUri,
    `Quick edit (${label}) — Keep or Revert`,
  );

  const action = await vscode.window.showInformationMessage(
    `Keep ${label}'s suggestion?`,
    "Keep",
    "Revert",
  );

  // Close the diff tab opened by this command
  const editTab = vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .find((tab) => {
      const input = tab.input as any;
      return input?.original?.toString() === originalUri.toString();
    });
  if (editTab) {
    await vscode.window.tabGroups.close(editTab);
  }
  contentMap.delete(key);
  if (hadSelection) {
    contentMap.delete(modifiedUri.toString());
  }

  if (action === "Revert") {
    if (doc.version === versionAfterApply) {
      // No concurrent edits — safe to revert via precise range
      const revert = new vscode.WorkspaceEdit();
      revert.replace(doc.uri, appliedRange, originalText);
      await vscode.workspace.applyEdit(revert);
    } else {
      vscode.window.showWarningMessage(
        "File was edited after applying — use Ctrl+Z to manually undo the AI edit.",
      );
    }
  } else if (action === "Keep") {
    context.globalState.update(
      HISTORY_FREQ_KEY,
      incrementFreq(freq, instruction),
    );
  }
}

async function selectBackend() {
  const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
  const current = getBackend();

  const items: vscode.QuickPickItem[] = [
    {
      label: "Claude",
      description: "Claude Code CLI",
      detail: current === "claude" ? "current" : undefined,
    },
    {
      label: "Codex",
      description: "OpenAI Codex CLI",
      detail: current === "codex" ? "current" : undefined,
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select AI backend",
  });
  if (!picked) return;

  const value = picked.label.toLowerCase() as Backend;
  await config.update("backend", value, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Backend set to ${picked.label}.`);
}

async function selectModel() {
  const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
  const backend = getBackend();
  const currentModel = backend === "codex" ? getCodexModel() : getClaudeModel();

  const qp = vscode.window.createQuickPick();
  qp.placeholder = `Loading models for ${backendLabel(backend)}...`;
  qp.busy = true;
  qp.enabled = false;
  qp.show();

  const models = await discoverModels(
    backend,
    backend === "codex" ? ["exec", "--help"] : ["--help"],
    backend,
  );

  const items: vscode.QuickPickItem[] = [
    {
      label: "$(star) Default",
      description: "Use the CLI's default model",
      alwaysShow: true,
    },
    ...models.map((m) => ({
      label: m,
      description: m === currentModel ? "current" : undefined,
    })),
  ];

  qp.placeholder = `Select model for ${backendLabel(backend)}`;
  qp.busy = false;
  qp.enabled = true;
  qp.items = items;

  const picked = await new Promise<readonly vscode.QuickPickItem[] | undefined>(
    (resolve) => {
      qp.onDidAccept(() => {
        resolve(qp.selectedItems);
        qp.hide();
      });
      qp.onDidHide(() => {
        resolve(undefined);
        qp.dispose();
      });
    },
  );

  if (!picked || picked.length === 0) return;

  const value = picked[0].label.startsWith("$(star)") ? "" : picked[0].label;
  const key = backend === "codex" ? "codexModel" : "claudeModel";
  await config.update(key, value, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    `${backendLabel(backend)} model set to "${value || "default"}".`,
  );
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("quick-inline", {
      provideTextDocumentContent: (uri) => contentMap.get(uri.toString()) ?? "",
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === "quick-inline") {
        contentMap.delete(doc.uri.toString());
      }
    }),
    vscode.commands.registerTextEditorCommand(
      "quick-inline-suggestion.inlineEdit",
      (editor) => inlineEdit(editor, context),
    ),
    vscode.commands.registerCommand(
      "quick-inline-suggestion.selectBackend",
      selectBackend,
    ),
    vscode.commands.registerCommand(
      "quick-inline-suggestion.selectModel",
      selectModel,
    ),
  );
}

export function deactivate() {}
