import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";

import {
  createConversation,
  deleteConversation,
  getConfig,
  getConversation,
  getIndexStats,
  listConversations,
  runIndex,
  saveConfig,
  streamChat,
  waitForBackend,
  runIndexStreaming,
  getIndexActivity,
} from "./api";
import type { ConversationSummary, IndexEvent } from "./api";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./lib/cn";
import {
  EMPTY_CONFIG,
  TOTAL_STEPS,
  appendStatusMessage,
  blankVault,
  hasVaults,
  makeId,
  mergePapers,
  publicToForm,
  sanitizeConfig,
  type WizardStep,
} from "./lib/config";
import type {
  ChatMessage,
  ConfigForm,
  IndexStats,
  NoteHit,
  PaperHit,
  PublicConfig,
  RuntimeInfo,
  StreamEvent,
} from "./types";

import { IconMic, IconRefresh, IconSend, IconSettings, IconSpeaker, IconX } from "./components/Icons";
import { ToastContainer, useToasts } from "./components/Toast";
import { SetupModal, StepDots, type SetupNeed } from "./components/SetupModal";
import {
  CitationContent,
  RecordingPill,
  SpeakingPill,
  TranscribingPill,
  ToolStepsGroup,
  buildConversationHistory,
  groupMessages,
} from "./components/ChatMessages";
import { WelcomeStep, AnthropicStep, ZoteroStep, VaultsStep, SpeechStep, ReadyStep } from "./components/Wizard";
import IndexBrowser from "./components/IndexBrowser";
import SettingsPanel from "./components/SettingsPanel";
import { useVoiceMode } from "./hooks/useVoiceMode";

/* ------------------------------------------------------------------ */
/*  Main App                                                           */
/* ------------------------------------------------------------------ */

export function App() {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [savedConfig, setSavedConfig] = useState<PublicConfig | null>(null);
  const [configForm, setConfigForm] = useState<ConfigForm>({ ...EMPTY_CONFIG, obsidian_vaults: [blankVault()] });
  const [messages, setMessagesState] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const setMessages = useCallback((updater: SetStateAction<ChatMessage[]>) => {
    setMessagesState((current) => {
      const next = typeof updater === "function"
        ? (updater as (value: ChatMessage[]) => ChatMessage[])(current)
        : updater;
      messagesRef.current = next;
      return next;
    });
  }, []);
  const [papers, setPapers] = useState<PaperHit[]>([]);
  const [notes, setNotes] = useState<NoteHit[]>([]);
  const [draft, setDraft] = useState("");
  const [showSetup, setShowSetup] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState("");
  const [bootError, setBootError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(0);
  const [finishing, setFinishing] = useState(false);
  const [showPanel, setShowPanel] = useState<"" | "settings" | "index">("");
  const [indexStats, setIndexStats] = useState<IndexStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [setupNeed, setSetupNeed] = useState<SetupNeed>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, _setActiveConvId] = useState<string | null>(null);
  const activeConvIdRef = useRef<string | null>(null);
  function setActiveConvId(id: string | null) {
    activeConvIdRef.current = id;
    _setActiveConvId(id);
  }

  const { toasts, addToast, dismissToast } = useToasts();
  const sessionIdRef = useRef(makeId());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const voice = useVoiceMode({
    baseUrl,
    isSending,
    onSend: (text) => void handleSend(text, "stt"),
    onTranscription: (text) => setDraft((c) => [c.trim(), text.trim()].filter(Boolean).join(" ").trim()),
    onSetupNeeded: (need) => setSetupNeed(need),
    addToast,
  });

  function triggerSetup(need: SetupNeed) {
    setSetupNeed(need);
    setIsSending(false);
    if (voice.isVoiceActive()) {
      voice.stopVoiceConversation();
    }
  }

  const chatReady = Boolean(savedConfig?.is_complete);

  /* ---- Bootstrap ---- */

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const rt = await window.roxanne.getRuntimeInfo();
        if (cancelled) return;
        setRuntime(rt);
        setBaseUrl(rt.backendBaseUrl);
        await waitForBackend(rt.backendBaseUrl);
        const cfg = await getConfig(rt.backendBaseUrl);
        if (cancelled) return;
        setSavedConfig(cfg);
        setConfigForm(publicToForm(cfg));
        if (cfg.is_complete) {
          setShowSetup(false);
        } else {
          setShowSetup(true);
          const hasKey = Boolean(cfg.anthropic.api_key);
          const hasModel = Boolean(cfg.anthropic.model?.trim());
          const hasZotero = Boolean(cfg.zotero.storage_path?.trim());
          const hasV = cfg.obsidian_vaults.some((v) => v.name.trim() && v.path.trim());
          if (hasKey && hasModel && hasZotero && hasV) setWizardStep(4);
          else if (hasKey && hasModel && hasZotero) setWizardStep(3);
          else if (hasKey && hasModel) setWizardStep(2);
          else if (hasKey) setWizardStep(1);
          else setWizardStep(0);
        }
      } catch (error) {
        setBootError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
      voice.cleanup();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ---- Wizard navigation ---- */

  function canAdvance(): boolean {
    if (wizardStep === 0) return true;
    if (wizardStep === 1) {
      const hasModel = Boolean(configForm.anthropic.model.trim());
      if (configForm.anthropic.provider === "ollama") return hasModel;
      return Boolean((savedConfig?.anthropic.api_key || configForm.anthropic.api_key.trim()) && hasModel);
    }
    if (wizardStep === 2) return Boolean(configForm.zotero.storage_path.trim());
    if (wizardStep === 3) return hasVaults(configForm.obsidian_vaults);
    return true;
  }

  async function persistCurrentStep(): Promise<void> {
    if (!baseUrl) return;
    setSaving(true);
    try {
      const nextConfig = await saveConfig(baseUrl, sanitizeConfig(configForm));
      setSavedConfig(nextConfig);
      setConfigForm(publicToForm(nextConfig));
    } catch {} finally {
      setSaving(false);
    }
  }

  async function nextWizardStep() {
    if (wizardStep >= TOTAL_STEPS - 1) return;
    if (wizardStep >= 1 && wizardStep <= 3) await persistCurrentStep();
    setWizardStep((wizardStep + 1) as WizardStep);
  }

  async function prevWizardStep() {
    if (wizardStep <= 0) return;
    if (wizardStep >= 1 && wizardStep <= 4) await persistCurrentStep();
    setWizardStep((wizardStep - 1) as WizardStep);
  }

  async function finishSetup() {
    if (!baseUrl) return;
    setFinishing(true);
    try {
      const nextConfig = await saveConfig(baseUrl, sanitizeConfig(configForm));
      setSavedConfig(nextConfig);
      setConfigForm(publicToForm(nextConfig));
      setShowSetup(false);
      addToast("success", "Setup complete", "Roxanne is ready. Indexing will continue in the background.");
      window.setTimeout(() => {
        void triggerIndex("all");
      }, 0);
    } catch (error) {
      addToast("error", "Setup error", error instanceof Error ? error.message : String(error));
    } finally {
      setFinishing(false);
    }
  }

  /* ---- Conversations ---- */

  async function fetchConversations(autoSelect = false) {
    if (!baseUrl) return;
    try {
      const convs = await listConversations(baseUrl);
      setConversations(convs);
      if (autoSelect && !activeConvId && convs.length > 0) {
        void switchConversation(convs[0].id);
      }
    } catch {}
  }

  async function startNewConversation() {
    if (!baseUrl) return;
    try {
      const conv = await createConversation(baseUrl);
      setActiveConvId(conv.id);
      setMessages([]);
      setPapers([]);
      setNotes([]);
      setDraft("");
      await fetchConversations();
    } catch {}
  }

  async function switchConversation(convId: string) {
    if (!baseUrl || convId === activeConvId) return;
    try {
      const conv = await getConversation(baseUrl, convId);
      setActiveConvId(convId);
      const uiMessages: ChatMessage[] = conv.messages.map((m, i) => ({
        id: `conv-${convId}-${i}`,
        role: m.role as ChatMessage["role"],
        content: m.content,
      }));
      setMessages(uiMessages);
      setPapers([]);
      setNotes([]);
      setDraft("");
      setShowPanel("");
    } catch {}
  }

  async function handleDeleteConversation(convId: string) {
    if (!baseUrl) return;
    try {
      await deleteConversation(baseUrl, convId);
      if (activeConvId === convId) {
        setActiveConvId(null);
        setMessages([]);
      }
      await fetchConversations();
    } catch {}
  }

  /* ---- Workspace actions ---- */

  async function fetchStats() {
    if (!baseUrl) return;
    try {
      setIndexStats(await getIndexStats(baseUrl));
    } catch {}
  }

  useEffect(() => {
    if (!showSetup && !loading && baseUrl) {
      void fetchStats();
      void fetchConversations(true);
    }
  }, [showSetup, loading, baseUrl]);

  const [indexEvent, setIndexEvent] = useState<IndexEvent | null>(null);
  const [indexRunning, setIndexRunning] = useState(false);

  const indexRunningRef = useRef(false);
  useEffect(() => {
    indexRunningRef.current = indexRunning;
  }, [indexRunning]);

  useEffect(() => {
    if (!baseUrl) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const act = await getIndexActivity(baseUrl);
        setIndexRunning(act.running);
        if (act.last_event) setIndexEvent(act.last_event);
      } catch {}
      if (!cancelled) {
        const delay = indexRunningRef.current ? 2000 : 30000;
        timer = setTimeout(poll, delay);
      }
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [baseUrl]);

  async function triggerIndex(scope: "all" | "papers" | "notes") {
    if (!baseUrl || indexRunning) return;
    setIndexRunning(true);
    setIndexEvent(null);
    try {
      if (scope === "all") {
        await runIndexStreaming(baseUrl, (ev) => setIndexEvent(ev));
      } else {
        setBusyLabel(`Indexing ${scope}...`);
        await runIndex(baseUrl, scope);
        setBusyLabel("");
      }
      addToast("success", "Indexing complete", `${scope} re-indexed successfully.`);
      await fetchStats();
    } catch (error) {
      addToast("error", "Index error", error instanceof Error ? error.message : String(error));
    } finally {
      setIndexRunning(false);
      setIndexEvent(null);
      setBusyLabel("");
    }
  }

  /* ---- Chat ---- */

  async function handleSend(overrideText?: string, origin: "text" | "stt" = "text") {
    const prompt = (overrideText ?? draft).trim();
    if (!prompt || !baseUrl) return;
    if (!voice.isVoiceActive() && isSending) return;
    const assistantMessageId = makeId();

    voice.resetTTSState();
    if (!overrideText) setDraft("");
    setIsSending(true);

    if (origin === "stt") {
      voice.onSendFromSTT();
    }

    let convId = activeConvIdRef.current;
    if (!convId) {
      try {
        const conv = await createConversation(baseUrl, prompt.slice(0, 80));
        convId = conv.id;
        setActiveConvId(convId);
      } catch {}
    }

    const history = buildConversationHistory(messagesRef.current);

    setMessages((c) => [...c, { id: makeId(), role: "user", content: prompt }, { id: assistantMessageId, role: "assistant", content: "" }]);

    try {
      await streamChat(
        baseUrl,
        {
          message: prompt,
          history,
          session_id: sessionIdRef.current,
          voice_mode: voice.isVoiceActive(),
          conversation_id: convId,
        },
        async (event) => {
          await handleStreamEvent(event, assistantMessageId);
        }
      );
    } catch (error) {
      appendStatusMessage(setMessages, `Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (convId) void fetchConversations();
      setIsSending(false);
      voice.finishVoiceTurnIfReady();
    }
  }

  async function handleStreamEvent(event: StreamEvent, assistantMessageId: string) {
    if (event.type === "assistant_delta") {
      setMessages((c) => c.map((m) => (m.id === assistantMessageId ? { ...m, content: `${m.content}${event.delta || ""}` } : m)));
      if (voice.isVoiceActive() && event.delta) {
        voice.feedTTSDelta(event.delta);
      }
      return;
    }
    if (event.type === "assistant_done") {
      const payload = (event.payload || {}) as { message?: string };
      if (payload.message) {
        setMessages((c) => c.map((m) => (m.id === assistantMessageId ? { ...m, content: payload.message || "" } : m)));
        if (voice.isVoiceActive()) {
          voice.feedTTSDelta(payload.message);
          voice.flushTTSBuffer();
        }
      }
      voice.finishVoiceTurnIfReady();
      return;
    }
    if (event.type === "status") {
      appendStatusMessage(setMessages, event.message || "Running tool...");
      if (voice.isVoiceActive() && event.tool && !voice.isTTSPlaying() && voice.isTTSQueueEmpty()) {
        const toolSpeech: Record<string, string> = {
          search_sources: "Searching your sources.",
          search_zotero: "Searching now.",
          search_zotero_metadata: "Looking that up.",
          retrieve_paper_chunks: "Reading the paper.",
          get_paper_metadata: "Getting details.",
          get_paper_notes: "Checking notes.",
          get_paper_annotations: "Checking highlights.",
          search_zotero_notes: "Searching notes.",
          list_zotero_collections: "Listing collections.",
          get_collection_papers: "Getting papers.",
          read_notes: "Checking notes.",
          write_note: "Writing a note.",
          open_pdf: "Opening the PDF.",
        };
        const phrase = toolSpeech[event.tool] || "Working on it.";
        voice.enqueueTTS(phrase);
      }
      return;
    }
    if (event.type === "tool_result") {
      applyToolPayload(event);
      return;
    }
    if (event.type === "error") {
      const msg = event.message || "Unknown error.";
      const setupMatch = msg.match(/\[SETUP_REQUIRED:(\w+)\]/);
      if (setupMatch) {
        const need = setupMatch[1] as "ollama" | "vosk" | "piper";
        triggerSetup(need);
        appendStatusMessage(setMessages, msg.replace(/\[SETUP_REQUIRED:\w+\]\s*/, ""));
      } else {
        appendStatusMessage(setMessages, msg);
      }
    }
  }

  function applyToolPayload(event: StreamEvent) {
    const showableTools = ["search_sources", "read_notes", "search_zotero", "search_zotero_metadata", "retrieve_paper_chunks", "get_paper_notes", "get_paper_annotations"];
    if (event.tool && showableTools.includes(event.tool)) {
      setMessages((c) => [
        ...c,
        {
          id: makeId(),
          role: "tool_card" as const,
          content: "",
          toolCard: { tool: event.tool!, payload: event.payload },
        },
      ]);
    }

    if (event.tool === "search_zotero" || event.tool === "search_zotero_metadata") {
      setPapers((c) => mergePapers(c, (event.payload as PaperHit[]) || []));
      return;
    }
    if (event.tool === "retrieve_paper_chunks") {
      const derived = ((event.payload as Array<Record<string, unknown>>) || []).map((item) => ({
        paper_id: String(item.paper_id || ""),
        title: String(item.title || "Untitled paper"),
        file_path: String(item.file_path || ""),
        chunk: String(item.chunk || ""),
      }));
      setPapers((c) => mergePapers(c, derived));
      return;
    }
    if (event.tool === "read_notes") {
      setNotes((event.payload as NoteHit[]) || []);
      return;
    }
    if (event.tool === "write_note") {
      const payload = event.payload as { relative_path?: string; vault_name?: string };
      appendStatusMessage(setMessages, `Note written to ${payload.relative_path || "unknown"} in ${payload.vault_name || "vault"}.`);
    }
  }

  /* ---- Settings save ---- */

  async function saveSettingsFromPanel() {
    if (!baseUrl) return;
    setSaving(true);
    try {
      const nextConfig = await saveConfig(baseUrl, sanitizeConfig(configForm));
      setSavedConfig(nextConfig);
    } catch (error) {
      addToast("error", "Save error", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (showPanel !== "settings" || !baseUrl) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void saveSettingsFromPanel();
    }, 800);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [configForm, showPanel]);

  /* ---- Loading / Error ---- */

  if (loading) {
    return (
      <div className="h-full grid place-items-center bg-zinc-50">
        <div className="flex flex-col items-center gap-3 animate-[fade-in_400ms_ease-out_both]">
          <div className="w-8 h-8 border-[3px] border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
          <p className="text-sm text-zinc-500">Starting Roxanne...</p>
        </div>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="h-full grid place-items-center bg-zinc-50">
        <div className="flex flex-col items-center gap-3 animate-[fade-in_400ms_ease-out_both] max-w-[400px] text-center">
          <div className="w-12 h-12 grid place-items-center rounded-full bg-red-100 text-red-600">
            <IconX className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-red-600">Startup Error</h2>
          <p className="text-sm text-zinc-500">{bootError}</p>
        </div>
      </div>
    );
  }

  /* ---- Onboarding Wizard ---- */

  if (showSetup) {
    return (
      <div className="h-full grid place-items-center bg-zinc-50 p-6">
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <div className="w-full max-w-[540px] flex flex-col gap-6 animate-[fade-in_300ms_ease-out_both]">
          <StepDots current={wizardStep} total={TOTAL_STEPS} />
          <div className="bg-white border border-zinc-200 rounded-lg shadow-sm p-8 min-h-[340px] flex flex-col">
            {wizardStep === 0 && <WelcomeStep onNext={nextWizardStep} />}
            {wizardStep === 1 && <AnthropicStep configForm={configForm} setConfigForm={setConfigForm} savedConfig={savedConfig} baseUrl={baseUrl} />}
            {wizardStep === 2 && <ZoteroStep configForm={configForm} setConfigForm={setConfigForm} baseUrl={baseUrl} />}
            {wizardStep === 3 && <VaultsStep configForm={configForm} setConfigForm={setConfigForm} />}
            {wizardStep === 4 && <SpeechStep baseUrl={baseUrl} />}
            {wizardStep === 5 && <ReadyStep onFinish={finishSetup} finishing={finishing} />}
          </div>
          {wizardStep > 0 && (
            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => void prevWizardStep()} disabled={saving}>Back</Button>
              {wizardStep < 5 && (
                <Button onClick={() => void nextWizardStep()} disabled={!canAdvance() || saving}>
                  {saving ? "Saving..." : "Continue"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---- Workspace ---- */

  return (
    <div className="h-full overflow-hidden grid grid-cols-[240px_minmax(0,1fr)]">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <SetupModal need={setupNeed} baseUrl={baseUrl} configForm={configForm} setConfigForm={setConfigForm} onClose={() => setSetupNeed(null)} />

      {/* ── Sidebar ── */}
      <aside className="flex flex-col h-full overflow-hidden border-r border-zinc-200 bg-zinc-50">
        <div className="flex items-center justify-between pl-[78px] pr-3 pt-3 pb-2 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
          <span className="text-xs font-bold tracking-tight text-zinc-900 select-none">Roxanne</span>
          {busyLabel ? (
            <Badge tone="muted">{busyLabel}</Badge>
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" title="Ready" />
          )}
        </div>

        <div className="px-3 pb-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
            onClick={() => void startNewConversation()}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            New chat
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-1.5">
          {conversations.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors",
                    activeConvId === conv.id
                      ? "bg-white text-zinc-900 font-semibold shadow-sm border border-zinc-200"
                      : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700"
                  )}
                  onClick={() => void switchConversation(conv.id)}
                >
                  <svg className="w-3 h-3 shrink-0 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" /></svg>
                  <span className="flex-1 truncate">{conv.title}</span>
                  <button
                    type="button"
                    className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-zinc-400 hover:text-red-500 transition-colors p-0.5"
                    onClick={(e) => { e.stopPropagation(); void handleDeleteConversation(conv.id); }}
                  >
                    <IconX className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-400 text-center py-6">No conversations yet</p>
          )}
        </div>

        <div className="px-3 py-2 border-t border-zinc-200 flex flex-col gap-1">
          {indexRunning && indexEvent ? (
            <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
                <span className="text-xs font-medium text-amber-700 truncate">{indexEvent.current_file || indexEvent.detail}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-amber-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full transition-all duration-300" style={{ width: `${Math.round(indexEvent.progress * 100)}%` }} />
                </div>
                <span className="text-xs text-amber-600 font-mono shrink-0">
                  {indexEvent.done}/{indexEvent.total_files}
                </span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 transition-colors"
              onClick={() => setShowPanel(showPanel === "index" ? "" : "index")}
            >
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Zm3.75 11.625a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>
              <span className="font-medium">Index</span>
              <span className="ml-auto text-xs text-zinc-400 font-mono">
                {indexStats ? `${indexStats.papers ?? 0}p · ${indexStats.notes ?? 0}n` : "—"}
              </span>
            </button>
          )}
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors w-full",
              "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900",
              indexRunning && "opacity-50 pointer-events-none"
            )}
            disabled={indexRunning}
            onClick={() => void triggerIndex("all")}
          >
            <IconRefresh className={cn("w-3.5 h-3.5", indexRunning && "animate-spin")} />
            {indexRunning ? "Indexing…" : "Reindex all"}
          </button>
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors w-full",
              showPanel === "settings" ? "bg-white text-zinc-900 shadow-sm border border-zinc-200" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
            )}
            onClick={() => setShowPanel(showPanel === "settings" ? "" : "settings")}
          >
            <IconSettings className="w-3.5 h-3.5" />
            Settings
          </button>
        </div>
      </aside>

      {/* ── Settings (full-screen overlay) ── */}
      {showPanel === "settings" && (
        <SettingsPanel
          configForm={configForm}
          setConfigForm={setConfigForm}
          savedConfig={savedConfig}
          saving={saving}
          onClose={() => setShowPanel("")}
          baseUrl={baseUrl}
        />
      )}

      {/* ── Main ── */}
      <main className="flex flex-col h-full min-h-0 bg-white">
        {showPanel === "index" ? (
          <IndexBrowser baseUrl={baseUrl} onClose={() => setShowPanel("")} />
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-2 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
              <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                <span className="text-xs font-medium text-zinc-400">{savedConfig?.anthropic.model || "Model"}</span>
                {isSending && <Badge tone="muted">Thinking...</Badge>}
              </div>
              <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                {voice.isRecording && <RecordingPill />}
                {voice.isTranscribing && <TranscribingPill />}
                {voice.isSpeaking && (
                  <button type="button" onClick={voice.stopSpeaking} className="cursor-pointer">
                    <SpeakingPill />
                  </button>
                )}
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border",
                    voice.voiceMode && voice.voiceState === "active"
                      ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                      : voice.voiceMode
                        ? "bg-amber-50 border-amber-300 text-amber-700"
                        : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-900"
                  )}
                  onClick={() => voice.voiceMode ? voice.stopVoiceConversation() : void voice.startVoiceConversation()}
                >
                  <IconMic className="w-3.5 h-3.5" />
                  {voice.voiceMode
                    ? voice.voiceState === "active"
                      ? "Listening…"
                      : "Say \"Roxanne\" to start"
                    : "Voice chat"
                  }
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3">
              {messages.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
                  <h2 className="text-base font-semibold text-zinc-900">Ask Roxanne anything about your research</h2>
                  <p className="text-sm text-zinc-400 max-w-[440px] leading-relaxed">
                    Search your Zotero papers, look through notes, or ask Roxanne to summarize a paper.
                  </p>
                </div>
              )}
              {(() => {
                const groups = groupMessages(messages);
                return groups.map((group, gi) => {
                  if (group.kind === "tool_steps") {
                    const isLatest = gi === groups.length - 1 || (gi === groups.length - 2 && groups[groups.length - 1].kind === "assistant" && !(groups[groups.length - 1] as { msg: ChatMessage }).msg.content);
                    return <ToolStepsGroup key={`tg-${gi}`} steps={group.steps} isLatest={isLatest && isSending} />;
                  }
                  const msg = group.msg;
                  if (msg.role === "assistant" && !msg.content && !isSending) return null;
                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "max-w-[min(85%,720px)] animate-[fade-in_200ms_ease-out_both]",
                        msg.role === "user" && "self-end",
                        msg.role === "assistant" && "self-start",
                      )}
                    >
                      {msg.role === "user" ? (
                        <div className="bg-zinc-900 text-white rounded-2xl rounded-br-sm px-4 py-3">
                          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                        </div>
                      ) : (
                        <div className="bg-white border border-zinc-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                          {msg.content ? (
                            <CitationContent content={msg.content} />
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-pulse" />
                              <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-pulse [animation-delay:150ms]" />
                              <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-pulse [animation-delay:300ms]" />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
              <div ref={messagesEndRef} />
            </div>

            <div className="shrink-0 px-5 py-3 border-t border-zinc-200 bg-white">
              {voice.voiceMode ? (
                <div className="flex flex-col gap-2 py-2">
                  {voice.voiceState === "active" && voice.liveTranscript && voice.liveTranscript !== "…" && voice.liveTranscript !== "Listening…" && (
                    <div className="px-3 py-2 mx-auto max-w-[600px] bg-zinc-50 border border-zinc-200 rounded-lg animate-[fade-in_150ms_ease-out_both]">
                      <p className="text-sm text-zinc-700 italic leading-relaxed">&ldquo;{voice.liveTranscript}&rdquo;</p>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-3">
                    <div className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-full border transition-all",
                      voice.voiceState === "active" ? "bg-emerald-50 border-emerald-200" : isSending ? "bg-blue-50 border-blue-200" : voice.isSpeaking ? "bg-blue-50 border-blue-200" : "bg-amber-50 border-amber-200"
                    )}>
                      {voice.voiceState === "listening" && !isSending && !voice.isSpeaking && (
                        <>
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
                          </span>
                          <span className="text-xs font-medium text-amber-700">
                            Say &ldquo;Roxanne&rdquo; to ask a question
                          </span>
                        </>
                      )}
                      {voice.voiceState === "active" && !isSending && (
                        <>
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                          </span>
                          <span className="text-xs font-medium text-emerald-700">
                            Listening…
                          </span>
                        </>
                      )}
                      {voice.isTranscribing && (
                        <>
                          <svg className="w-3.5 h-3.5 text-amber-600 animate-spin" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                            <path d="M8 2a6 6 0 014.9 9.46" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                          <span className="text-xs font-medium text-amber-700">Processing...</span>
                        </>
                      )}
                      {isSending && !voice.isTranscribing && (
                        <>
                          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                          <span className="text-xs font-medium text-blue-700">Thinking...</span>
                        </>
                      )}
                      {voice.isSpeaking && !isSending && (
                        <>
                          <IconSpeaker className="w-3.5 h-3.5 text-blue-600" />
                          <span className="text-xs font-medium text-blue-700">Speaking...</span>
                        </>
                      )}
                      {!voice.isRecording && !voice.isTranscribing && !isSending && !voice.isSpeaking && (
                        <span className="text-xs font-medium text-zinc-500">Voice mode active</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="text-xs text-zinc-400 hover:text-zinc-900 transition-colors"
                      onClick={voice.stopVoiceConversation}
                    >
                      End
                    </button>
                  </div>
                </div>
              ) : !chatReady ? (
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors"
                  onClick={() => {
                    const provider = savedConfig?.anthropic?.provider || configForm.anthropic.provider;
                    if (provider === "ollama") triggerSetup("ollama");
                    else setShowPanel("settings");
                  }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                  Setup incomplete — click to configure
                </button>
              ) : (
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    className={cn(
                      "shrink-0 w-9 h-9 grid place-items-center rounded-lg border transition-colors",
                      voice.isRecording
                        ? "bg-red-50 border-red-300 text-red-600"
                        : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-900"
                    )}
                    onClick={() => void voice.toggleRecording()}
                    title={voice.isRecording ? "Stop recording" : "Start voice input"}
                  >
                    <IconMic />
                  </button>
                  <div className="flex-1 min-w-0">
                    <Textarea
                      className="min-h-[40px] max-h-[120px] resize-none rounded-lg text-sm"
                      placeholder="Ask Roxanne..."
                      rows={1}
                      value={draft}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className={cn(
                      "shrink-0 w-9 h-9 grid place-items-center rounded-lg transition-colors",
                      draft.trim() && !isSending
                        ? "bg-zinc-900 text-white hover:bg-zinc-800"
                        : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                    )}
                    disabled={!draft.trim() || isSending}
                    onClick={() => void handleSend()}
                    title="Send message"
                  >
                    <IconSend />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
