import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ConfigForm, PublicConfig, SpeechStatus } from "../types";
import type { SpeechSetupEvent } from "../api";
import { detectZotero, getSpeechStatus, setupSpeechStreaming } from "../api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { cn } from "../lib/cn";
import { MODEL_PRESETS, blankVault, type WizardStep } from "../lib/config";
import { IconCheck } from "./Icons";
import { Field, OllamaSetupPanel, PathPicker, SpeechSetupProgress } from "./SetupModal";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-6 flex-1 items-center text-center justify-center">
      <div className="w-16 h-16 grid place-items-center rounded-full bg-zinc-100 text-zinc-900">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="18" r="15" />
          <path d="M13 18l3.5 3.5 6.5-6.5" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Welcome to Roxanne</h1>
      <p className="text-sm leading-relaxed text-zinc-500 max-w-[420px]">
        Your local-first research copilot. Let's connect your tools and get everything set up in a few quick steps.
      </p>
      <div className="flex flex-col gap-3 mt-1 w-full max-w-[340px] text-left">
        {[
          ["Search & retrieve from your Zotero library", "M3 3h14v14H3zM7 7h6M7 10h6M7 13h3"],
          ["Read & write notes in your Obsidian vaults", "M4 4h5l1 2h6v10H4z"],
          ["Voice input & spoken replies, all local", "M10 7v3l2 2"],
        ].map(([text, path], i) => (
          <div key={i} className="flex items-center gap-3 text-sm text-zinc-500">
            <span className="shrink-0 w-8 h-8 grid place-items-center rounded-lg bg-zinc-100 text-zinc-900">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={path} />
              </svg>
            </span>
            <span>{text}</span>
          </div>
        ))}
      </div>
      <Button className="mt-3 min-w-[200px]" onClick={onNext}>Get started</Button>
    </div>
  );
}

export function AnthropicStep({ configForm, setConfigForm, savedConfig, baseUrl }: {
  configForm: ConfigForm;
  setConfigForm: Dispatch<SetStateAction<ConfigForm>>;
  savedConfig: PublicConfig | null;
  baseUrl: string;
}) {
  const provider = configForm.anthropic.provider;
  const keyPresent = Boolean(savedConfig?.anthropic.api_key || configForm.anthropic.api_key.trim());
  const needsKey = provider !== "ollama";
  const presets = MODEL_PRESETS[provider] || [];

  return (
    <div className="flex flex-col gap-6 flex-1">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900">Connect your LLM</h2>
        <p className="text-sm text-zinc-500 mt-1">Choose a provider. Ollama runs entirely on your machine.</p>
      </div>
      <div className="flex flex-col gap-5">
        {/* Provider toggle */}
        <Field label="Provider">
          <div className="grid grid-cols-3 gap-2">
            {(["anthropic", "openai", "ollama"] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-3 rounded-lg border text-xs font-semibold transition-colors",
                  provider === p
                    ? "border-zinc-900 bg-zinc-900 text-white shadow-sm"
                    : "border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
                )}
                onClick={() => {
                  const defaultModel = MODEL_PRESETS[p]?.[0]?.value || "";
                  setConfigForm((c) => ({
                    ...c,
                    anthropic: {
                      ...c.anthropic,
                      provider: p,
                      model: defaultModel,
                      base_url: p === "ollama" ? "http://localhost:11434/v1" : "",
                    },
                  }));
                }}
              >
                {p === "anthropic" ? "Anthropic" : p === "openai" ? "OpenAI" : "Ollama (local)"}
              </button>
            ))}
          </div>
        </Field>

        {needsKey && (
          <Field label="API key" htmlFor="api-key" hint={keyPresent ? "Key is saved. Leave blank to keep it." : `Paste your ${provider === "anthropic" ? "Anthropic" : "OpenAI"} API key.`}>
            <Input id="api-key" type="password" placeholder={keyPresent ? "••••••••" : provider === "anthropic" ? "sk-ant-..." : "sk-..."} value={configForm.anthropic.api_key} onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, api_key: e.target.value } }))} />
          </Field>
        )}

        {provider === "ollama" && (
          <OllamaSetupPanel baseUrl={baseUrl} configForm={configForm} setConfigForm={setConfigForm} />
        )}

        {/* Model selector — only for non-Ollama providers (OllamaSetupPanel handles its own) */}
        {provider !== "ollama" && (
          <Field label="Model" htmlFor="model">
            <Select id="model" value={presets.some((p) => p.value === configForm.anthropic.model) ? configForm.anthropic.model : ""} onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, model: e.target.value } }))}>
              {presets.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </Field>
        )}

        {provider === "openai" && (
          <Field label="API base URL" hint="Leave blank for default OpenAI endpoint.">
            <Input value={configForm.anthropic.base_url} placeholder="https://api.openai.com/v1" onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, base_url: e.target.value } }))} />
          </Field>
        )}

        <Field label="Max tokens" htmlFor="max-tokens" hint="Upper limit per response (512–4096).">
          <Input id="max-tokens" type="number" min={512} max={4096} value={configForm.anthropic.max_tokens} onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, max_tokens: Number(e.target.value) || 1400 } }))} />
        </Field>
      </div>
    </div>
  );
}

export function ZoteroStep({ configForm, setConfigForm, baseUrl }: { configForm: ConfigForm; setConfigForm: Dispatch<SetStateAction<ConfigForm>>; baseUrl: string }) {
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(false);
  const hasAttemptedDetect = useRef(false);

  useEffect(() => {
    if (!baseUrl || hasAttemptedDetect.current || configForm.zotero.storage_path) return;
    hasAttemptedDetect.current = true;
    setDetecting(true);
    detectZotero(baseUrl)
      .then((result) => {
        if (result.found) {
          setDetected(true);
          setConfigForm((c) => ({
            ...c,
            zotero: {
              storage_path: result.storage_path || c.zotero.storage_path,
              database_path: result.database_path || c.zotero.database_path,
            },
          }));
        }
      })
      .catch(() => {})
      .finally(() => setDetecting(false));
  }, [baseUrl]);

  return (
    <div className="flex flex-col gap-6 flex-1">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900">Point to Zotero</h2>
        <p className="text-sm text-zinc-500 mt-1">Roxanne indexes PDFs in your Zotero storage folder.</p>
      </div>
      <div className="flex flex-col gap-5">
        {detecting && <div className="px-4 py-2 rounded-lg bg-zinc-100 text-zinc-500 text-sm text-center">Looking for Zotero...</div>}
        {detected && configForm.zotero.storage_path && (
          <div className="px-4 py-2 rounded-lg bg-emerald-50 text-emerald-600 text-sm text-center flex items-center justify-center gap-2">
            <IconCheck className="w-4 h-4" /> Found Zotero at the default location
          </div>
        )}
        <Field label="Storage folder" hint="Contains your PDF attachments. Usually ~/Zotero/storage.">
          <PathPicker label="Storage folder" value={configForm.zotero.storage_path} placeholder="Select your Zotero storage directory..." onPick={async () => { const p = await window.roxanne.pickDirectory(); if (p) setConfigForm((c) => ({ ...c, zotero: { ...c.zotero, storage_path: p } })); }} />
        </Field>
        <Field label="Database (optional)" hint="Enables rich metadata: authors, collections, annotations.">
          <PathPicker label="Database file" value={configForm.zotero.database_path} placeholder="Select zotero.sqlite..." onPick={async () => { const p = await window.roxanne.pickFile([{ name: "SQLite", extensions: ["sqlite", "sqlite3", "db"] }]); if (p) setConfigForm((c) => ({ ...c, zotero: { ...c.zotero, database_path: p } })); }} />
        </Field>
      </div>
    </div>
  );
}

export function VaultsStep({ configForm, setConfigForm }: { configForm: ConfigForm; setConfigForm: Dispatch<SetStateAction<ConfigForm>> }) {
  return (
    <div className="flex flex-col gap-6 flex-1">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900">Obsidian Vaults</h2>
        <p className="text-sm text-zinc-500 mt-1">Connect vaults so Roxanne can search and write notes.</p>
      </div>
      <div className="flex flex-col gap-4">
        {configForm.obsidian_vaults.map((vault, i) => (
          <div key={vault.id} className="flex flex-col gap-3 p-4 border border-zinc-200 rounded-lg bg-zinc-50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Vault {i + 1}</span>
              {configForm.obsidian_vaults.length > 1 && (
                <button type="button" className="text-zinc-400 text-xs font-medium px-2 py-0.5 rounded-lg hover:text-red-600 hover:bg-red-50 transition-colors" onClick={() => setConfigForm((c) => ({ ...c, obsidian_vaults: c.obsidian_vaults.filter((v) => v.id !== vault.id) }))}>
                  Remove
                </button>
              )}
            </div>
            <PathPicker label="Vault folder" value={vault.path} placeholder="Click to select vault..." onPick={async () => {
              const p = await window.roxanne.pickDirectory();
              if (p) {
                const name = p.split("/").pop() || "";
                setConfigForm((c) => ({ ...c, obsidian_vaults: c.obsidian_vaults.map((v) => v.id === vault.id ? { ...v, path: p, name: v.name || name } : v) }));
              }
            }} />
            <Field label="Display name">
              <Input value={vault.name} placeholder="e.g. Research Notes" onChange={(e) => setConfigForm((c) => ({ ...c, obsidian_vaults: c.obsidian_vaults.map((v) => v.id === vault.id ? { ...v, name: e.target.value } : v) }))} />
            </Field>
          </div>
        ))}
        <Button variant="outline" className="self-start" onClick={() => setConfigForm((c) => ({ ...c, obsidian_vaults: [...c.obsidian_vaults, blankVault()] }))}>
          + Add another vault
        </Button>
      </div>
    </div>
  );
}

export function SpeechStep({ baseUrl }: { baseUrl: string }) {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progressEvent, setProgressEvent] = useState<SpeechSetupEvent | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (baseUrl) getSpeechStatus(baseUrl).then(setStatus).catch(() => {});
  }, [baseUrl]);

  async function handleInstall() {
    if (!baseUrl) return;
    setInstalling(true);
    setError("");
    setProgressEvent(null);
    try {
      await setupSpeechStreaming(baseUrl, (event) => {
        setProgressEvent(event);
        // Update status items live as each step completes
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

  const items = [
    { label: "Vosk STT", desc: "Real-time local speech recognition (~50 MB)", ready: status?.vosk_ready },
    { label: "Piper TTS", desc: "Local text-to-speech engine (~20 MB)", ready: status?.piper_installed },
    { label: "Voice model", desc: "Amy (en-US) voice (~40 MB)", ready: status?.voice_installed },
  ];

  return (
    <div className="flex flex-col gap-6 flex-1">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900">Local Speech</h2>
        <p className="text-sm text-zinc-500 mt-1">Vosk for real-time speech-to-text, Piper for text-to-speech. All local, no cloud.</p>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.label} className={cn("flex items-center gap-3 px-4 py-3 border rounded-lg transition-colors", item.ready ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-white")}>
            <div className={cn("shrink-0 w-8 h-8 grid place-items-center rounded-full transition-colors", item.ready ? "bg-emerald-100 text-emerald-600" : "bg-zinc-100 text-zinc-400")}>
              {item.ready ? <IconCheck /> : <span className="w-2 h-2 rounded-full bg-zinc-300" />}
            </div>
            <div>
              <strong className="block text-sm font-semibold">{item.label}</strong>
              <span className="block text-xs text-zinc-500">{item.desc}</span>
            </div>
            <span className={cn("ml-auto text-xs font-medium", item.ready ? "text-emerald-600" : "text-zinc-400")}>
              {item.ready ? "Installed" : "Pending"}
            </span>
          </div>
        ))}
      </div>

      {installing && progressEvent && (
        <SpeechSetupProgress progress={progressEvent.progress} detail={progressEvent.detail} currentStep={progressEvent.step} />
      )}

      {status?.ready ? (
        <div className="px-4 py-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-medium text-center">All speech models ready.</div>
      ) : (
        <Button onClick={handleInstall} disabled={installing} className="self-center min-w-[200px]">
          {installing ? "Installing..." : "Download & install speech models"}
        </Button>
      )}
      {error && <p className="text-sm text-red-500 bg-red-50 px-4 py-2 rounded-lg text-center">{error}</p>}
      {status && !status.piper_supported && (
        <p className="text-sm text-amber-600 bg-amber-50 px-4 py-2 rounded-lg">Piper TTS is not available for your platform. STT will still work.</p>
      )}
    </div>
  );
}

export function ReadyStep({ onFinish, finishing }: { onFinish: () => void; finishing: boolean }) {
  return (
    <div className="flex flex-col gap-6 flex-1 items-center text-center justify-center">
      <div className="w-16 h-16 grid place-items-center rounded-full bg-emerald-100 text-emerald-600">
        <IconCheck className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900">You're all set</h1>
      <p className="text-sm leading-relaxed text-zinc-500 max-w-[420px]">
        Roxanne will save your settings and open the app right away. Your local search index can finish building in the background.
      </p>
      <Button className="mt-2 min-w-[200px]" onClick={onFinish} disabled={finishing}>
        {finishing ? "Opening Roxanne..." : "Save & open Roxanne"}
      </Button>
    </div>
  );
}
