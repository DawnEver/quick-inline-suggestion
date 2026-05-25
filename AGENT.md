# Agent Integration Design

## Overview

This extension uses AI CLI tools as headless subprocess agents. The user selects code, types an instruction (`Cmd+I`), and the agent returns a modified version shown as a diff.

## Backends

| Backend | Command | Output extraction |
|---|---|---|
| **Claude Code** | `claude -p --output-format text` | stdout |
| **OpenAI Codex** | `codex exec --output-last-message <tmpfile>` | temp file |

Both backends receive the prompt via stdin to avoid arg-length limits, shell injection, and ps leakage.

## Why headless CLI (not direct API)

| Approach | Verdict |
|---|---|
| Direct API | Fastest, but bypasses the agent's context gathering — defeats the purpose |
| **Headless CLI** | **Chosen.** Reliable, scriptable, full agent capability |
| Terminal injection (`sendText`) | Broken — TUI handles programmatic input differently from keystrokes |

### Claude backend

```typescript
spawn("claude", ["-p", "--output-format", "text"], { cwd: workspaceRoot })
```

- `--output-format text` — plain text response, parsed for the code block
- `cwd` set to workspace root so Claude sees the full project context

### Codex backend

```typescript
spawn("codex", ["exec", "--output-last-message", tmpFile], { cwd: workspaceRoot })
```

- `--output-last-message` writes the agent's last message to a temp file for clean extraction
- Codex writes session metadata (headers, model info, token usage) to stderr — we discard it
- The temp file is read after the process exits and immediately cleaned up

## Prompt design

The prompt template constrains the agent to return only modified code, no explanation:

```
Only return the modified code wrapped in a single ```code block. No explanation, no surrounding text.
File: ${fileName}
Selected code:
${selectedText}
Instruction: ${instruction}
```

This keeps responses short and deterministic — suitable for inline edit UX where a paragraph of reasoning would be noise.

For explanation mode (detected via heuristics: ends with `?`, starts with what/why/how/explain/etc.), a more open-ended prompt is used and the response is opened in a new untitled document.

## Response handling

1. Raw response captured from subprocess (stdout for Claude, temp file for Codex)
2. `extractCodeBlock()` regex extracts the fenced code block; falls back to raw text
3. `WorkspaceEdit.replace()` applies the change directly
4. `vscode.diff` shows original vs. modified for review

## Configuration

The backend is selected via the VS Code setting `quick-inline-suggestion.backend` (`"claude"` or `"codex"`).


## Workflow

After implementing any feature or fix, run:

```
yarn run package
```

This compiles TypeScript and packages the extension into `dist/quick-inline-suggestion-x.x.x.vsix`. Do not report the task complete until the build succeeds.

When releasing a new version, bump the version first:

```
node scripts/bump-version.mjs <version>   # e.g. 0.0.3
```

Or via npm: `npm run bump <version>`. This updates `package.json` (and `package-lock.json` if present). Then run `yarn run package` to produce the new `.vsix`.
