import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension activation", () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.all.find((e) =>
      e.id.includes("quick-inline-suggestion"),
    );
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test("command quick-inline-suggestion.inlineEdit is registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("quick-inline-suggestion.inlineEdit"),
      "inlineEdit command should be registered",
    );
  });

  test("command quick-inline-suggestion.selectModel is registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("quick-inline-suggestion.selectModel"),
      "selectModel command should be registered",
    );
  });
});

suite("VS Code configuration defaults", () => {
  test('backend defaults to "claude"', () => {
    const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
    assert.strictEqual(config.get<string>("backend") ?? "claude", "claude");
  });

  test("maxHistoryDisplay defaults to 3", () => {
    const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
    assert.strictEqual(config.get<number>("maxHistoryDisplay") ?? 3, 3);
  });

  test('historySortBy defaults to "frequent"', () => {
    const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
    assert.strictEqual(
      config.get<string>("historySortBy") ?? "frequent",
      "frequent",
    );
  });

  test('claudeModel defaults to ""', () => {
    const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
    assert.strictEqual(config.get<string>("claudeModel") ?? "", "");
  });

  test('codexModel defaults to ""', () => {
    const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
    assert.strictEqual(config.get<string>("codexModel") ?? "", "");
  });
});
