import { useCallback, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { ConfigForm, SpeechStatus } from "../types";
import type { OllamaPullEvent, OllamaStatus, SpeechSetupEvent } from "../api";
import { getOllamaStatus, getSpeechStatus, pullOllamaModel, setupSpeechStreaming, startOllama } from "../api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { cn } from "../lib/cn";
import { MODEL_PRESETS } from "../lib/config";
import { IconCheck, IconChevron, IconFolder, IconX } from "./Icons";

export type SetupNeed = "ollama" | "vosk" | "piper" | null;

export function SetupModal({ need, baseUrl, configForm, setConfigForm, onClose }: {
  need: SetupNeed;
  baseUrl: string;
  configForm: ConfigForm;
  setConfigForm: Dispatch<SetStateAction<ConfigForm>>;
  onClose: () => void;
}) {
  if (!need) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fade-in_150ms_ease-out]" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-sm border border-zinc-200 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto animate-[scale-in_200ms_ease-out]">
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">
              {need === "ollama" && "Ollama Setup Required"}
              {need === "vosk" && "Speech-to-Text Setup"}
              {need === "piper" && "Text-to-Speech Setup"}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {need === "ollama" && "Ollama is needed to run your local LLM."}
              {need === "vosk" && "Vosk is needed for voice transcription."}
              {need === "piper" && "Piper is needed for text-to-speech."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors">
            <IconX />
          </button>
        </div>
        <div className="px-6 pb-6 pt-2">
          {need === "ollama" && (
            <OllamaSetupPanel baseUrl={baseUrl} configForm={configForm} setConfigForm={setConfigForm} />
          )}
          {need === "vosk" && (
            <VoskSetupPanel baseUrl={baseUrl} onDone={onClose} />
          )}
          {need === "piper" && (
            <PiperSetupPanel baseUrl={baseUrl} onDone={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

export function VoskSetupPanel({ baseUrl, onDone }: { baseUrl: string; onDone: () => void }) {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [setupEvents, setSetupEvents] = useState<SpeechSetupEvent[]>([]);

  useEffect(() => {
    void (async () => {
      try { setStatus(await getSpeechStatus(baseUrl)); } catch {}
    })();
  }, [baseUrl]);

  async function handleInstall() {
    setInstalling(true);
    try {
      await setupSpeechStreaming(baseUrl, (ev) => setSetupEvents((p) => [...p.slice(-5), ev]));
      const s = await getSpeechStatus(baseUrl);
      setStatus(s);
      if (s.vosk_ready) onDone();
    } catch {} finally {
      setInstalling(false);
    }
  }

  const lastEvent = setupEvents[setupEvents.length - 1];

  return (
    <div className="flex flex-col gap-3">
      <div className={cn("flex items-center gap-2 px-3 py-2 border rounded-lg text-xs", status?.vosk_ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-zinc-50 text-zinc-500")}>
        <span className={cn("shrink-0 w-5 h-5 grid place-items-center rounded-full", status?.vosk_ready ? "bg-emerald-100" : "bg-zinc-200")}>
          {status?.vosk_ready ? <IconCheck className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />}
        </span>
        <span className="font-medium">Vosk STT model</span>
        <span className="ml-auto font-medium">{status?.vosk_ready ? "Installed" : "Not installed"}</span>
      </div>

      {!status?.vosk_ready && !installing && (
        <div>
          <p className="text-xs text-zinc-500 mb-3">This will download a ~50 MB speech recognition model. It may take a few minutes.</p>
          <Button size="sm" onClick={handleInstall}>Download &amp; install Vosk</Button>
        </div>
      )}

      {installing && lastEvent && (
        <div className="px-4 py-3 rounded-lg border border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-amber-500 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
            <span className="text-xs font-semibold text-amber-800">Installing...</span>
          </div>
          <p className="text-xs text-amber-600">{lastEvent.detail || lastEvent.step}</p>
        </div>
      )}
    </div>
  );
}

export function PiperSetupPanel({ baseUrl, onDone }: { baseUrl: string; onDone: () => void }) {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [setupEvents, setSetupEvents] = useState<SpeechSetupEvent[]>([]);

  useEffect(() => {
    void (async () => {
      try { setStatus(await getSpeechStatus(baseUrl)); } catch {}
    })();
  }, [baseUrl]);

  async function handleInstall() {
    setInstalling(true);
    try {
      await setupSpeechStreaming(baseUrl, (ev) => setSetupEvents((p) => [...p.slice(-5), ev]));
      const s = await getSpeechStatus(baseUrl);
      setStatus(s);
      if (s.piper_installed && s.voice_installed) onDone();
    } catch {} finally {
      setInstalling(false);
    }
  }

  const lastEvent = setupEvents[setupEvents.length - 1];

  return (
    <div className="flex flex-col gap-3">
      {[
        { label: "Piper TTS", ok: status?.piper_installed },
        { label: "Voice model", ok: status?.voice_installed },
      ].map((item) => (
        <div key={item.label} className={cn("flex items-center gap-2 px-3 py-2 border rounded-lg text-xs", item.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-zinc-50 text-zinc-500")}>
          <span className={cn("shrink-0 w-5 h-5 grid place-items-center rounded-full", item.ok ? "bg-emerald-100" : "bg-zinc-200")}>
            {item.ok ? <IconCheck className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />}
          </span>
          <span className="font-medium">{item.label}</span>
          <span className="ml-auto font-medium">{item.ok ? "Installed" : "Not installed"}</span>
        </div>
      ))}

      {(!status?.piper_installed || !status?.voice_installed) && !installing && (
        <div>
          <p className="text-xs text-zinc-500 mb-3">This will download the Piper TTS engine and a voice model. May take a few minutes.</p>
          <Button size="sm" onClick={handleInstall}>Download &amp; install</Button>
        </div>
      )}

      {installing && lastEvent && (
        <div className="px-4 py-3 rounded-lg border border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-amber-500 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
            <span className="text-xs font-semibold text-amber-800">Installing...</span>
          </div>
          <p className="text-xs text-amber-600">{lastEvent.detail || lastEvent.step}</p>
        </div>
      )}
    </div>
  );
}

export function OllamaSetupPanel({ baseUrl, configForm, setConfigForm }: { baseUrl: string; configForm: ConfigForm; setConfigForm: Dispatch<SetStateAction<ConfigForm>> }) {
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullEvent, setPullEvent] = useState<OllamaPullEvent | null>(null);
  const [error, setError] = useState("");
  const hasChecked = useRef(false);

  const checkStatus = useCallback(async () => {
    try {
      const s = await getOllamaStatus(baseUrl);
      setOllamaStatus(s);
      return s;
    } catch { return null; }
  }, [baseUrl]);

  useEffect(() => {
    if (!hasChecked.current && baseUrl) {
      hasChecked.current = true;
      void checkStatus();
    }
  }, [baseUrl, checkStatus]);

  const selectedModel = configForm.anthropic.model;
  const isCustom = !MODEL_PRESETS.ollama.some((p) => p.value && p.value === selectedModel);
  useEffect(() => {
    if (baseUrl && ollamaStatus?.running && selectedModel) void checkStatus();
  }, [selectedModel]);

  async function handleStart() {
    setStarting(true);
    setError("");
    try {
      const result = await startOllama(baseUrl);
      if (!result.ok) {
        setError(result.error || "Failed to start Ollama.");
      }
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  async function handlePull(model?: string) {
    const modelToPull = model || selectedModel;
    setPulling(true);
    setPullEvent(null);
    setError("");
    try {
      await pullOllamaModel(baseUrl, modelToPull, (ev) => {
        setPullEvent(ev);
        if (ev.status === "error") setError(ev.detail);
      });
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(false);
    }
  }

  const normalizeModelName = (m: string) => m.includes(":") ? m : `${m}:latest`;
  const isModelInstalled = (model: string) => ollamaStatus?.models.some((m) => {
    return normalizeModelName(m) === normalizeModelName(model);
  }) ?? false;
  const modelInstalled = isModelInstalled(selectedModel);

  if (!ollamaStatus) {
    return <div className="text-xs text-zinc-400 text-center py-4">Checking Ollama status...</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {!ollamaStatus.installed && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
          <p className="font-semibold mb-1">Ollama not found</p>
          <p>Install Ollama to run models locally. Open your terminal and run:</p>
          <code className="block mt-2 px-3 py-2 bg-amber-100 rounded-lg font-mono text-xs">brew install ollama</code>
          <p className="mt-2 text-amber-600">Or download from <span className="underline">ollama.com/download</span></p>
          <Button size="sm" className="mt-3" onClick={() => void checkStatus()}>Check again</Button>
        </div>
      )}

      {ollamaStatus.installed && !ollamaStatus.running && (
        <Button size="sm" onClick={handleStart} disabled={starting}>
          {starting ? "Starting server..." : "Start Ollama server"}
        </Button>
      )}

      {ollamaStatus.running && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-zinc-600">Select model</label>
          <Select
            value={isCustom ? "" : selectedModel}
            onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, model: e.target.value } }))}
          >
            {(MODEL_PRESETS.ollama || []).map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}{p.value && isModelInstalled(p.value) ? " (installed)" : p.value ? " (needs download)" : ""}
              </option>
            ))}
          </Select>
          {isCustom && (
            <Input
              placeholder="Type a model name (e.g. codellama:7b)"
              value={selectedModel}
              onChange={(e) => setConfigForm((c) => ({ ...c, anthropic: { ...c.anthropic, model: e.target.value } }))}
            />
          )}
        </div>
      )}

      {ollamaStatus.running && !modelInstalled && !pulling && selectedModel && (
        <Button size="sm" onClick={() => handlePull()}>
          Download {selectedModel}
        </Button>
      )}

      {pulling && pullEvent && (
        <div className="flex flex-col gap-3 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
            <div>
              <p className="text-xs font-semibold text-amber-800">Downloading {selectedModel}...</p>
              <p className="text-xs text-amber-600 mt-0.5">This may take several minutes for larger models.</p>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-amber-700">
            <span className="truncate max-w-[80%]">{pullEvent.detail}</span>
            <span className="font-semibold">{Math.round(pullEvent.progress * 100)}%</span>
          </div>
          <div className="w-full h-1.5 bg-amber-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full transition-all duration-300" style={{ width: `${Math.round(pullEvent.progress * 100)}%` }} />
          </div>
        </div>
      )}

      {ollamaStatus.running && modelInstalled && (
        <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-medium text-center">
          Ready — {selectedModel} is installed and Ollama is running.
        </div>
      )}

      {ollamaStatus.running && ollamaStatus.models.length > 0 && (
        <div className="text-xs text-zinc-400">
          Installed: {ollamaStatus.models.join(", ")}
        </div>
      )}

      {error && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
    </div>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: ReactNode; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {hint && <p className="text-zinc-400 text-xs leading-snug">{hint}</p>}
      {children}
    </div>
  );
}

export function PathPicker({ value, onPick, placeholder, label }: { value: string; onPick: () => void; placeholder?: string; label?: string }) {
  return (
    <button
      type="button"
      className="flex items-center gap-3 w-full px-3 py-3 border border-zinc-200 rounded-lg bg-white text-left cursor-pointer transition-colors hover:border-zinc-300"
      onClick={onPick}
    >
      <div className="shrink-0 w-9 h-9 grid place-items-center rounded-lg bg-zinc-100 text-zinc-500">
        <IconFolder />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-zinc-900 uppercase tracking-wide">{label || "Choose folder"}</span>
        <span className="text-sm text-zinc-500 truncate">{value || placeholder || "Click to browse..."}</span>
      </div>
      <IconChevron className="shrink-0 text-zinc-400" />
    </button>
  );
}

export function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-2 rounded-full transition-all duration-200",
            i === current ? "w-6 bg-zinc-900" : i < current ? "w-2 bg-emerald-500" : "w-2 bg-zinc-200"
          )}
        />
      ))}
    </div>
  );
}

export function SpeechSetupProgress({ progress, detail, currentStep }: { progress: number; detail: string; currentStep: string }) {
  const pct = Math.round(progress * 100);
  const stepLabels: Record<string, string> = { vosk: "Vosk STT", piper: "Piper TTS", voice: "Voice model", done: "Complete" };
  return (
    <div className="flex flex-col gap-4 px-4 py-4 rounded-lg border border-amber-200 bg-amber-50">
      <div className="flex items-start gap-2">
        <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
        <div>
          <p className="text-sm font-semibold text-amber-800">Downloading {stepLabels[currentStep] || currentStep}...</p>
          <p className="text-xs text-amber-600 mt-0.5">This may take a few minutes depending on your connection. Please don't close the app.</p>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-amber-700">
          <span className="font-medium">{detail}</span>
          <span className="font-semibold">{pct}%</span>
        </div>
        <div className="w-full h-1.5 bg-amber-100 rounded-full overflow-hidden">
          <div className="h-full bg-amber-500 rounded-full transition-all duration-300 ease-out" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
