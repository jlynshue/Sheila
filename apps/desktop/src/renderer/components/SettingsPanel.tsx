import { useState, type Dispatch, type SetStateAction } from "react";
import { useEffect } from "react";
import type { ConfigForm, LLMProvider, PublicConfig, SpeechStatus } from "../types";
import type { SpeechSetupEvent } from "../api";
import { fetchOpenAIModels, getSpeechStatus, setupSpeechStreaming } from "../api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Separator } from "./ui/separator";
import { cn } from "../lib/cn";
import { MODEL_PRESETS, blankVault, getLlmProviderLabel } from "../lib/config";
import { IconCheck } from "./Icons";
import { Field, OllamaSetupPanel, PathPicker, SpeechSetupProgress } from "./SetupModal";

type VoiceInfo = { id: string; label: string; installed: boolean };
type STTModelLocal = { id: string; label: string; size_mb: number; lang: string; installed: boolean };

function SpeechSettingsSection({ baseUrl, configForm, setConfigForm }: { baseUrl: string; configForm: ConfigForm; setConfigForm: Dispatch<SetStateAction<ConfigForm>> }) {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progressEvent, setProgressEvent] = useState<SpeechSetupEvent | null>(null);
  const [error, setError] = useState("");
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [downloadingVoice, setDownloadingVoice] = useState<string | null>(null);
  const [sttModels, setSTTModels] = useState<STTModelLocal[]>([]);
  const [downloadingSTT, setDownloadingSTT] = useState<string | null>(null);
  const [sttProgress, setSTTProgress] = useState<{ detail: string; progress: number } | null>(null);

  useEffect(() => {
    if (!baseUrl) return;
    getSpeechStatus(baseUrl).then(setStatus).catch(() => {});
    fetch(`${baseUrl}/api/voices`).then((r) => r.json()).then((d) => setVoices(d.voices || [])).catch(() => {});
    fetch(`${baseUrl}/api/stt/models`).then((r) => r.json()).then((d) => setSTTModels(d.models || [])).catch(() => {});
  }, [baseUrl]);

  async function handleInstall() {
    if (!baseUrl) return;
    setInstalling(true);
    setError("");
    setProgressEvent(null);
    try {
      await setupSpeechStreaming(baseUrl, (event) => {
        setProgressEvent(event);
        if (event.status === "done" || event.step === "done") {
          getSpeechStatus(baseUrl).then(setStatus).catch(() => {});
        }
      });
      setStatus(await getSpeechStatus(baseUrl));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  }

  async function handleDownloadVoice(voiceId: string) {
    setDownloadingVoice(voiceId);
    setError("");
    try {
      const resp = await fetch(`${baseUrl}/api/voices/download/${encodeURIComponent(voiceId)}`, { method: "POST" });
      if (!resp.ok) throw new Error(await resp.text());
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const ev = JSON.parse(line);
            if (ev.status === "error") throw new Error(ev.detail);
          }
        }
      }
      const d = await fetch(`${baseUrl}/api/voices`).then((r) => r.json());
      setVoices(d.voices || []);
      setConfigForm((c) => ({ ...c, speech: { ...c.speech, voice_id: voiceId, piper_voice_model_path: "" } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingVoice(null);
    }
  }

  async function handleDownloadSTT(modelId: string) {
    setDownloadingSTT(modelId);
    setSTTProgress(null);
    setError("");
    try {
      const resp = await fetch(`${baseUrl}/api/stt/download/${encodeURIComponent(modelId)}`, { method: "POST" });
      if (!resp.ok) throw new Error(await resp.text());
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const ev = JSON.parse(line);
            if (ev.status === "error") throw new Error(ev.detail);
            setSTTProgress({ detail: ev.detail || "", progress: ev.progress ?? 0 });
          }
        }
      }
      // Refresh model list and auto-select
      const d = await fetch(`${baseUrl}/api/stt/models`).then((r) => r.json());
      setSTTModels(d.models || []);
      setConfigForm((c) => ({ ...c, speech: { ...c.speech, stt_model: modelId } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingSTT(null);
      setSTTProgress(null);
    }
  }

  const statusItems = [
    { label: "Vosk STT", ready: status?.vosk_ready ?? false },
    { label: "Piper TTS", ready: status?.piper_installed ?? false },
    { label: "Voice model", ready: status?.voice_installed ?? false },
  ];

  const currentVoice = configForm.speech?.voice_id || "en_US-amy-medium";
  const currentSpeed = configForm.speech?.speed ?? 1.15;
  const currentSTT = configForm.speech?.stt_model || "vosk-model-small-en-us-0.15";

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Speech</h3>

      {/* Status indicators */}
      <div className="flex flex-col gap-2">
        {statusItems.map((item) => (
          <div key={item.label} className={cn("flex items-center gap-2 px-3 py-2 border rounded-lg text-xs", item.ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-zinc-50 text-zinc-500")}>
            <span className={cn("shrink-0 w-5 h-5 grid place-items-center rounded-full", item.ready ? "bg-emerald-100" : "bg-zinc-200")}>
              {item.ready ? <IconCheck className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />}
            </span>
            <span className="font-medium">{item.label}</span>
            <span className="ml-auto font-medium">{item.ready ? "Installed" : "Not installed"}</span>
          </div>
        ))}
      </div>

      {installing && progressEvent && (
        <SpeechSetupProgress progress={progressEvent.progress} detail={progressEvent.detail} currentStep={progressEvent.step} />
      )}
      {status && !status.ready && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-500">Missing components will be downloaded automatically. This may take a few minutes.</p>
          <Button size="sm" onClick={handleInstall} disabled={installing}>
            {installing ? "Installing..." : "Install missing components"}
          </Button>
        </div>
      )}

      <Separator />

      {/* ── STT Model Selection ── */}
      <Field label="Speech-to-text model" hint="Larger models are more accurate but use more memory and take longer to load.">
        <div className="flex flex-col gap-2">
          {sttModels.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 border rounded-lg text-xs transition-colors",
                m.id === currentSTT
                  ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900"
                  : m.installed
                    ? "border-zinc-200 hover:border-zinc-300 cursor-pointer"
                    : "border-zinc-200 bg-zinc-50 text-zinc-400"
              )}
              onClick={() => {
                if (m.installed) {
                  setConfigForm((c) => ({ ...c, speech: { ...c.speech, stt_model: m.id } }));
                }
              }}
            >
              <div className="flex-1 min-w-0">
                <span className={cn("font-semibold", m.installed ? "text-zinc-900" : "text-zinc-500")}>{m.label}</span>
              </div>
              {m.installed ? (
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full shrink-0", m.id === currentSTT ? "bg-zinc-900 text-white" : "bg-emerald-100 text-emerald-700")}>
                  {m.id === currentSTT ? "Active" : "Installed"}
                </span>
              ) : downloadingSTT === m.id ? (
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-20 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                    <div className="h-full bg-zinc-500 rounded-full transition-all duration-300" style={{ width: `${Math.round((sttProgress?.progress ?? 0) * 100)}%` }} />
                  </div>
                  <span className="text-xs text-zinc-400 w-8 text-right">{Math.round((sttProgress?.progress ?? 0) * 100)}%</span>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloadingSTT !== null}
                  onClick={(e) => { e.stopPropagation(); void handleDownloadSTT(m.id); }}
                >
                  Download ({m.size_mb >= 1000 ? `${(m.size_mb / 1000).toFixed(1)} GB` : `${m.size_mb} MB`})
                </Button>
              )}
            </div>
          ))}
          {sttModels.length === 0 && (
            <p className="text-xs text-zinc-400 text-center py-2">Loading models…</p>
          )}
        </div>
      </Field>

      <Separator />

      {/* ── TTS Voice Selection ── */}
      <Field label="Text-to-speech voice" hint="Choose a voice for spoken responses. Click download to install new voices.">
        <div className="flex flex-col gap-2">
          {voices.map((v) => (
            <div
              key={v.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 border rounded-lg text-xs cursor-pointer transition-all",
                v.id === currentVoice
                  ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900"
                  : v.installed
                    ? "border-zinc-200 hover:border-zinc-300"
                    : "border-zinc-200 bg-zinc-50 text-zinc-400"
              )}
              onClick={() => {
                if (v.installed) {
                  setConfigForm((c) => ({ ...c, speech: { ...c.speech, voice_id: v.id, piper_voice_model_path: "" } }));
                }
              }}
            >
              <div className="flex-1 min-w-0">
                <span className={cn("font-semibold", v.installed ? "text-zinc-900" : "text-zinc-500")}>{v.label}</span>
                <span className="ml-2 text-zinc-400 font-mono text-xs">{v.id}</span>
              </div>
              {v.installed ? (
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full shrink-0", v.id === currentVoice ? "bg-zinc-900 text-white" : "bg-emerald-100 text-emerald-700")}>
                  {v.id === currentVoice ? "Active" : "Installed"}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloadingVoice === v.id}
                  onClick={(e) => { e.stopPropagation(); void handleDownloadVoice(v.id); }}
                >
                  {downloadingVoice === v.id ? "Downloading..." : "Download"}
                </Button>
              )}
            </div>
          ))}
        </div>
      </Field>

      <Separator />

      {/* Speed control */}
      <Field label={`Speaking speed: ${currentSpeed.toFixed(2)}x`} hint="1.0 = normal, higher = faster. Default 1.15x.">
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-400 w-8">0.8x</span>
          <input
            type="range"
            min={0.8}
            max={2.0}
            step={0.05}
            value={currentSpeed}
            onChange={(e) => setConfigForm((c) => ({ ...c, speech: { ...c.speech, speed: Number(e.target.value) } }))}
            className="flex-1 accent-zinc-900"
          />
          <span className="text-xs text-zinc-400 w-8">2.0x</span>
        </div>
      </Field>

      {error && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
    </section>
  );
}

type SettingsTab = "models" | "sources" | "speech" | "general";

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "models", label: "Models" },
  { id: "sources", label: "Sources" },
  { id: "speech", label: "Speech" },
  { id: "general", label: "General" },
];

function SettingsPanel({ configForm, setConfigForm, savedConfig, saving, onClose, baseUrl }: {
  configForm: ConfigForm;
  setConfigForm: Dispatch<SetStateAction<ConfigForm>>;
  savedConfig: PublicConfig | null;
  saving: boolean;
  onClose: () => void;
  baseUrl: string;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("models");
  const [remoteModels, setRemoteModels] = useState<{ id: string; name?: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const openaiBaseUrl = configForm.anthropic.base_url.trim();
  useEffect(() => {
    if (configForm.anthropic.provider === "openai" && openaiBaseUrl) {
      setLoadingModels(true);
      fetchOpenAIModels(openaiBaseUrl)
        .then(setRemoteModels)
        .finally(() => setLoadingModels(false));
    } else {
      setRemoteModels([]);
    }
  }, [configForm.anthropic.provider, openaiBaseUrl]);

  const llmProvider = configForm.anthropic.provider;
  const llmProviderLabel = getLlmProviderLabel(llmProvider);
  const savedLlmProvider = savedConfig?.anthropic.provider ?? null;
  const savedLlmProviderLabel = savedLlmProvider ? getLlmProviderLabel(savedLlmProvider) : null;
  const hasSavedLlmKey = Boolean(savedConfig?.anthropic.api_key);
  const hasMatchingSavedLlmKey = hasSavedLlmKey && savedLlmProvider === llmProvider;
  const hasDraftLlmKey = configForm.anthropic.api_key.trim().length > 0;

  let llmKeyHint = `Paste your ${llmProviderLabel} API key.`;
  if (hasMatchingSavedLlmKey) {
    llmKeyHint = hasDraftLlmKey
      ? `A ${llmProviderLabel} API key is already saved. Saving now will replace it with the new key you entered.`
      : `A ${llmProviderLabel} API key is already saved. Leave this blank to keep using it.`;
  } else if (hasSavedLlmKey && savedLlmProviderLabel) {
    llmKeyHint = hasDraftLlmKey
      ? `A ${savedLlmProviderLabel} API key is saved right now. Saving now will replace it with this ${llmProviderLabel} key.`
      : `A ${savedLlmProviderLabel} API key is saved right now. Paste a ${llmProviderLabel} key here if you want to switch providers.`;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Draggable top bar */}
      <div className="flex items-center justify-between pl-[78px] pr-5 py-3 border-b border-zinc-200 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        <div className="flex items-center gap-6" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button type="button" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-900 transition-colors" onClick={onClose}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          <h2 className="text-sm font-bold text-zinc-900">Settings</h2>
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          {saving && <span className="text-xs text-zinc-400">Saving…</span>}
          {!saving && <span className="text-xs text-zinc-300">Auto-saved</span>}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 py-1.5 border-b border-zinc-200 bg-zinc-50 shrink-0">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cn(
              "px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors",
              activeTab === tab.id ? "bg-white text-zinc-900 shadow-sm border border-zinc-200" : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50"
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-xl mx-auto py-8 px-6">
          {activeTab === "models" && (
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Language Model</h3>
              <Field label="Provider">
                <Select value={configForm.anthropic.provider} onChange={(e) => {
                  const p = e.target.value as LLMProvider;
                  const defaultModel = MODEL_PRESETS[p]?.[0]?.value || "";
                  setConfigForm((c) => ({
                    ...c,
                    anthropic: { ...c.anthropic, provider: p, model: defaultModel, base_url: p === "ollama" ? "http://localhost:11434/v1" : c.anthropic.base_url },
                  }));
                }}>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="ollama">Ollama (local)</option>
                </Select>
              </Field>
              {configForm.anthropic.provider !== "ollama" && (
                <Field
                  label={(
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span>API key</span>
                      {hasSavedLlmKey && savedLlmProviderLabel && (
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            hasMatchingSavedLlmKey ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                          )}
                        >
                          Saved for {savedLlmProviderLabel}
                        </span>
                      )}
                    </span>
                  )}
                  htmlFor="settings-api-key"
                  hint={llmKeyHint}
                >
                  <Input
                    id="settings-api-key"
                    type="password"
                    placeholder={hasMatchingSavedLlmKey ? "Saved API key on file" : configForm.anthropic.provider === "anthropic" ? "sk-ant-..." : "sk-..."}
                    value={configForm.anthropic.api_key}
                    onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, api_key: e.target.value } }))}
                  />
                </Field>
              )}
              <Field label="Model" hint={loadingModels ? "Loading models from endpoint…" : remoteModels.length > 0 ? `${remoteModels.length} models available from ${openaiBaseUrl}` : undefined}>
                {remoteModels.length > 0 ? (
                  <>
                    <Select value={remoteModels.some((m) => m.id === configForm.anthropic.model) ? configForm.anthropic.model : "__custom__"} onChange={(e) => {
                      if (e.target.value !== "__custom__") {
                        setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, model: e.target.value } }));
                      }
                    }}>
                      {remoteModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.name || m.id}</option>
                      ))}
                      <option value="__custom__">Custom model ID…</option>
                    </Select>
                    {!remoteModels.some((m) => m.id === configForm.anthropic.model) && (
                      <Input className="mt-2" placeholder="Type a model ID…" value={configForm.anthropic.model} onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, model: e.target.value } }))} />
                    )}
                  </>
                ) : (
                  <>
                    <Select value={configForm.anthropic.model} onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, model: e.target.value } }))}>
                      {(MODEL_PRESETS[configForm.anthropic.provider] || []).map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </Select>
                    {configForm.anthropic.provider === "ollama" && (
                      <Input className="mt-2" placeholder="Or type a custom model name..." value={configForm.anthropic.model} onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, model: e.target.value } }))} />
                    )}
                  </>
                )}
              </Field>
              {(configForm.anthropic.provider === "openai" || configForm.anthropic.provider === "ollama") && (
                <Field label="API base URL">
                  <Input value={configForm.anthropic.base_url} placeholder={configForm.anthropic.provider === "ollama" ? "http://localhost:11434/v1" : "https://api.openai.com/v1"} onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, base_url: e.target.value } }))} />
                </Field>
              )}
              <Field label="Max tokens">
                <Input type="number" min={512} max={4096} value={configForm.anthropic.max_tokens} onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, max_tokens: Number(e.target.value) || 1400 } }))} />
              </Field>
              <Field label="Max tool loops" hint="Maximum orchestration rounds before Roxanne stops repeated tool calling for safety.">
                <Input type="number" min={1} max={30} value={configForm.anthropic.max_tool_loops} onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, max_tool_loops: Number(e.target.value) || 12 } }))} />
              </Field>
              {configForm.anthropic.provider === "ollama" && (
                <>
                  <Separator />
                  <h4 className="text-xs font-semibold text-zinc-500">Ollama Status</h4>
                  <OllamaSetupPanel baseUrl={baseUrl} configForm={configForm} setConfigForm={setConfigForm} />
                </>
              )}
            </div>
          )}

          {activeTab === "sources" && (
            <div className="flex flex-col gap-6">
              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Zotero</h3>
                <Field label="Storage folder">
                  <PathPicker label="Storage" value={configForm.zotero.storage_path} placeholder="Click to select..." onPick={async () => { const p = await window.roxanne.pickDirectory(); if (p) setConfigForm((c) => ({ ...c, zotero: { ...c.zotero, storage_path: p } })); }} />
                </Field>
                <Field label="Database">
                  <PathPicker label="Database" value={configForm.zotero.database_path} placeholder="Click to select..." onPick={async () => { const p = await window.roxanne.pickFile([{ name: "SQLite", extensions: ["sqlite", "sqlite3", "db"] }]); if (p) setConfigForm((c) => ({ ...c, zotero: { ...c.zotero, database_path: p } })); }} />
                </Field>
              </section>

              <Separator />

              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Obsidian Vaults</h3>
                {configForm.obsidian_vaults.map((vault, i) => (
                  <div key={vault.id} className="flex flex-col gap-2 p-3 border border-zinc-200 rounded-lg bg-zinc-50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-400 uppercase">Vault {i + 1}</span>
                      {configForm.obsidian_vaults.length > 1 && (
                        <button type="button" className="text-zinc-400 text-xs hover:text-red-600 transition-colors" onClick={() => setConfigForm((c) => ({ ...c, obsidian_vaults: c.obsidian_vaults.filter((v) => v.id !== vault.id) }))}>Remove</button>
                      )}
                    </div>
                    <PathPicker label="Folder" value={vault.path} placeholder="Select vault..." onPick={async () => {
                      const p = await window.roxanne.pickDirectory();
                      if (p) {
                        const name = p.split("/").pop() || "";
                        setConfigForm((c) => ({ ...c, obsidian_vaults: c.obsidian_vaults.map((v) => v.id === vault.id ? { ...v, path: p, name: v.name || name } : v) }));
                      }
                    }} />
                    <Field label="Name">
                      <Input value={vault.name} placeholder="Display name" onChange={(e) => setConfigForm((c) => ({ ...c, obsidian_vaults: c.obsidian_vaults.map((v) => v.id === vault.id ? { ...v, name: e.target.value } : v) }))} />
                    </Field>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setConfigForm((c) => ({ ...c, obsidian_vaults: [...c.obsidian_vaults, blankVault()] }))}>+ Add vault</Button>
              </section>
            </div>
          )}

          {activeTab === "speech" && (
            <SpeechSettingsSection baseUrl={baseUrl} configForm={configForm} setConfigForm={setConfigForm} />
          )}

          {activeTab === "general" && (
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Embeddings</h3>
              <Field label="Provider">
                <Select value={configForm.embeddings.provider} onChange={(e) => setConfigForm((c) => ({ ...c, embeddings: { ...c.embeddings, provider: e.target.value as "fastembed" | "openai" } }))}>
                  <option value="fastembed">FastEmbed (local)</option>
                  <option value="openai">OpenAI</option>
                </Select>
              </Field>
              <Field label="Model">
                <Input value={configForm.embeddings.model} onChange={(e) => setConfigForm((c) => ({ ...c, embeddings: { ...c.embeddings, model: e.target.value } }))} />
              </Field>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
