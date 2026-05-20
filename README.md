# Quick Inline Suggestion

VS Code extension that brings AI-powered code editing into your editor — select code, hit `Cmd+I`, describe the change, review the diff.

Supports [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [OpenAI Codex CLI](https://github.com/openai/codex) as backends.

## Motivation

Recently, VS Code's built-in AI features have become increasingly bulky. I only wanted the simple inline suggestion workflow from VS Code Copilot: select code, ask for a change, review it, and apply it. So I built this plugin together with Claude Code to keep that experience lightweight and focused.

## Features

- **Inline edit** — `Cmd+I` opens an input box, describe what you want, AI returns the modified code
- **Diff preview** — review changes side-by-side before applying
- **WorkspaceEdit apply** — accepted changes are applied via VS Code's native edit API, keeping undo history intact
- **Project-aware** — the AI agent runs with the workspace as `cwd`, so it sees your full project context
- **Question mode** — ask "what does this do?" and get an explanation in a new document
- **Configurable backend** — switch between Claude Code and Codex CLI in settings

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude --version`) or [OpenAI Codex CLI](https://github.com/openai/codex) (`codex --version`)
- VS Code ^1.85.0

## Usage

1. Select code in the editor (or place cursor — empty selection sends the whole file)
2. Press `Cmd+I` (macOS) / `Ctrl+I` (Windows/Linux) — `Cmd+Shift+I` / `Ctrl+Shift+I` as fallback
3. Type what you want (e.g. "convert to async/await", "add error handling", "what does this function do?")
4. For edits: review the diff. For questions: read the explanation in the new document.

### Keybinding conflicts

Official GitHub Copilot and some other extensions also bind `Ctrl+I`. If the shortcut doesn't work, use `Ctrl+Shift+I` or run **Quick: Inline Edit** from the command palette.

## Extension Settings

- `quick-inline-suggestion.backend`: Choose the AI backend — `claude` (Claude Code, default) or `codex` (OpenAI Codex CLI)

## Installation
Search `Quick Inline Suggestion` or download from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=MingyangBao.quick-inline-suggestion).


## Architecture

```
Cmd+I → InputBox (instruction) → spawn AI CLI → extract code block → vscode.diff → WorkspaceEdit
```

- [CLAUDE.md](CLAUDE.md) — project instructions
- [AGENT.md](AGENT.md) — agent integration design and rationale

## Reference

- [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code)
- [OpenAI Codex CLI](https://github.com/openai/codex)
- [VS Code Extension API](https://code.visualstudio.com/api)
