import { buildSandboxNpmInstallCommand } from "@paperclipai/adapter-utils";
import {
  isValidOpenCodeFamilyModelId,
  type OpenCodeFlavor,
} from "@paperclipai/adapter-opencode-local";

export const type = "kilocode_local";
export const label = "Kilo Code";

export const SANDBOX_INSTALL_COMMAND = buildSandboxNpmInstallCommand("@kilocode/cli");

/**
 * Kilo Code CLI is an OpenCode fork. It keeps the OpenCode-family runtime
 * contract (`kilo run --format json`, `--session`, `--model provider/model`,
 * `kilo models`) and differs only in names: binary, env var prefix, config
 * paths, skills home, and the `--auto` flag for unattended permission grants.
 * Everything else is shared with `opencode_local` through this flavor.
 */
export const KILOCODE_FLAVOR: OpenCodeFlavor = {
  adapterType: type,
  adapterKey: "kilocode",
  productName: "Kilo Code",
  defaultCommand: "kilo",
  commandEnvVar: "PAPERCLIP_KILOCODE_COMMAND",
  configDirName: "kilo",
  configFileName: "kilo.json",
  disableProjectConfigEnvVar: "KILO_DISABLE_PROJECT_CONFIG",
  allowAllModelsEnvVar: "KILO_ALLOW_ALL_MODELS",
  printLogsEnvVar: "PAPERCLIP_KILOCODE_PRINT_LOGS",
  providersEnvVar: "PAPERCLIP_KILOCODE_PROVIDERS",
  smallModelEnvVar: "PAPERCLIP_KILOCODE_SMALL_MODEL",
  // `kilo run --auto` approves tool permissions that the config does not deny.
  // Without it a headless run stalls on the first permission prompt.
  headlessPermissionArgs: ["--auto"],
  sandboxInstallCommand: SANDBOX_INSTALL_COMMAND,
  // Kilo discovers skills in `~/.kilo/skills` (and `~/.claude/skills`). Use the
  // Kilo-native home so Paperclip does not write into the shared Claude home.
  skillsHomeSegments: [".kilo", "skills"],
  skillsHomeLabel: "~/.kilo/skills",
  checkCodePrefix: "kilocode",
  logPrefix: "[kilocode-local]",
  authLoginCommand: "kilo auth login",
  runtimeConfigTmpPrefix: "paperclip-kilocode-config-",
};

// Kilo Gateway rolling aliases. `kilo models` lists them as
// `kilo/~<vendor>/<model>-latest`; the `kilo/` provider routes through the
// Kilo subscription, so no per-vendor API key is needed.
export const DEFAULT_KILOCODE_LOCAL_MODEL = "kilo/~anthropic/claude-sonnet-latest";

export function isValidKiloCodeModelId(value: unknown): value is string {
  return isValidOpenCodeFamilyModelId(value);
}

export const models: Array<{ id: string; label: string }> = [
  { id: DEFAULT_KILOCODE_LOCAL_MODEL, label: "Kilo · Claude Sonnet (latest)" },
  { id: "kilo/~anthropic/claude-opus-latest", label: "Kilo · Claude Opus (latest)" },
  { id: "kilo/~anthropic/claude-haiku-latest", label: "Kilo · Claude Haiku (latest)" },
  { id: "kilo/~openai/gpt-mini-latest", label: "Kilo · GPT mini (latest)" },
  { id: "kilo/~google/gemini-pro-latest", label: "Kilo · Gemini Pro (latest)" },
  { id: "kilo/~google/gemini-flash-latest", label: "Kilo · Gemini Flash (latest)" },
  { id: "kilo/~deepseek/deepseek-pro-latest", label: "Kilo · DeepSeek Pro (latest)" },
  { id: "kilo/~x-ai/grok-latest", label: "Kilo · Grok (latest)" },
];

export const agentConfigurationDoc = `# kilocode_local agent configuration

Adapter: kilocode_local

Use when:
- You want Paperclip to run the Kilo Code CLI (\`kilo\`) locally as the agent runtime
- You want provider/model routing in OpenCode format (provider/model), including Kilo Gateway models (\`kilo/...\`)
- You want Kilo session resume across heartbeats via --session

Don't use when:
- You need webhook-style external invocation (use openclaw_gateway or http)
- You only need one-shot shell commands (use process)
- The Kilo Code CLI is not installed on the machine

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- model (string, required): Kilo model id in provider/model format (for example kilo/~anthropic/claude-sonnet-latest or anthropic/claude-sonnet-4-5)
- variant (string, optional): provider-specific reasoning/profile variant passed as --variant (for example minimal|low|medium|high|xhigh|max)
- dangerouslySkipPermissions (boolean, optional): pass \`--auto\` and inject a runtime Kilo config that allows \`external_directory\` access without interactive prompts; defaults to true for unattended Paperclip runs
- promptTemplate (string, optional): run prompt template
- command (string, optional): defaults to "kilo"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Kilo Code supports multiple providers and models. Use \`kilo models\` to list available options in provider/model format.
- Paperclip requires an explicit \`model\` value for \`kilocode_local\` agents.
- Runs are executed with: kilo run --format json --auto ...
- Sessions are resumed with --session when stored session cwd matches current cwd.
- The adapter sets KILO_DISABLE_PROJECT_CONFIG=true to prevent Kilo from reading or writing a project config file in the working directory. Model selection is passed via the --model CLI flag instead.
- Authenticate with \`kilo auth login\` or set KILO_API_KEY in env.
- Set KILO_ALLOW_ALL_MODELS=1 in env to skip the \`kilo models\` availability probe for gateway-routed models that the catalog does not list.
`;
