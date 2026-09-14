import { describe, expect, it } from "vitest";
import { OPENCODE_FLAVOR } from "@paperclipai/adapter-opencode-local";
import {
  DEFAULT_KILOCODE_LOCAL_MODEL,
  KILOCODE_FLAVOR,
  isValidKiloCodeModelId,
  models,
  type,
} from "./index.js";

describe("kilocode_local flavor", () => {
  it("uses Kilo-specific names for every field that differs from OpenCode", () => {
    expect(type).toBe("kilocode_local");
    expect(KILOCODE_FLAVOR.adapterType).toBe("kilocode_local");
    expect(KILOCODE_FLAVOR.defaultCommand).toBe("kilo");
    expect(KILOCODE_FLAVOR.commandEnvVar).toBe("PAPERCLIP_KILOCODE_COMMAND");
    expect(KILOCODE_FLAVOR.disableProjectConfigEnvVar).toBe("KILO_DISABLE_PROJECT_CONFIG");
    expect(KILOCODE_FLAVOR.configDirName).toBe("kilo");
    expect(KILOCODE_FLAVOR.configFileName).toBe("kilo.json");
    expect(KILOCODE_FLAVOR.headlessPermissionArgs).toEqual(["--auto"]);
    expect(KILOCODE_FLAVOR.skillsHomeSegments).toEqual([".kilo", "skills"]);
    expect(KILOCODE_FLAVOR.sandboxInstallCommand).toContain("@kilocode/cli");
  });

  it("does not collide with the OpenCode flavor on any env var or path", () => {
    const keys = [
      "commandEnvVar",
      "disableProjectConfigEnvVar",
      "allowAllModelsEnvVar",
      "printLogsEnvVar",
      "providersEnvVar",
      "smallModelEnvVar",
      "configDirName",
      "runtimeConfigTmpPrefix",
      "checkCodePrefix",
      "adapterKey",
    ] as const;
    for (const key of keys) {
      expect(KILOCODE_FLAVOR[key], key).not.toBe(OPENCODE_FLAVOR[key]);
    }
  });

  it("accepts Kilo Gateway model ids with a nested slash", () => {
    expect(isValidKiloCodeModelId(DEFAULT_KILOCODE_LOCAL_MODEL)).toBe(true);
    expect(isValidKiloCodeModelId("kilo/~anthropic/claude-opus-latest")).toBe(true);
    expect(isValidKiloCodeModelId("anthropic/claude-sonnet-4-5")).toBe(true);
    expect(isValidKiloCodeModelId("claude-sonnet")).toBe(false);
    expect(isValidKiloCodeModelId("kilo/")).toBe(false);
    expect(models.some((entry) => entry.id === DEFAULT_KILOCODE_LOCAL_MODEL)).toBe(true);
  });
});
