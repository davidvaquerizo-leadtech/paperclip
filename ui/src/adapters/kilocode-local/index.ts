import type { UIAdapterModule } from "../types";
import { parseKiloCodeStdoutLine, buildKiloCodeLocalConfig } from "@paperclipai/adapter-kilocode-local/ui";
import { KiloCodeLocalConfigFields } from "./config-fields";

export const kiloCodeLocalUIAdapter: UIAdapterModule = {
  type: "kilocode_local",
  label: "Kilo Code",
  parseStdoutLine: parseKiloCodeStdoutLine,
  ConfigFields: KiloCodeLocalConfigFields,
  buildAdapterConfig: buildKiloCodeLocalConfig,
};
