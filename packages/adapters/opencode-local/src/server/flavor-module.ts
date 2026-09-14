import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterModel,
  AdapterSessionCodec,
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";
import type { OpenCodeFlavor } from "../flavor.js";
import { createExecute } from "./execute.js";
import { sessionCodec } from "./index.js";
import { createOpenCodeModelsApi } from "./models.js";
import { createOpenCodeSkillsApi } from "./skills.js";
import { createTestEnvironment } from "./test.js";

export interface OpenCodeFlavorServerModule {
  execute: (ctx: AdapterExecutionContext) => Promise<AdapterExecutionResult>;
  testEnvironment: (ctx: AdapterEnvironmentTestContext) => Promise<AdapterEnvironmentTestResult>;
  listSkills: (ctx: AdapterSkillContext) => Promise<AdapterSkillSnapshot>;
  syncSkills: (ctx: AdapterSkillContext, desiredSkills: string[]) => Promise<AdapterSkillSnapshot>;
  listModels: () => Promise<AdapterModel[]>;
  requireModelId: (input: unknown) => string;
  resetModelsCacheForTests: () => void;
  sessionCodec: AdapterSessionCodec;
}

/**
 * Assemble the server-side pieces of an OpenCode-family adapter for one
 * flavor. `opencode_local` keeps its historical named exports; a thin adapter
 * such as `kilocode_local` calls this once and re-exports the result.
 */
export function createOpenCodeFlavorServerModule(flavor: OpenCodeFlavor): OpenCodeFlavorServerModule {
  const modelsApi = createOpenCodeModelsApi(flavor);
  const skillsApi = createOpenCodeSkillsApi(flavor);
  return {
    execute: createExecute(flavor),
    testEnvironment: createTestEnvironment(flavor),
    listSkills: skillsApi.listSkills,
    syncSkills: skillsApi.syncSkills,
    listModels: modelsApi.listModels,
    requireModelId: modelsApi.requireModelId,
    resetModelsCacheForTests: modelsApi.resetCacheForTests,
    sessionCodec,
  };
}
