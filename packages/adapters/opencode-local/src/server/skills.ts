import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";
import {
  buildPersistentSkillSnapshot,
  ensurePaperclipSkillSymlink,
  readPaperclipRuntimeSkillEntries,
  readInstalledSkillTargets,
  resolveLegacyPaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";
import { OPENCODE_FLAVOR, type OpenCodeFlavor } from "../flavor.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Resolve the skills home for a flavor, honoring a configured child `HOME`. */
export function resolveFlavorSkillsHome(flavor: OpenCodeFlavor, config: Record<string, unknown>) {
  const env =
    typeof config.env === "object" && config.env !== null && !Array.isArray(config.env)
      ? (config.env as Record<string, unknown>)
      : {};
  const configuredHome = asString(env.HOME);
  const home = configuredHome ? path.resolve(configuredHome) : os.homedir();
  return path.join(home, ...flavor.skillsHomeSegments);
}

export interface OpenCodeSkillsApi {
  resolveSkillsHome: (config: Record<string, unknown>) => string;
  listSkills: (ctx: AdapterSkillContext) => Promise<AdapterSkillSnapshot>;
  syncSkills: (ctx: AdapterSkillContext, desiredSkills: string[]) => Promise<AdapterSkillSnapshot>;
}

/** Build the persistent skills API (list/sync) for one OpenCode-family flavor. */
export function createOpenCodeSkillsApi(flavor: OpenCodeFlavor): OpenCodeSkillsApi {
  const resolveSkillsHome = (config: Record<string, unknown>) => resolveFlavorSkillsHome(flavor, config);
  const sharedWithClaude = flavor.skillsHomeSegments[0] === ".claude";
  const homeDescription = sharedWithClaude
    ? `the shared Claude/${flavor.productName} skills home`
    : `the ${flavor.productName} skills home`;

  async function buildSnapshot(config: Record<string, unknown>): Promise<AdapterSkillSnapshot> {
    const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
    const desiredSkills = resolveLegacyPaperclipDesiredSkillNames(config, availableEntries);
    const skillsHome = resolveSkillsHome(config);
    const installed = await readInstalledSkillTargets(skillsHome);
    return buildPersistentSkillSnapshot({
      adapterType: flavor.adapterType,
      availableEntries,
      desiredSkills,
      installed,
      skillsHome,
      locationLabel: flavor.skillsHomeLabel,
      installedDetail: `Installed in ${homeDescription}.`,
      missingDetail: `Configured but not currently linked into ${homeDescription}.`,
      externalConflictDetail: `Skill name is occupied by an external installation in ${homeDescription}.`,
      externalDetail: `Installed outside Paperclip management in ${homeDescription}.`,
      warnings: sharedWithClaude
        ? [`${flavor.productName} currently uses the shared Claude skills home (${flavor.skillsHomeLabel}).`]
        : [],
    });
  }

  async function listSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
    return buildSnapshot(ctx.config);
  }

  async function syncSkills(
    ctx: AdapterSkillContext,
    desiredSkills: string[],
  ): Promise<AdapterSkillSnapshot> {
    const availableEntries = await readPaperclipRuntimeSkillEntries(ctx.config, __moduleDir);
    const desiredSet = new Set([
      ...resolveLegacyPaperclipDesiredSkillNames({}, availableEntries),
      ...desiredSkills,
    ]);
    const skillsHome = resolveSkillsHome(ctx.config);
    await fs.mkdir(skillsHome, { recursive: true });
    const installed = await readInstalledSkillTargets(skillsHome);
    const availableByRuntimeName = new Map(availableEntries.map((entry) => [entry.runtimeName, entry]));

    for (const available of availableEntries) {
      if (!desiredSet.has(available.key)) continue;
      const target = path.join(skillsHome, available.runtimeName);
      await ensurePaperclipSkillSymlink(available.source, target);
    }

    for (const [name, installedEntry] of installed.entries()) {
      const available = availableByRuntimeName.get(name);
      if (!available) continue;
      if (desiredSet.has(available.key)) continue;
      if (installedEntry.targetPath !== available.source) continue;
      await fs.unlink(path.join(skillsHome, name)).catch(() => {});
    }

    return buildSnapshot(ctx.config);
  }

  return { resolveSkillsHome, listSkills, syncSkills };
}

const openCodeSkillsApi = createOpenCodeSkillsApi(OPENCODE_FLAVOR);

export function resolveOpenCodeSkillsHome(config: Record<string, unknown>) {
  return openCodeSkillsApi.resolveSkillsHome(config);
}

export async function listOpenCodeSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return openCodeSkillsApi.listSkills(ctx);
}

export async function syncOpenCodeSkills(
  ctx: AdapterSkillContext,
  desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return openCodeSkillsApi.syncSkills(ctx, desiredSkills);
}

export function resolveOpenCodeDesiredSkillNames(
  config: Record<string, unknown>,
  availableEntries: Array<{ key: string }>,
) {
  return resolveLegacyPaperclipDesiredSkillNames(config, availableEntries);
}
