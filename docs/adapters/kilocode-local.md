---
title: Kilo Code CLI
summary: Kilo Code CLI local adapter setup and configuration
---

The `kilocode_local` adapter runs the Kilo Code CLI (`kilo`) locally. Kilo Code is an OpenCode fork, so the adapter shares the OpenCode runtime contract: `kilo run --format json`, session resume with `--session`, model discovery with `kilo models`, and `provider/model` model ids. The adapter is a thin flavor of `opencode_local`; only names differ (binary, env vars, config paths, skills home, and the `--auto` flag for unattended runs).

## Prerequisites

- Kilo Code CLI installed (`kilo` command available; npm package `@kilocode/cli`)
- Authentication configured via one of:
  - `kilo auth login` (credentials stored in `~/.local/share/kilo/auth.json`)
  - `KILO_API_KEY` in the adapter env or server shell (Kilo Gateway)
  - A provider block in `~/.config/kilo/kilo.json` with a vendor API key

## Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | string | No | Working directory for the agent process (absolute path; created automatically if missing when permissions allow) |
| `model` | string | Yes | Model id in `provider/model` format. Kilo Gateway aliases look like `kilo/~anthropic/claude-sonnet-latest`. Defaults to `kilo/~anthropic/claude-sonnet-latest` when the form leaves it empty. |
| `variant` | string | No | Provider-specific reasoning variant passed as `--variant` (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`) |
| `dangerouslySkipPermissions` | boolean | No | Defaults to `true`. Adds `--auto` to the run and injects a runtime config with `permission.external_directory=allow` so headless runs do not stall on prompts. |
| `promptTemplate` | string | No | Prompt used for all runs |
| `instructionsFilePath` | string | No | Markdown instructions file prepended to the prompt |
| `command` | string | No | CLI command override. Defaults to `kilo`. |
| `extraArgs` | string[] | No | Additional CLI arguments appended to every run |
| `env` | object | No | Environment variables (supports secret refs) |
| `timeoutSec` | number | No | Process timeout (0 = no timeout) |
| `graceSec` | number | No | Grace period before force-kill |

## Headless Execution

Runs execute as `kilo run --format json --auto --model <model> [--variant <variant>] [--session <id>]`. The prompt is passed on stdin. The adapter sets `KILO_DISABLE_PROJECT_CONFIG=true` so Kilo does not read or write a project config in the working directory. Model selection always comes from the `--model` flag.

When `dangerouslySkipPermissions` is enabled (the default), the adapter copies `~/.config/kilo` into a temporary `XDG_CONFIG_HOME`, writes `kilo/kilo.json` with `permission.external_directory=allow`, and removes the copy after the run. Set `dangerouslySkipPermissions: false` to run without `--auto` and without the injected config.

## Model Validation

Before a run, the adapter calls `kilo models` and checks that the configured model is listed. The probe is best effort: a probe that cannot run does not block the run. To skip the probe for gateway-routed models that the catalog does not list, set `KILO_ALLOW_ALL_MODELS=1` in the adapter env.

Kilo Gateway models carry a nested slash (`kilo/~anthropic/claude-sonnet-latest`). The provider is the part before the first slash (`kilo`), and the model is the rest.

## Session Persistence

The adapter captures the Kilo session id from the JSON event stream and persists it between heartbeats. On the next wake it resumes with `--session <id>` when the working directory still matches. When Kilo reports `Session not found`, the adapter retries once with a fresh session.

## Skills

Kilo discovers skills in `~/.kilo/skills`, `~/.kilocode/skills`, `~/.config/kilo/skills`, `~/.claude/skills`, and `~/.agents/skills`, plus the same directories at project level. Paperclip links desired runtime skills into `~/.kilo/skills` so it does not write into the shared Claude home. The "Skills" tab lists and syncs skills from that location.

## Environment Test

Use the "Test Environment" button in the UI to validate the adapter config. It checks:

- Working directory is absolute and available
- The `kilo` command is executable
- `kilo models` returns a catalog and the configured model is present
- A live hello probe (`kilo run --format json --auto --model <model>`) to verify CLI readiness and provider auth

Check codes use the `kilocode_` prefix (for example `kilocode_cwd_invalid`, `kilocode_hello_probe_auth_required`).

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `PAPERCLIP_KILOCODE_COMMAND` | Overrides the `kilo` binary used for model discovery when `command` is unset |
| `KILO_ALLOW_ALL_MODELS` | Skips the `kilo models` availability probe |
| `PAPERCLIP_KILOCODE_PRINT_LOGS` | Adds `--print-logs` so Kilo writes its own logs to stderr |
| `PAPERCLIP_KILOCODE_PROVIDERS` | JSON `provider` block merged into the injected runtime config |
| `PAPERCLIP_KILOCODE_SMALL_MODEL` | Pins Kilo's auxiliary `small_model` in the injected runtime config |

## Notes

- The adapter reuses the OpenCode transcript parser and CLI event formatter. Kilo emits the same `run --format json` event stream.
- `kilo acp` exists, but this adapter uses the headless `run` lane. An ACP lane can follow the same pattern as `kimi_local` later.
