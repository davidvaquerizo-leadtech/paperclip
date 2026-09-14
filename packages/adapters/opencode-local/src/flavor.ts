/**
 * OpenCode-family flavor seam.
 *
 * `opencode_local` and `kilocode_local` share one runtime contract: an
 * OpenCode-derived CLI that runs `<cmd> run --format json`, resumes with
 * `--session`, lists models with `<cmd> models`, and reads an XDG config
 * directory. The two CLIs differ only in names: binary, env var prefixes,
 * config paths, skills home, and install command. A flavor captures those
 * differences so the shared execute/test/models/skills code stays in one
 * place instead of being copied per CLI.
 *
 * Keep this module dependency-free. The root `index.ts` re-exports it for the
 * UI and CLI bundles.
 */
export interface OpenCodeFlavor {
  /** Paperclip adapter type, e.g. `opencode_local`. */
  adapterType: string;
  /** Short key used for runtime asset directories on remote targets. */
  adapterKey: string;
  /** Human-readable product name used in logs and diagnostics. */
  productName: string;
  /** Default CLI binary name when `adapterConfig.command` is unset. */
  defaultCommand: string;
  /** Process env var that overrides the default CLI binary for discovery. */
  commandEnvVar: string;
  /** Subdirectory of `XDG_CONFIG_HOME` that holds the CLI config. */
  configDirName: string;
  /** Config file name inside `configDirName`. */
  configFileName: string;
  /** Env var the CLI honors to skip project-level config files. */
  disableProjectConfigEnvVar: string;
  /** Env var that lets a run bypass the `models` availability probe. */
  allowAllModelsEnvVar: string;
  /** Env var that adds `--print-logs` to every run. */
  printLogsEnvVar: string;
  /** Env var carrying a JSON `provider` block merged into the runtime config. */
  providersEnvVar: string;
  /** Env var that pins the CLI's auxiliary `small_model`. */
  smallModelEnvVar: string;
  /**
   * Extra `run` args added when `dangerouslySkipPermissions` is enabled.
   * Kilo needs `--auto` for unattended runs; OpenCode needs none.
   */
  headlessPermissionArgs: readonly string[];
  /** Shell command that installs the CLI inside a sandbox. */
  sandboxInstallCommand: string;
  /** Path segments under `$HOME` where Paperclip links runtime skills. */
  skillsHomeSegments: readonly string[];
  /** Display label for the skills home, e.g. `~/.claude/skills`. */
  skillsHomeLabel: string;
  /** Prefix for environment-test check codes, e.g. `opencode`. */
  checkCodePrefix: string;
  /** Prefix for console warnings, e.g. `[opencode-local]`. */
  logPrefix: string;
  /** Command the operator runs to authenticate providers. */
  authLoginCommand: string;
  /** Temp-dir prefix for the injected runtime config home. */
  runtimeConfigTmpPrefix: string;
}

// Use OpenCode's official installer instead of `npm install -g opencode-ai`.
// The npm package reifies four large Linux x64 prebuilt-binary subpackages
// (linux-x64, linux-x64-musl, linux-x64-baseline, linux-x64-baseline-musl) in
// parallel even though only one matches the sandbox; on bandwidth-constrained
// sandboxes (e.g. Cloudflare) that exceeded the 240s install budget. The
// official installer fetches a single arch-specific binary into
// `$HOME/.opencode/bin` and tries to add it to PATH via `~/.bashrc`. That
// rc-file path is only sourced by interactive/login shells, so non-login
// `sh -c` probe invocations (used by the runtime PATH check) cannot find the
// binary. We fix that by symlinking the installed binary into a directory on
// the non-login `sh -c` PATH: prefer `/usr/local/bin` (universally on the
// default PATH on Linux distros) when root or passwordless sudo is available,
// otherwise fall back to `$HOME/.local/bin` (which is on the default PATH on
// the exe.dev sandbox image and most modern home-managed Linux images).
//
// Security tradeoff: this is `curl | bash` without a SHA-256 verification of
// the install script. We accept this because:
//   1. The install runs inside an isolated, ephemeral sandbox — blast radius
//      is bounded to that sandbox's secrets and disk.
//   2. The prior `npm install -g opencode-ai` is also unverified code
//      execution from a third-party registry; this is not strictly worse.
//   3. OpenCode does not publish per-release SHA-256 checksums in a stable
//      location, and pinning a version + hash here would require manual
//      version bumps on every OpenCode release.
// The `set -e` (implied by Bash's default with `-fsSL` upstream of a piped
// shell) and `curl -fsSL` give us fail-fast behavior on HTTP errors. If
// OpenCode starts publishing a stable checksum/signature, switch to fetching
// a versioned tarball + verifying the digest before exec.
export const OPENCODE_SANDBOX_INSTALL_COMMAND =
  'curl -fsSL https://opencode.ai/install | bash && ' +
  'if [ -x "$HOME/.opencode/bin/opencode" ]; then ' +
  'if [ "$(id -u)" -eq 0 ]; then ' +
  'ln -sf "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode; ' +
  'elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then ' +
  'sudo ln -sf "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode; ' +
  'else ' +
  'mkdir -p "$HOME/.local/bin" && ' +
  'ln -sf "$HOME/.opencode/bin/opencode" "$HOME/.local/bin/opencode"; ' +
  'fi; ' +
  'fi';

export const OPENCODE_FLAVOR: OpenCodeFlavor = {
  adapterType: "opencode_local",
  adapterKey: "opencode",
  productName: "OpenCode",
  defaultCommand: "opencode",
  commandEnvVar: "PAPERCLIP_OPENCODE_COMMAND",
  configDirName: "opencode",
  configFileName: "opencode.json",
  disableProjectConfigEnvVar: "OPENCODE_DISABLE_PROJECT_CONFIG",
  allowAllModelsEnvVar: "OPENCODE_ALLOW_ALL_MODELS",
  printLogsEnvVar: "PAPERCLIP_OPENCODE_PRINT_LOGS",
  providersEnvVar: "PAPERCLIP_OPENCODE_PROVIDERS",
  smallModelEnvVar: "PAPERCLIP_OPENCODE_SMALL_MODEL",
  headlessPermissionArgs: [],
  sandboxInstallCommand: OPENCODE_SANDBOX_INSTALL_COMMAND,
  skillsHomeSegments: [".claude", "skills"],
  skillsHomeLabel: "~/.claude/skills",
  checkCodePrefix: "opencode",
  logPrefix: "[opencode-local]",
  authLoginCommand: "opencode auth login",
  runtimeConfigTmpPrefix: "paperclip-opencode-config-",
};

/** Validate a `provider/model` id: non-empty on both sides of the first `/`. */
export function isValidOpenCodeFamilyModelId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  const slashIndex = trimmed.indexOf("/");
  return Boolean(trimmed) && slashIndex > 0 && slashIndex !== trimmed.length - 1;
}
