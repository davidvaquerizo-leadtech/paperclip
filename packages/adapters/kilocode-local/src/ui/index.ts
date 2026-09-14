// Kilo Code emits the same `run --format json` event stream as OpenCode, so
// the transcript parser and config builder are shared.
export {
  parseOpenCodeStdoutLine as parseKiloCodeStdoutLine,
  buildOpenCodeLocalConfig as buildKiloCodeLocalConfig,
} from "@paperclipai/adapter-opencode-local/ui";
