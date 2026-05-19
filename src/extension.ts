import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";

const PROMPT_TEMPLATE = (fileName: string, selectedText: string, instruction: string) => `\
Only return the modified code wrapped in a single \`\`\`code block. No explanation, no surrounding text.
File: ${fileName}
Selected code:
${selectedText}
Instruction: ${instruction}`;

function extractCodeBlock(raw: string): string {
  const match = raw.match(/```(?:\w+)?\n([\s\S]*?)```/);
  return match ? match[1].trim() : raw.trim();
}

function askClaudeCode(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["-p", prompt, "--output-format", "text", "--allowedTools", "Read"], {
      cwd,
      env: { ...process.env },
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d));
    proc.stderr.on("data", (d: Buffer) => (err += d));
    proc.on("close", (code: number | null) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `claude exited with code ${code ?? "unknown"}`));
    });
  });
}

async function inlineEdit(editor: vscode.TextEditor) {
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection.isEmpty ? undefined : selection);

  if (!selectedText.trim()) {
    vscode.window.showWarningMessage("Select some code first.");
    return;
  }

  const instruction = await vscode.window.showInputBox({
    prompt: "What should Claude do with this code?",
    placeHolder: "e.g. convert to async/await",
  });
  if (!instruction) return;

  const fileName = path.basename(editor.document.fileName);
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(editor.document.fileName);
  const prompt = PROMPT_TEMPLATE(fileName, selectedText, instruction);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Claude is thinking…", cancellable: false },
    async () => {
      let raw: string;
      try {
        raw = await askClaudeCode(prompt, cwd);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Claude failed: ${e.message}`);
        return;
      }

      const replacement = extractCodeBlock(raw);

      const originalUri = editor.document.uri;
      const modifiedDoc = await vscode.workspace.openTextDocument({
        content: replacement,
        language: editor.document.languageId,
      });

      await vscode.commands.executeCommand(
        "vscode.diff",
        originalUri,
        modifiedDoc.uri,
        "Claude suggestion — accept or close to reject"
      );

      const action = await vscode.window.showInformationMessage(
        "Apply Claude's suggestion?",
        "Apply",
        "Discard"
      );

      if (action === "Apply") {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(originalUri, selection, replacement);
        await vscode.workspace.applyEdit(edit);
      }

      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
  );
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand("claude-inline-suggestion.inlineEdit", inlineEdit)
  );
}

export function deactivate() {}
