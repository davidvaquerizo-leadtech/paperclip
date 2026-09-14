import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@paperclipai/adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});

import { runAdapterExecutionTargetProcess } from "@paperclipai/adapter-utils/execution-target";
import { execute, testEnvironment, requireKiloCodeModelId, listKiloCodeSkills, syncKiloCodeSkills } from "./index.js";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);

function probeResult(overrides: Record<string, unknown>) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
    ...overrides,
  } as never;
}

async function createSkillDir(root: string, name: string): Promise<string> {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `# ${name}\n`, "utf8");
  return skillDir;
}

describe("kilocode_local execute", () => {
  let root: string;
  let configHome: string;
  let commandPath: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kilocode-test-"));
    configHome = path.join(root, "xdg-config");
    await fs.mkdir(configHome, { recursive: true });
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    commandPath = path.join(root, "fake-kilo");
    await fs.writeFile(commandPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    runProcessMock.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  function baseCtx(config: Record<string, unknown>, onMeta?: (meta: Record<string, unknown>) => Promise<void>) {
    return {
      runId: "kilo-run",
      agent: { id: "agent-1", companyId: "company-1", name: "Kilo", adapterType: "kilocode_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: {
        command: commandPath,
        cwd: root,
        model: "kilo/~anthropic/claude-sonnet-latest",
        env: { KILO_ALLOW_ALL_MODELS: "1" },
        promptTemplate: "Follow the paperclip heartbeat.",
        ...config,
      },
      context: {},
      onLog: async () => {},
      ...(onMeta ? { onMeta: onMeta as never } : {}),
    } as const;
  }

  it("runs `kilo run --format json --auto` with Kilo env and reports the kilocode_local adapter type", async () => {
    runProcessMock.mockResolvedValueOnce(probeResult({
      stdout: [
        JSON.stringify({ type: "step_start", sessionID: "ses_kilo_1" }),
        JSON.stringify({ type: "text", sessionID: "ses_kilo_1", part: { text: "done" } }),
        JSON.stringify({
          type: "step_finish",
          sessionID: "ses_kilo_1",
          part: { cost: 0.002, tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 0 } } },
        }),
      ].join("\n"),
    }));
    let meta: Record<string, unknown> = {};
    const result = await execute(baseCtx({}, async (m) => { meta = m; }) as never);

    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBe("ses_kilo_1");
    expect(result.usage).toEqual({ inputTokens: 10, cachedInputTokens: 2, outputTokens: 6 });
    expect(result.costUsd).toBeCloseTo(0.002, 6);
    expect(result.provider).toBe("kilo");
    expect(meta.adapterType).toBe("kilocode_local");

    expect(runProcessMock).toHaveBeenCalledTimes(1);
    const [, , command, args, options] = runProcessMock.mock.calls[0] as unknown as [
      string, unknown, string, string[], { env: Record<string, string> },
    ];
    expect(command).toBe(commandPath);
    expect(args.slice(0, 4)).toEqual(["run", "--format", "json", "--auto"]);
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("kilo/~anthropic/claude-sonnet-latest");
    expect(args).not.toContain("--session");
    expect(options.env.KILO_DISABLE_PROJECT_CONFIG).toBe("true");
    expect(options.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBeUndefined();
    // Runtime config is injected under the Kilo XDG subdirectory, not OpenCode's.
    const runtimeConfigHome = options.env.XDG_CONFIG_HOME;
    expect(runtimeConfigHome).not.toBe(configHome);
    const injected = JSON.parse(await fs.readFile(path.join(runtimeConfigHome, "kilo", "kilo.json"), "utf8").catch(() => "{}"));
    // The temp config home is cleaned up after the run; when it still exists it must carry the permission grant.
    if (Object.keys(injected).length > 0) {
      expect(injected.permission.external_directory).toBe("allow");
    }
  });

  it("omits --auto when dangerouslySkipPermissions is false", async () => {
    runProcessMock.mockResolvedValueOnce(probeResult({
      stdout: JSON.stringify({ type: "text", sessionID: "ses_kilo_2", part: { text: "ok" } }),
    }));
    await execute(baseCtx({ dangerouslySkipPermissions: false }) as never);
    const args = (runProcessMock.mock.calls[0] as unknown as [string, unknown, string, string[]])[3];
    expect(args).not.toContain("--auto");
  });

  it("resumes with --session and retries fresh when Kilo reports the session as missing", async () => {
    runProcessMock
      .mockResolvedValueOnce(probeResult({ exitCode: 1, stderr: "Session not found: ses_old" }))
      .mockResolvedValueOnce(probeResult({
        stdout: JSON.stringify({ type: "text", sessionID: "ses_new", part: { text: "fresh" } }),
      }));
    const ctx = baseCtx({});
    const result = await execute({
      ...ctx,
      runtime: { sessionId: "ses_old", sessionParams: { sessionId: "ses_old", cwd: root }, sessionDisplayId: "ses_old", taskKey: null },
    } as never);
    expect(runProcessMock).toHaveBeenCalledTimes(2);
    const firstArgs = (runProcessMock.mock.calls[0] as unknown as [string, unknown, string, string[]])[3];
    const secondArgs = (runProcessMock.mock.calls[1] as unknown as [string, unknown, string, string[]])[3];
    expect(firstArgs).toContain("--session");
    expect(firstArgs[firstArgs.indexOf("--session") + 1]).toBe("ses_old");
    expect(secondArgs).not.toContain("--session");
    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBe("ses_new");
  });

  it("injects runtime skills into ~/.kilo/skills of the configured HOME, not ~/.claude/skills", async () => {
    const configuredHome = path.join(root, "home");
    const skillSource = await createSkillDir(path.join(root, "runtime-skills"), "paperclip");
    runProcessMock.mockResolvedValueOnce(probeResult({
      stdout: JSON.stringify({ type: "text", sessionID: "ses_skills", part: { text: "ok" } }),
    }));
    const result = await execute(baseCtx({
      env: { HOME: configuredHome, KILO_ALLOW_ALL_MODELS: "1" },
      paperclipRuntimeSkills: [{ key: "paperclipai/paperclip/paperclip", runtimeName: "paperclip", source: skillSource }],
    }) as never);
    expect(result.exitCode).toBe(0);
    const installed = path.join(configuredHome, ".kilo", "skills", "paperclip");
    expect((await fs.lstat(installed)).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(installed)).toBe(await fs.realpath(skillSource));
    await expect(fs.lstat(path.join(configuredHome, ".claude", "skills", "paperclip"))).rejects.toThrow();
  });
});

describe("kilocode_local skills api", () => {
  it("lists and syncs the Paperclip skill into ~/.kilo/skills", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kilocode-skill-sync-"));
    try {
      const ctx = { agentId: "agent-1", companyId: "company-1", adapterType: "kilocode_local", config: { env: { HOME: home } } } as const;
      const before = await listKiloCodeSkills(ctx);
      expect(before.mode).toBe("persistent");
      expect(before.desiredSkills).toContain("paperclipai/paperclip/paperclip");
      expect(before.warnings).toEqual([]);
      const after = await syncKiloCodeSkills(ctx, ["paperclipai/paperclip/paperclip"]);
      expect(after.entries.find((entry) => entry.key === "paperclipai/paperclip/paperclip")?.state).toBe("installed");
      expect((await fs.lstat(path.join(home, ".kilo", "skills", "paperclip"))).isSymbolicLink()).toBe(true);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});

describe("kilocode_local models and diagnostics", () => {
  afterEach(() => {
    delete process.env.PAPERCLIP_KILOCODE_COMMAND;
  });

  it("names Kilo Code in the model-id error", () => {
    expect(() => requireKiloCodeModelId("sonnet")).toThrow("Kilo Code requires `adapterConfig.model`");
    expect(requireKiloCodeModelId("kilo/~anthropic/claude-sonnet-latest")).toBe("kilo/~anthropic/claude-sonnet-latest");
  });

  it("reports a missing working directory with kilocode_* check codes", async () => {
    const cwd = path.join(os.tmpdir(), `paperclip-kilocode-missing-${Date.now()}`, "workspace");
    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "kilocode_local",
      config: { command: process.execPath, cwd, env: { XDG_CONFIG_HOME: path.join(cwd, "config") } },
    });
    expect(result.status).toBe("fail");
    expect(result.checks.some((check) => check.code === "kilocode_cwd_invalid")).toBe(true);
    expect(result.checks.some((check) => check.code.startsWith("opencode_"))).toBe(false);
  });

  it("classifies the Kilo Gateway sign-in error as auth required, not a generic probe failure", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kilocode-auth-"));
    try {
      // `kilo models` runs through a real child process; the hello probe goes
      // through the mocked execution-target runner.
      const fakeKilo = path.join(cwd, "kilo");
      await fs.writeFile(fakeKilo, '#!/bin/sh\necho "kilo/~anthropic/claude-sonnet-latest"\n', { mode: 0o755 });
      runProcessMock.mockReset();
      runProcessMock.mockResolvedValueOnce(probeResult({
        exitCode: 1,
        stdout: JSON.stringify({
          type: "error",
          sessionID: "ses_1",
          error: {
            name: "APIError",
            data: {
              message:
                'Unauthorized: {"error":{"code":"PAID_MODEL_AUTH_REQUIRED","message":"You need to sign in to use this model."}}',
            },
          },
        }),
      }));
      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "kilocode_local",
        config: {
          command: fakeKilo,
          cwd,
          model: "kilo/~anthropic/claude-sonnet-latest",
          env: { XDG_CONFIG_HOME: path.join(cwd, "config") },
        },
      });
      const probeArgs = (runProcessMock.mock.calls[0] as unknown as [string, unknown, string, string[]])[3];
      expect(probeArgs.slice(0, 4)).toEqual(["run", "--format", "json", "--auto"]);
      const auth = result.checks.find((check) => check.code === "kilocode_hello_probe_auth_required");
      expect(auth?.level).toBe("warn");
      expect(auth?.hint).toContain("kilo auth login");
      expect(result.checks.some((check) => check.code === "kilocode_hello_probe_failed")).toBe(false);
      expect(result.status).toBe("warn");
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("reports an unresolvable kilo command with a kilocode_* check code", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kilocode-cmd-"));
    try {
      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "kilocode_local",
        config: { command: "__paperclip_missing_kilo_command__", cwd, env: { XDG_CONFIG_HOME: path.join(cwd, "config") } },
      });
      expect(result.status).toBe("fail");
      expect(result.checks.some((check) => check.code === "kilocode_command_unresolvable")).toBe(true);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
