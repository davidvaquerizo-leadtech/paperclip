import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listKiloCodeSkills,
  syncKiloCodeSkills,
} from "@paperclipai/adapter-kilocode-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("kilocode local skill sync", () => {
  const paperclipKey = "paperclipai/paperclip/paperclip";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("defaults and installs the operational Paperclip skill in the Kilo skills home", async () => {
    const home = await makeTempDir("paperclip-kilocode-skill-sync-");
    cleanupDirs.add(home);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "kilocode_local",
      config: {
        env: {
          HOME: home,
        },
      },
    } as const;

    const before = await listKiloCodeSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.adapterType).toBe("kilocode_local");
    expect(before.desiredSkills).toContain(paperclipKey);
    expect(before.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("missing");

    const after = await syncKiloCodeSkills(ctx, [paperclipKey]);
    expect(after.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".kilo", "skills", "paperclip"))).isSymbolicLink()).toBe(true);
    await expect(fs.lstat(path.join(home, ".claude", "skills", "paperclip"))).rejects.toThrow();
  });
});
