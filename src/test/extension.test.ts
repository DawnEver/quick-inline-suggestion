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

  const EXPECTED_COMMANDS = [
    "quick-inline-suggestion.inlineEdit",
    "quick-inline-suggestion.selectBackend",
    "quick-inline-suggestion.selectModel",
  ];

  for (const cmd of EXPECTED_COMMANDS) {
    test(`command ${cmd} is registered`, async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes(cmd), `${cmd} command should be registered`);
    });
  }

  test("all 3 commands registered via contributes", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const cmd of EXPECTED_COMMANDS) {
      assert.ok(commands.includes(cmd), `${cmd} missing`);
    }
  });
});

suite("VS Code configuration defaults", () => {
  // Reset any global overrides left by previous runs
  suiteSetup(async () => {
    const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
    const defaults: [string, any][] = [
      ["backend", "claude"],
      ["maxHistoryDisplay", 3],
      ["historySortBy", "frequent"],
      ["claudeModel", ""],
      ["codexModel", ""],
    ];
    for (const [key, value] of defaults) {
      const inspected = config.inspect(key);
      if (
        inspected?.globalValue !== undefined &&
        inspected.globalValue !== value
      ) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('backend defaults to "claude"', () => {
    const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
    const inspected = config.inspect("backend");
    assert.strictEqual(inspected?.defaultValue, "claude");
  });

  test("maxHistoryDisplay defaults to 3", () => {
    const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
    const inspected = config.inspect("maxHistoryDisplay");
    assert.strictEqual(inspected?.defaultValue, 3);
  });

  test('historySortBy defaults to "frequent"', () => {
    const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
    const inspected = config.inspect("historySortBy");
    assert.strictEqual(inspected?.defaultValue, "frequent");
  });

  test('claudeModel defaults to ""', () => {
    const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
    const inspected = config.inspect("claudeModel");
    assert.strictEqual(inspected?.defaultValue, "");
  });

  test('codexModel defaults to ""', () => {
    const config = vscode.workspace.getConfiguration("quick-inline-suggestion");
    const inspected = config.inspect("codexModel");
    assert.strictEqual(inspected?.defaultValue, "");
  });
});

suite("VS Code configuration read/write", () => {
  const SECTION = "quick-inline-suggestion";

  suiteTeardown(async () => {
    const config = vscode.workspace.getConfiguration(SECTION);
    await config.update(
      "backend",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "maxHistoryDisplay",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "historySortBy",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  });

  test("backend updates and reads back", async () => {
    const config = vscode.workspace.getConfiguration(SECTION);
    await config.update("backend", "codex", vscode.ConfigurationTarget.Global);

    // Re-read with a fresh config object after a short settle
    const config2 = vscode.workspace.getConfiguration(SECTION);
    const val = config2.get<string>("backend");
    assert.strictEqual(val, "codex");
  });

  test("maxHistoryDisplay updates and reads back", async () => {
    const config = vscode.workspace.getConfiguration(SECTION);
    await config.update(
      "maxHistoryDisplay",
      10,
      vscode.ConfigurationTarget.Global,
    );

    const config2 = vscode.workspace.getConfiguration(SECTION);
    assert.strictEqual(config2.get<number>("maxHistoryDisplay"), 10);
  });

  test("historySortBy updates and reads back", async () => {
    const config = vscode.workspace.getConfiguration(SECTION);
    await config.update(
      "historySortBy",
      "recent",
      vscode.ConfigurationTarget.Global,
    );

    const config2 = vscode.workspace.getConfiguration(SECTION);
    assert.strictEqual(config2.get<string>("historySortBy"), "recent");
  });
});

suite("TextDocumentContentProvider", () => {
  test("quick-inline URI content provider returns content", async () => {
    const uri = vscode.Uri.parse("quick-inline://test/2/test.ts");
    const doc = await vscode.workspace.openTextDocument(uri);
    assert.strictEqual(typeof doc.getText(), "string");
  });
});

suite("Extension manifest", () => {
  const pkg = require("../../package.json");

  test("has expected metadata", () => {
    assert.strictEqual(pkg.name, "quick-inline-suggestion");
    assert.strictEqual(pkg.publisher, "MingyangBao");
    assert.ok(pkg.version, "version should be set");
    assert.ok(pkg.engines.vscode, "vscode engine should be specified");
  });

  test("contributes 3 commands", () => {
    assert.ok(
      Array.isArray(pkg.contributes.commands),
      "commands should be an array",
    );
    assert.strictEqual(pkg.contributes.commands.length, 3);
  });

  test("contributes keybindings", () => {
    const bindings: any[] = pkg.contributes.keybindings;
    assert.ok(Array.isArray(bindings));
    assert.ok(bindings.length >= 2);
    const keys = bindings.map((b: any) => b.key);
    assert.ok(keys.includes("ctrl+i"));
    assert.ok(keys.includes("ctrl+shift+i"));
  });

  test("contributes 5 configuration properties", () => {
    const props = pkg.contributes.configuration.properties;
    assert.ok(props);
    assert.strictEqual(Object.keys(props).length, 5);
    assert.ok("quick-inline-suggestion.backend" in props);
    assert.ok("quick-inline-suggestion.maxHistoryDisplay" in props);
    assert.ok("quick-inline-suggestion.historySortBy" in props);
    assert.ok("quick-inline-suggestion.claudeModel" in props);
    assert.ok("quick-inline-suggestion.codexModel" in props);
  });
});
