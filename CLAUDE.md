@AGENT.md

## Workflow

After implementing any feature or fix, run:

```
yarn run test:unit   # fast pure-function unit tests (no VS Code required)
yarn run test:ext    # extension integration tests inside VS Code host
yarn run package
```

Do not report the task complete until all three commands succeed.

When releasing a new version, bump the version first:

```
node scripts/bump-version.mjs <version>   # e.g. 0.0.4
```

Then run the full workflow above.

## Key implementation notes

- **QuickPick ordering**: `resolve()` must be called before `qp.hide()` in `onDidAccept`. `qp.hide()` synchronously triggers `onDidHide` which calls `qp.dispose()` — disposing before resolve corrupts VS Code's internal QuickPick state and prevents future `createQuickPick()` calls.
