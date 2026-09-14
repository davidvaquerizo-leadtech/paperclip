import { createOpenCodeFlavorServerModule } from "@paperclipai/adapter-opencode-local/server";
import { KILOCODE_FLAVOR } from "../index.js";

const module_ = createOpenCodeFlavorServerModule(KILOCODE_FLAVOR);

export const execute = module_.execute;
export const testEnvironment = module_.testEnvironment;
export const listKiloCodeSkills = module_.listSkills;
export const syncKiloCodeSkills = module_.syncSkills;
export const listKiloCodeModels = module_.listModels;
export const requireKiloCodeModelId = module_.requireModelId;
export const resetKiloCodeModelsCacheForTests = module_.resetModelsCacheForTests;
export const sessionCodec = module_.sessionCodec;

export { parseOpenCodeJsonl as parseKiloCodeJsonl, isOpenCodeUnknownSessionError as isKiloCodeUnknownSessionError } from "@paperclipai/adapter-opencode-local/server";
