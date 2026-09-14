import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import type { AdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  parseObject,
  ensurePathInEnv,
} from "@paperclipai/adapter-utils/server-utils";
import {
  ensureAdapterExecutionTargetCommandResolvable,
  maybeRunSandboxInstallCommand,
  ensureAdapterExecutionTargetDirectory,
  runAdapterExecutionTargetProcess,
  describeAdapterExecutionTarget,
  resolveAdapterExecutionTargetCwd,
  prepareAdapterExecutionTargetRuntime,
  overrideAdapterExecutionTargetRemoteCwd,
} from "@paperclipai/adapter-utils/execution-target";
import { createOpenCodeModelsApi } from "./models.js";
import { parseOpenCodeJsonl } from "./parse.js";
import { OPENCODE_FLAVOR, type OpenCodeFlavor } from "../flavor.js";
import { prepareOpenCodeRuntimeConfig, prepareManagedOpenCodeRemoteHomes } from "./runtime-config.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function summarizeProbeDetail(stdout: string, stderr: string, parsedError: string | null): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function normalizeEnv(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAuthRequiredRegExp(flavor: OpenCodeFlavor): RegExp {
  const loginCommand = flavor.authLoginCommand.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  // Kilo Gateway answers unauthenticated paid-model calls with
  // `Unauthorized: {"error":{"code":"PAID_MODEL_AUTH_REQUIRED","message":"You need to sign in ..."}}`,
  // so also treat "sign in", "unauthorized", and *_AUTH_REQUIRED codes as auth evidence.
  return new RegExp(
    `(?:auth(?:entication)?\\s+required|_AUTH_REQUIRED|unauthori[sz]ed|sign\\s+in|api\\s*key|invalid\\s*api\\s*key|not\\s+logged\\s+in|${loginCommand}|free\\s+usage\\s+exceeded)`,
    "i",
  );
}

/** Build the environment diagnostics function for one OpenCode-family flavor. */
export function createTestEnvironment(
  flavor: OpenCodeFlavor,
): (ctx: AdapterEnvironmentTestContext) => Promise<AdapterEnvironmentTestResult> {
  const modelsApi = createOpenCodeModelsApi(flavor);
  const authRequiredRe = buildAuthRequiredRegExp(flavor);
  const code = (suffix: string) => `${flavor.checkCodePrefix}_${suffix}`;
  const name = flavor.productName;
  const cmd = flavor.defaultCommand;

  return async function testEnvironment(
    ctx: AdapterEnvironmentTestContext,
  ): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, flavor.defaultCommand);
  const target = ctx.executionTarget ?? null;
  const targetIsRemote = target?.kind === "remote";
  const targetIsSandbox = target?.kind === "remote" && target.transport === "sandbox";
  const cwd = resolveAdapterExecutionTargetCwd(target, asString(config.cwd, ""), process.cwd());
  const targetLabel = targetIsRemote
    ? ctx.environmentName ?? describeAdapterExecutionTarget(target)
    : null;
  const runId = `${flavor.adapterKey}-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (targetLabel) {
    checks.push({
      code: code("environment_target"),
      level: "info",
      message: `Probing inside environment: ${targetLabel}`,
    });
  }

  try {
    await ensureAdapterExecutionTargetDirectory(runId, target, cwd, {
      cwd,
      env: {},
      createIfMissing: false,
    });
    checks.push({
      code: code("cwd_valid"),
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: code("cwd_invalid"),
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  const openaiKeyOverride = "OPENAI_API_KEY" in envConfig ? asString(envConfig.OPENAI_API_KEY, "") : null;
  if (!config.managedAiConnection && openaiKeyOverride !== null && openaiKeyOverride.trim() === "") {
    checks.push({
      code: code("openai_api_key_missing"),
      level: "warn",
      message: "OPENAI_API_KEY override is empty.",
      hint: "The OPENAI_API_KEY override is empty. Set a valid key or remove the override.",
    });
  }

  // Prevent OpenCode from writing an opencode.json into the working directory.
  env[flavor.disableProjectConfigEnvVar] = "true";
  const preparedRuntimeConfig = await prepareOpenCodeRuntimeConfig({ env, config, flavor });
  const localRuntimeConfigHome =
    preparedRuntimeConfig.notes.length > 0 ? preparedRuntimeConfig.env.XDG_CONFIG_HOME : "";
  if (asBoolean(config.dangerouslySkipPermissions, true)) {
    checks.push({
      code: code("headless_permissions_enabled"),
      level: "info",
      message: `Headless ${name} external-directory permissions are auto-approved for unattended runs.`,
    });
  }
  let restoreWorkspace: (() => Promise<void>) | null = null;
  // Declared outside `try` so a failure inside `prepareAdapterExecutionTargetRuntime`
  // still has the path available for cleanup in `finally` — otherwise the
  // `fs.mkdtemp` directory leaks on the early-throw path.
  let preparedRuntimeWorkspaceLocalDir: string | null = null;
  try {
    let runtimeTarget: AdapterExecutionTarget | null = target ?? null;
    let runtimeCwd = cwd;
    if (targetIsRemote) {
      preparedRuntimeWorkspaceLocalDir = await fs.mkdtemp(path.join(os.tmpdir(), `paperclip-${flavor.adapterKey}-envtest-${runId}-`));
      const preparedExecutionTargetRuntime = await prepareAdapterExecutionTargetRuntime({
        runId,
        target,
        adapterKey: flavor.adapterKey,
        workspaceLocalDir: preparedRuntimeWorkspaceLocalDir,
        workspaceRemoteDir: cwd,
        installCommand: flavor.sandboxInstallCommand,
        detectCommand: command,
        assets: localRuntimeConfigHome
          ? [{
            key: "xdgConfig",
            localDir: localRuntimeConfigHome,
          }]
          : [],
      });
      restoreWorkspace = async () => {
        await preparedExecutionTargetRuntime.restoreWorkspace().catch(() => {});
        if (preparedRuntimeWorkspaceLocalDir) {
          await fs.rm(preparedRuntimeWorkspaceLocalDir, { recursive: true, force: true }).catch(() => {});
        }
      };
      runtimeCwd = preparedExecutionTargetRuntime.workspaceRemoteDir ?? runtimeCwd;
      runtimeTarget = overrideAdapterExecutionTargetRemoteCwd(target ?? null, runtimeCwd) ?? null;
      if (localRuntimeConfigHome && preparedExecutionTargetRuntime.assetDirs.xdgConfig) {
        preparedRuntimeConfig.env.XDG_CONFIG_HOME = preparedExecutionTargetRuntime.assetDirs.xdgConfig;
      }
      prepareManagedOpenCodeRemoteHomes({
        env: preparedRuntimeConfig.env,
        config,
        runtimeRootDir: preparedExecutionTargetRuntime.runtimeRootDir,
        runId,
        configDir: preparedExecutionTargetRuntime.assetDirs.xdgConfig,
      });
    }
    const runtimeEnv = normalizeEnv(ensurePathInEnv({ ...process.env, ...preparedRuntimeConfig.env }));

    const cwdInvalid = checks.some((check) => check.code === code("cwd_invalid"));
    if (cwdInvalid) {
      checks.push({
        code: code("command_skipped"),
        level: "warn",
        message: "Skipped command check because working directory validation failed.",
        detail: command,
      });
    } else {
      const installCheck = await maybeRunSandboxInstallCommand({
        runId,
        target,
        adapterKey: flavor.adapterKey,
        installCommand: flavor.sandboxInstallCommand,
        detectCommand: command,
        env,
      });
      if (installCheck) checks.push(installCheck);
      try {
        await ensureAdapterExecutionTargetCommandResolvable(command, runtimeTarget, runtimeCwd, runtimeEnv);
        checks.push({
          code: code("command_resolvable"),
          level: "info",
          message: `Command is executable: ${command}`,
        });
      } catch (err) {
        checks.push({
          code: code("command_unresolvable"),
          level: "error",
          message: err instanceof Error ? err.message : "Command is not executable",
          detail: command,
        });
      }
    }

    const canRunProbe =
      checks.every((check) => check.code !== code("cwd_invalid") && check.code !== code("command_unresolvable"));

    let modelValidationPassed = false;
    const configuredModel = asString(config.model, "").trim();

    // Model discovery and validation use local child processes against
    // OpenCode's `models` subcommand and JSON config; these are not yet
    // wired through the execution target. When probing a remote env, skip
    // discovery/validation and rely on the remote hello probe to surface
    // model/auth issues directly.
    if (targetIsRemote && configuredModel) {
      checks.push({
        code: code("model_validation_skipped_remote"),
        level: "info",
        message: `Skipped local model validation; will be validated by the hello probe inside ${targetLabel}.`,
      });
      modelValidationPassed = true;
    } else if (canRunProbe && configuredModel) {
      try {
        const discovered = await modelsApi.discoverModels({ command, cwd, env: runtimeEnv });
        if (discovered.length > 0) {
          checks.push({
            code: code("models_discovered"),
            level: "info",
            message: `Discovered ${discovered.length} model(s) from ${name} providers.`,
          });
        } else {
          checks.push({
            code: code("models_empty"),
            level: "error",
            message: `${name} returned no models.`,
            hint: `Run \`${cmd} models\` and verify provider authentication.`,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (/ProviderModelNotFoundError/i.test(errMsg)) {
          checks.push({
            code: code("hello_probe_model_unavailable"),
            level: "warn",
            message: "The configured model was not found by the provider.",
            detail: errMsg,
            hint: `Run \`${cmd} models\` and choose an available provider/model ID.`,
          });
        } else {
          checks.push({
            code: code("models_discovery_failed"),
            level: "error",
            message: errMsg || `${name} model discovery failed.`,
            hint: `Run \`${cmd} models\` manually to verify provider auth and config.`,
          });
        }
      }
    } else if (!targetIsRemote && canRunProbe && !configuredModel) {
      try {
        const discovered = await modelsApi.discoverModels({ command, cwd, env: runtimeEnv });
        if (discovered.length > 0) {
          checks.push({
            code: code("models_discovered"),
            level: "info",
            message: `Discovered ${discovered.length} model(s) from ${name} providers.`,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (/ProviderModelNotFoundError/i.test(errMsg)) {
          checks.push({
            code: code("hello_probe_model_unavailable"),
            level: "warn",
            message: "The configured model was not found by the provider.",
            detail: errMsg,
            hint: `Run \`${cmd} models\` and choose an available provider/model ID.`,
          });
        } else {
          checks.push({
            code: code("models_discovery_failed"),
            level: "warn",
            message: errMsg || `${name} model discovery failed (best-effort, no model configured).`,
            hint: `Run \`${cmd} models\` manually to verify provider auth and config.`,
          });
        }
      }
    }

    const modelUnavailable = checks.some((check) => check.code === code("hello_probe_model_unavailable"));
    if (!configuredModel && !modelUnavailable) {
      // No model configured – skip model requirement if no model-related checks exist
    } else if (!targetIsRemote && configuredModel && canRunProbe) {
      try {
        await modelsApi.ensureModelConfiguredAndAvailable({
          model: configuredModel,
          command,
          cwd,
          env: runtimeEnv,
        });
        checks.push({
          code: code("model_configured"),
          level: "info",
          message: `Configured model: ${configuredModel}`,
        });
        modelValidationPassed = true;
      } catch (err) {
        checks.push({
          code: code("model_invalid"),
          level: "error",
          message: err instanceof Error ? err.message : "Configured model is unavailable.",
          hint: `Run \`${cmd} models\` and choose a currently available provider/model ID.`,
        });
      }
    }

    if (canRunProbe && modelValidationPassed) {
      const extraArgs = (() => {
        const fromExtraArgs = asStringArray(config.extraArgs);
        if (fromExtraArgs.length > 0) return fromExtraArgs;
        return asStringArray(config.args);
      })();
      const variant = asString(config.variant, "").trim();
      const probeModel = configuredModel;

      const args = ["run", "--format", "json"];
      if (asBoolean(config.dangerouslySkipPermissions, true)) args.push(...flavor.headlessPermissionArgs);
      args.push("--model", probeModel);
      if (variant) args.push("--variant", variant);
      if (extraArgs.length > 0) args.push(...extraArgs);

      // Sandbox bridges still add cold-start and transport overhead, but the
      // standard-2 Cloudflare tier now probes quickly enough that 90s keeps
      // useful headroom without letting slow hangs linger.
      const helloProbeTimeoutSec = Math.max(
        1,
        asNumber(config.helloProbeTimeoutSec, targetIsSandbox ? 90 : 60),
      );

      try {
        const probe = await runAdapterExecutionTargetProcess(
          runId,
          runtimeTarget,
          command,
          args,
          {
            cwd: runtimeCwd,
            env: runtimeEnv,
            timeoutSec: helloProbeTimeoutSec,
            graceSec: 5,
            stdin: "Respond with hello.",
            onLog: async () => {},
          },
        );

        const parsed = parseOpenCodeJsonl(probe.stdout);
        const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errorMessage);
        const authEvidence = `${parsed.errorMessage ?? ""}\n${probe.stdout}\n${probe.stderr}`.trim();

        if (probe.timedOut) {
          checks.push({
            code: code("hello_probe_timed_out"),
            level: "warn",
            message: `${name} hello probe timed out.`,
            hint: `Retry the probe. If this persists, run ${name} manually in this working directory.`,
          });
        } else if ((probe.exitCode ?? 1) === 0 && !parsed.errorMessage) {
          const summary = parsed.summary.trim();
          const hasHello = /\bhello\b/i.test(summary);
          checks.push({
            code: hasHello ? code("hello_probe_passed") : code("hello_probe_unexpected_output"),
            level: hasHello ? "info" : "warn",
            message: hasHello
              ? `${name} hello probe succeeded.`
              : `${name} probe ran but did not return \`hello\` as expected.`,
            ...(summary ? { detail: summary.replace(/\s+/g, " ").trim().slice(0, 240) } : {}),
            ...(hasHello
              ? {}
              : {
                  hint: `Run \`${cmd} run --format json\` manually and prompt \`Respond with hello\` to inspect output.`,
                }),
          });
        } else if (/ProviderModelNotFoundError/i.test(authEvidence)) {
          checks.push({
            code: code("hello_probe_model_unavailable"),
            level: "warn",
            message: "The configured model was not found by the provider.",
            ...(detail ? { detail } : {}),
            hint: `Run \`${cmd} models\` and choose an available provider/model ID.`,
          });
        } else if (authRequiredRe.test(authEvidence)) {
          checks.push({
            code: code("hello_probe_auth_required"),
            level: "warn",
            message: `${name} is installed, but provider authentication is not ready.`,
            ...(detail ? { detail } : {}),
            hint: `Run \`${flavor.authLoginCommand}\` or set provider credentials, then retry the probe.`,
          });
        } else {
          checks.push({
            code: code("hello_probe_failed"),
            level: "error",
            message: `${name} hello probe failed.`,
            ...(detail ? { detail } : {}),
            hint: `Run \`${cmd} run --format json\` manually in this working directory to debug.`,
          });
        }
      } catch (err) {
        checks.push({
          code: code("hello_probe_failed"),
          level: "error",
          message: `${name} hello probe failed.`,
          detail: err instanceof Error ? err.message : String(err),
          hint: `Run \`${cmd} run --format json\` manually in this working directory to debug.`,
        });
      }
    }
  } finally {
    await restoreWorkspace?.();
    if (!restoreWorkspace && preparedRuntimeWorkspaceLocalDir) {
      // Reached when `prepareAdapterExecutionTargetRuntime` threw before
      // assigning `restoreWorkspace`: clean up the temp dir directly.
      await fs.rm(preparedRuntimeWorkspaceLocalDir, { recursive: true, force: true }).catch(() => {});
    }
    await preparedRuntimeConfig.cleanup();
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
  };
}

export const testEnvironment = createTestEnvironment(OPENCODE_FLAVOR);
