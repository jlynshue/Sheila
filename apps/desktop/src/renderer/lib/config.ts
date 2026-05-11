import type { Dispatch, SetStateAction } from "react";
import type {
  ChatMessage,
  ConfigForm,
  LLMProvider,
  PaperHit,
  PublicConfig,
  VaultConfig,
} from "../types";

export const EMPTY_CONFIG: ConfigForm = {
  anthropic: { provider: "anthropic", api_key: "", model: "claude-sonnet-4-20250514", max_tokens: 1400, max_tool_loops: 12, base_url: "" },
  zotero: { database_path: "", storage_path: "" },
  embeddings: { provider: "fastembed", model: "BAAI/bge-base-en-v1.5", openai_api_key: "", openai_base_url: "" },
  speech: { stt_model: "small", piper_executable_path: "", piper_voice_model_path: "", voice_id: "en_US-amy-medium", speed: 1.15 },
  obsidian_vaults: [],
};

export type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;
export const TOTAL_STEPS = 6;

export const MODEL_PRESETS: Record<LLMProvider, { label: string; value: string }[]> = {
  anthropic: [
    { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
    { label: "Claude Opus 4", value: "claude-opus-4-20250514" },
    { label: "Claude Haiku 4.5", value: "claude-haiku-4-5-20251001" },
  ],
  openai: [
    { label: "GPT-4o", value: "gpt-4o" },
    { label: "GPT-4o mini", value: "gpt-4o-mini" },
    { label: "GPT-4.1", value: "gpt-4.1" },
    { label: "GPT-4.1 mini", value: "gpt-4.1-mini" },
    { label: "GPT-4.1 nano", value: "gpt-4.1-nano" },
  ],
  ollama: [
    { label: "Qwen 2.5 7B (recommended)", value: "qwen2.5:7b" },
    { label: "Qwen 2.5 14B (better)", value: "qwen2.5:14b" },
    { label: "Mistral 7B", value: "mistral:7b" },
    { label: "Llama 3.1 8B", value: "llama3.1:8b" },
    { label: "Llama 3.3 70B", value: "llama3.3:70b" },
    { label: "DeepSeek R1 8B", value: "deepseek-r1:8b" },
    { label: "Phi-4 14B", value: "phi4:14b" },
    { label: "Custom (type below)", value: "" },
  ],
};

export function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function blankVault(): VaultConfig {
  return { id: makeId(), name: "", path: "" };
}

export function getLlmProviderLabel(provider: LLMProvider): string {
  return provider === "anthropic" ? "Anthropic" : provider === "openai" ? "OpenAI" : "Ollama";
}

export function publicToForm(config: PublicConfig): ConfigForm {
  return {
    anthropic: {
      provider: config.anthropic.provider || "anthropic",
      api_key: "",
      model: config.anthropic.model || EMPTY_CONFIG.anthropic.model,
      max_tokens: config.anthropic.max_tokens || EMPTY_CONFIG.anthropic.max_tokens,
      max_tool_loops: config.anthropic.max_tool_loops || EMPTY_CONFIG.anthropic.max_tool_loops,
      base_url: config.anthropic.base_url || "",
    },
    zotero: {
      database_path: config.zotero.database_path || "",
      storage_path: config.zotero.storage_path || "",
    },
    embeddings: {
      provider: config.embeddings.provider || "fastembed",
      model: config.embeddings.model || EMPTY_CONFIG.embeddings.model,
      openai_api_key: "",
      openai_base_url: config.embeddings.openai_base_url || "",
    },
    speech: {
      stt_model: config.speech.stt_model || "small",
      piper_executable_path: config.speech.piper_executable_path || "",
      piper_voice_model_path: config.speech.piper_voice_model_path || "",
      voice_id: config.speech.voice_id || "en_US-amy-medium",
      speed: config.speech.speed ?? 1.15,
    },
    obsidian_vaults: config.obsidian_vaults.length ? config.obsidian_vaults : [blankVault()],
  };
}

export function sanitizeConfig(config: ConfigForm): ConfigForm {
  return {
    anthropic: {
      provider: config.anthropic.provider,
      api_key: config.anthropic.api_key.trim(),
      model: config.anthropic.model.trim(),
      max_tokens: config.anthropic.max_tokens,
      max_tool_loops: config.anthropic.max_tool_loops,
      base_url: config.anthropic.base_url.trim(),
    },
    zotero: {
      database_path: config.zotero.database_path.trim(),
      storage_path: config.zotero.storage_path.trim(),
    },
    embeddings: {
      provider: config.embeddings.provider,
      model: config.embeddings.model.trim(),
      openai_api_key: config.embeddings.openai_api_key.trim(),
      openai_base_url: config.embeddings.openai_base_url.trim(),
    },
    speech: {
      stt_model: config.speech.stt_model.trim(),
      piper_executable_path: config.speech.piper_executable_path.trim(),
      piper_voice_model_path: config.speech.piper_voice_model_path.trim(),
      voice_id: config.speech.voice_id || "en_US-amy-medium",
      speed: config.speech.speed ?? 1.15,
    },
    obsidian_vaults: config.obsidian_vaults
      .filter((v) => v.name.trim() || v.path.trim())
      .map((v) => ({ id: v.id, name: v.name.trim(), path: v.path.trim() })),
  };
}

export function appendStatusMessage(setter: Dispatch<SetStateAction<ChatMessage[]>>, content: string) {
  setter((c) => [...c, { id: makeId(), role: "status", content }]);
}

export function mergePapers(current: PaperHit[], incoming: PaperHit[]) {
  const index = new Map<string, PaperHit>();
  for (const item of current) {
    const key = item.paper_id || item.file_path;
    if (key) index.set(key, item);
  }
  for (const item of incoming) {
    const key = item.paper_id || item.file_path;
    if (!key) continue;
    index.set(key, { ...index.get(key), ...item });
  }
  return Array.from(index.values());
}

export function hasVaults(vaults: VaultConfig[]) {
  return vaults.some((v) => v.name.trim() && v.path.trim());
}
