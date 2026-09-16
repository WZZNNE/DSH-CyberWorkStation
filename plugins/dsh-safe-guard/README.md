# dsh-safe-guard

Deny destructive shell commands at the dsh `tools/pre-execute` waterfall before they run: `rm -rf /`-class deletions, `git push --force` (without `--force-with-lease`), raw block-device writes, `mkfs`, Windows drive-root wipes/formats, `chmod -R 777 /`, fork bombs, plus configurable extra patterns.

## Install

```sh
dsh plugin --profile web add dsh-safe-guard
```

Restart dsh afterwards. As part of [DSH CyberWorkStation](https://github.com/WZZNNE/DSH-CyberWorkStation) the plugin is registered by `setup.cmd` from the repository checkout instead.

Second development of the official permission-gate shape (`docs/cookbook/extension-cookbook.md` § "A hook plugin") in the deepseek-harness repo, with the pure-rules/injection-point split recommended by dsh-handbook ch.4.

The `dsh.bundle` manifest appends this package to the profile's bundle list; its patch mounts one host row (`id: safe-guard`).

## Config

```yaml
- id: safe-guard
  name: dsh-safe-guard
  config:
    extraDenyPatterns:
      - 'curl[^|;&]*\|\s*sh'
```

Patterns are case-insensitive regex over the whole command text; an invalid pattern fails at load.

### Hot-loaded user rules (`$DSH_HOME/safe-guard.json`)

```json
{ "denyPatterns": ["curl[^|;&]*\\|\\s*sh"], "askPatterns": ["docker\\s+system\\s+prune"] }
```

Edited from the DSH Launcher Control Deck → Safety rules tab and re-read every 1.5 s. `denyPatterns` deny outright; `askPatterns` return `{ kind: 'ask' }`, so the dsh web UI asks for approval before the command runs. Invalid entries in this file are skipped (the guard never goes down because of a typo); the built-in rules and `extraDenyPatterns` are evaluated first and are unaffected.

## Guarded surfaces

`bash.command`, `pwsh.command`, `terminal_send.text`. All other tools delegate untouched. Denials return `{ kind: 'deny', reason }` and never call `next()`; every allow delegates, so downstream policy (sandbox, permission, plan mode) still runs.


## Model Experience

None, as this package registers no tool, prompt section, or injected context; a denial surfaces to the model only through the standard denied tool result produced by the tools pipeline.

### KV Cache effect

Independent: the guard adds no request content and preserves any already-reusable prefix.
