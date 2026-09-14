import { describe, expect, it } from "vitest";
import { OPENCODE_FLAVOR, isValidOpenCodeFamilyModelId, SANDBOX_INSTALL_COMMAND, isValidOpenCodeModelId } from "./index.js";

describe("OpenCode flavor seam", () => {
  it("keeps the historical opencode_local names", () => {
    expect(OPENCODE_FLAVOR).toMatchObject({
      adapterType: "opencode_local",
      adapterKey: "opencode",
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
      skillsHomeSegments: [".claude", "skills"],
      authLoginCommand: "opencode auth login",
    });
    expect(OPENCODE_FLAVOR.sandboxInstallCommand).toBe(SANDBOX_INSTALL_COMMAND);
  });

  it("shares the provider/model validator with the legacy export", () => {
    for (const value of ["openai/gpt-5.2-codex", "kilo/~anthropic/claude-sonnet-latest", "gpt-5", "openai/", "/model", 42]) {
      expect(isValidOpenCodeModelId(value)).toBe(isValidOpenCodeFamilyModelId(value));
    }
  });
});
