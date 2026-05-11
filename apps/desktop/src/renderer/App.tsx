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
  getSpeechStatus,
  listConversations,
  runIndex,
  saveConfig,
  streamChat,
  synthesizeSpeech,
  uploadAudio,
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
  stripStreamingCitations,
  toSpeechPlainText,
} from "./components/ChatMessages";
import { WelcomeStep, AnthropicStep, ZoteroStep, VaultsStep, SpeechStep, ReadyStep } from "./components/Wizard";
import IndexBrowser from "./components/IndexBrowser";
import SettingsPanel from "./components/SettingsPanel";

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
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
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

  function triggerSetup(need: SetupNeed) {
    setSetupNeed(need);
    setIsSending(false);
    if (voiceModeRef.current) {
      stopVoiceConversation();
    }
  }

  const chatReady = Boolean(savedConfig?.is_complete);

  // Voice conversation mode
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceAnimFrameRef = useRef<number | null>(null);

  const [voiceState, setVoiceState] = useState<"listening" | "active">("listening");
  const voiceStateRef = useRef<"listening" | "active">("listening");

  const { toasts, addToast, dismissToast } = useToasts();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const sessionIdRef = useRef(makeId());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isSendingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const voiceInputPausedRef = useRef(false);
  const voiceAwaitingResponseRef = useRef(false);
  const voiceCommandBufferRef = useRef("");
  const ttsStreamStartedRef = useRef(false);
  const notificationAudioContextRef = useRef<AudioContext | null>(null);
  const ttsPlaybackContextRef = useRef<AudioContext | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ttsGainRef = useRef<GainNode | null>(null);
  const ttsPlaybackGenerationRef = useRef(0);

  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

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
      if (voiceAnimFrameRef.current) cancelAnimationFrame(voiceAnimFrameRef.current);
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (notificationAudioContextRef.current) {
        void notificationAudioContextRef.current.close();
        notificationAudioContextRef.current = null;
      }
      if (ttsPlaybackContextRef.current) {
        void ttsPlaybackContextRef.current.close();
        ttsPlaybackContextRef.current = null;
      }
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

  /* ---- Voice helpers ---- */

  function clearVoiceSendTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  async function playVoiceCue(kind: "sent" | "listening") {
    try {
      type WindowWithWebkitAudio = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
      if (!AudioContextCtor) return;

      if (!notificationAudioContextRef.current) {
        notificationAudioContextRef.current = new AudioContextCtor();
      }

      const audioCtx = notificationAudioContextRef.current;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      const startAt = audioCtx.currentTime + 0.01;
      const cueNotes = kind === "sent"
        ? [
            { frequency: 880, duration: 0.05, delay: 0 },
            { frequency: 1244, duration: 0.08, delay: 0.05 },
          ]
        : [
            { frequency: 659, duration: 0.05, delay: 0 },
            { frequency: 988, duration: 0.09, delay: 0.055 },
          ];

      for (const note of cueNotes) {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = note.frequency;
        gainNode.gain.setValueAtTime(0.0001, startAt + note.delay);
        gainNode.gain.exponentialRampToValueAtTime(0.06, startAt + note.delay + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + note.delay + note.duration);
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start(startAt + note.delay);
        oscillator.stop(startAt + note.delay + note.duration);
      }
    } catch {
      // Notification sounds are best-effort only.
    }
  }

  function resetVoiceRecognizer() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send("RESET");
    }
  }

  function resumeVoiceListening(playCue = false, mode: "wake" | "direct" = "wake") {
    if (!voiceModeRef.current) return;
    clearVoiceSendTimer();
    voiceInputPausedRef.current = false;
    voiceCommandBufferRef.current = "";
    setLiveTranscript("");
    voiceStateRef.current = mode === "direct" ? "active" : "listening";
    setVoiceState(mode === "direct" ? "active" : "listening");
    resetVoiceRecognizer();
    if (playCue) {
      void playVoiceCue("listening");
    }
  }

  function pauseVoiceListening() {
    clearVoiceSendTimer();
    voiceInputPausedRef.current = true;
    voiceCommandBufferRef.current = "";
    setLiveTranscript("");
    voiceStateRef.current = "listening";
    setVoiceState("listening");
    resetVoiceRecognizer();
  }

  function finishVoiceTurnIfReady() {
    if (!voiceModeRef.current || !voiceAwaitingResponseRef.current) return;
    if (isSendingRef.current || ttsPlayingRef.current || ttsQueueRef.current.length > 0) return;
    voiceAwaitingResponseRef.current = false;
    resumeVoiceListening(true, "direct");
  }

  /* ---- Chat ---- */

  async function handleSend(overrideText?: string, origin: "text" | "stt" = "text") {
    const prompt = (overrideText ?? draft).trim();
    if (!prompt || !baseUrl) return;
    if (!voiceModeRef.current && isSending) return;
    const assistantMessageId = makeId();

    ttsCancelledRef.current = false;
    ttsQueueRef.current = [];
    ttsChunkBufferRef.current = "";
    ttsCitationCarryRef.current = "";
    ttsStreamStartedRef.current = false;
    if (!overrideText) setDraft("");
    setIsSending(true);

    if (origin === "stt") {
      voiceAwaitingResponseRef.current = true;
      pauseVoiceListening();
      void playVoiceCue("sent");
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
          voice_mode: voiceModeRef.current,
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
      finishVoiceTurnIfReady();
    }
  }

  async function handleStreamEvent(event: StreamEvent, assistantMessageId: string) {
    if (event.type === "assistant_delta") {
      setMessages((c) => c.map((m) => (m.id === assistantMessageId ? { ...m, content: `${m.content}${event.delta || ""}` } : m)));
      if (voiceModeRef.current && event.delta) {
        ttsStreamStartedRef.current = true;
        feedTTSDelta(event.delta);
      }
      return;
    }
    if (event.type === "assistant_done") {
      const payload = (event.payload || {}) as { message?: string };
      if (payload.message) {
        setMessages((c) => c.map((m) => (m.id === assistantMessageId ? { ...m, content: payload.message || "" } : m)));
        if (voiceModeRef.current) {
          if (!ttsStreamStartedRef.current) {
            feedTTSDelta(payload.message);
          }
          flushTTSBuffer();
        }
      }
      finishVoiceTurnIfReady();
      return;
    }
    if (event.type === "status") {
      appendStatusMessage(setMessages, event.message || "Running tool...");
      if (voiceModeRef.current && event.tool && !ttsPlayingRef.current && ttsQueueRef.current.length === 0) {
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
        enqueueTTS(phrase);
      }
      return;
    }
    if (event.type === "tool_result") {
      applyToolPayload(event, assistantMessageId);
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

  function applyToolPayload(event: StreamEvent, _assistantMessageId: string) {
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

  /* ---- Speech (streaming chunk queue) ---- */

  const piperCheckedRef = useRef(false);
  const ttsQueueRef = useRef<string[]>([]);
  const ttsPlayingRef = useRef(false);
  const ttsCancelledRef = useRef(false);
  const ttsChunkBufferRef = useRef("");
  const ttsCitationCarryRef = useRef("");

  function enqueueTTS(chunk: string) {
    const cleaned = toSpeechPlainText(chunk);
    if (!cleaned || ttsCancelledRef.current) return;
    ttsQueueRef.current.push(cleaned);
    if (!ttsPlayingRef.current) {
      void drainTTSQueue();
    }
  }

  function countWords(text: string) {
    return text.match(/\S+/g)?.length ?? 0;
  }

  function takeWordChunk(text: string, words: number) {
    const tokens = Array.from(text.matchAll(/\S+\s*/g));
    if (tokens.length < words) return null;
    const consumed = tokens.slice(0, words).reduce((total, token) => total + token[0].length, 0);
    return {
      chunk: text.slice(0, consumed).trim(),
      rest: text.slice(consumed).trimStart(),
    };
  }

  function pumpTTSBuffer(force = false) {
    let buffer = ttsChunkBufferRef.current.trimStart();

    while (buffer) {
      const punctMatch = buffer.match(/^([\s\S]{32,}?[,:;.!?])(?=\s|$)/);
      if (punctMatch) {
        enqueueTTS(punctMatch[1]);
        buffer = buffer.slice(punctMatch[1].length).trimStart();
        continue;
      }

      const wordCount = countWords(buffer);
      if (!force && wordCount < 12 && buffer.length < 72) break;

      if (force && wordCount <= 14) {
        enqueueTTS(buffer);
        buffer = "";
        break;
      }

      const targetWords = wordCount >= 22 ? 15 : wordCount >= 16 ? 12 : force ? Math.max(wordCount, 1) : 0;
      if (!targetWords) break;

      const next = takeWordChunk(buffer, Math.min(targetWords, wordCount));
      if (!next) {
        if (force) {
          enqueueTTS(buffer);
          buffer = "";
        }
        break;
      }

      enqueueTTS(next.chunk);
      buffer = next.rest;

      if (!force && countWords(buffer) < 5 && buffer.length < 30) {
        break;
      }
    }

    ttsChunkBufferRef.current = buffer;
  }

  async function ensureSpeechReady() {
    if (!baseUrl) return false;
    if (!piperCheckedRef.current) {
      piperCheckedRef.current = true;
      try {
        const speechSt = await getSpeechStatus(baseUrl);
        if (!speechSt.piper_installed || !speechSt.voice_installed) {
          piperCheckedRef.current = false;
          triggerSetup("piper");
          return false;
        }
      } catch {
        piperCheckedRef.current = false;
        return false;
      }
    }
    return true;
  }

  async function getTTSPlaybackContext() {
    if (!ttsPlaybackContextRef.current) {
      ttsPlaybackContextRef.current = new AudioContext();
    }
    if (ttsPlaybackContextRef.current.state === "suspended") {
      await ttsPlaybackContextRef.current.resume();
    }
    return ttsPlaybackContextRef.current;
  }

  async function synthesizeSpeechBuffer(chunk: string) {
    if (!baseUrl) throw new Error("Backend not ready.");
    const audioUrl = await synthesizeSpeech(baseUrl, chunk);
    if (ttsCancelledRef.current) throw new Error("TTS cancelled");

    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Audio fetch failed (${response.status})`);
    }

    const audioData = await response.arrayBuffer();
    if (ttsCancelledRef.current) throw new Error("TTS cancelled");

    const audioCtx = await getTTSPlaybackContext();
    return await audioCtx.decodeAudioData(audioData.slice(0));
  }

  async function playAudioBuffer(buffer: AudioBuffer) {
    const audioCtx = await getTTSPlaybackContext();
    const generation = ttsPlaybackGenerationRef.current;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const source = audioCtx.createBufferSource();
      const gainNode = audioCtx.createGain();
      const startAt = audioCtx.currentTime + 0.005;
      const fadeInEnd = startAt + Math.min(0.012, Math.max(buffer.duration / 6, 0.006));
      const fadeOutStart = Math.max(fadeInEnd, startAt + buffer.duration - 0.02);
      const stopAt = Math.max(fadeOutStart + 0.015, startAt + buffer.duration);

      source.buffer = buffer;
      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(1, fadeInEnd);
      gainNode.gain.setValueAtTime(1, fadeOutStart);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, stopAt);

      const cleanup = () => {
        if (ttsSourceRef.current === source) ttsSourceRef.current = null;
        if (ttsGainRef.current === gainNode) ttsGainRef.current = null;
        source.disconnect();
        gainNode.disconnect();
      };

      source.onended = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      try {
        ttsSourceRef.current = source;
        ttsGainRef.current = gainNode;
        source.start(startAt);
      } catch (error) {
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (generation !== ttsPlaybackGenerationRef.current) {
        settled = true;
        cleanup();
        resolve();
      }
    });
  }

  async function drainTTSQueue() {
    if (!baseUrl || ttsPlayingRef.current) return;
    const speechReady = await ensureSpeechReady();
    if (!speechReady) {
      finishVoiceTurnIfReady();
      return;
    }

    ttsPlayingRef.current = true;
    setIsSpeaking(true);

    try {
      while (ttsQueueRef.current.length > 0 && !ttsCancelledRef.current) {
        let currentChunk = ttsQueueRef.current.shift();
        if (!currentChunk) break;

        let currentBufferPromise: Promise<AudioBuffer> | null = synthesizeSpeechBuffer(currentChunk);

        while (currentBufferPromise && !ttsCancelledRef.current) {
          const currentBuffer = await currentBufferPromise;
          if (ttsCancelledRef.current) break;

          const nextChunk = ttsQueueRef.current.shift() || null;
          const nextBufferPromise = nextChunk ? synthesizeSpeechBuffer(nextChunk) : null;

          await playAudioBuffer(currentBuffer);
          currentBufferPromise = nextBufferPromise;
        }
      }
    } catch (error) {
      if (!ttsCancelledRef.current) {
        addToast("error", "TTS error", error instanceof Error ? error.message : String(error));
      }
    }

    ttsPlayingRef.current = false;
    ttsQueueRef.current = [];
    setIsSpeaking(false);
    finishVoiceTurnIfReady();
  }

  function feedTTSDelta(delta: string) {
    const streamed = stripStreamingCitations(`${ttsCitationCarryRef.current}${delta}`);
    ttsCitationCarryRef.current = streamed.carry;
    ttsChunkBufferRef.current += streamed.clean;
    pumpTTSBuffer(false);
  }

  function flushTTSBuffer() {
    if (ttsCitationCarryRef.current) {
      const streamed = stripStreamingCitations(ttsCitationCarryRef.current, true);
      ttsChunkBufferRef.current += streamed.clean;
      ttsCitationCarryRef.current = "";
    }
    pumpTTSBuffer(true);
  }

  async function speakText(text: string) {
    if (!text.trim()) return;
    if (!(await ensureSpeechReady())) return;
    ttsCancelledRef.current = false;
    const streamed = stripStreamingCitations(text.trim(), true);
    ttsCitationCarryRef.current = "";
    ttsChunkBufferRef.current = streamed.clean.trim();
    flushTTSBuffer();
  }

  function stopSpeaking() {
    ttsCancelledRef.current = true;
    ttsPlaybackGenerationRef.current += 1;
    ttsQueueRef.current = [];
    ttsChunkBufferRef.current = "";
    ttsCitationCarryRef.current = "";
    if (ttsSourceRef.current) {
      try {
        ttsSourceRef.current.stop();
      } catch {}
      ttsSourceRef.current = null;
    }
    if (ttsGainRef.current) {
      try {
        ttsGainRef.current.disconnect();
      } catch {}
      ttsGainRef.current = null;
    }
    ttsPlayingRef.current = false;
    setIsSpeaking(false);
    finishVoiceTurnIfReady();
  }

  async function toggleRecording() {
    if (!baseUrl) return;
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      recordingChunksRef.current = [];
      setIsRecording(true);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        setIsRecording(false);
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        if (!blob.size) return;

        setIsTranscribing(true);
        try {
          const text = await uploadAudio(baseUrl, blob);
          setDraft((c) => [c.trim(), text.trim()].filter(Boolean).join(" ").trim());
        } catch (error) {
          addToast("error", "Transcription error", error instanceof Error ? error.message : String(error));
        } finally {
          setIsTranscribing(false);
        }
      };
      recorder.start();
    } catch (error) {
      setIsRecording(false);
      addToast("error", "Mic error", error instanceof Error ? error.message : String(error));
    }
  }

  /* ---- Voice conversation mode (WebSocket streaming transcription) ---- */

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);

  async function startVoiceConversation() {
    if (!baseUrl) return;

    try {
      const speechSt = await getSpeechStatus(baseUrl);
      if (!speechSt.vosk_ready) {
        triggerSetup("vosk");
        return;
      }
    } catch {}

    voiceModeRef.current = true;
    voiceAwaitingResponseRef.current = false;
    voiceInputPausedRef.current = false;
    voiceCommandBufferRef.current = "";
    setVoiceMode(true);
    voiceStateRef.current = "listening";
    setVoiceState("listening");
    setLiveTranscript("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      voiceAnalyserRef.current = analyser;

      const scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
      scriptNodeRef.current = scriptNode;
      source.connect(scriptNode);
      scriptNode.connect(audioCtx.destination);

      const wsUrl = baseUrl.replace(/^http/, "ws") + "/api/audio/stream";
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ sample_rate: audioCtx.sampleRate }));
        setIsRecording(true);
        resumeVoiceListening(false);
      };

      const WAKE_WORDS = ["roxanne", "hey roxanne", "ok roxanne", "okay roxanne"];

      function extractAfterWakeWord(text: string): string | null {
        const lower = text.toLowerCase().trim();
        for (const ww of WAKE_WORDS) {
          const idx = lower.indexOf(ww);
          if (idx !== -1) {
            return text.slice(idx + ww.length).trim();
          }
        }
        return null;
      }

      function queueVoiceSend(timeoutMs: number) {
        clearVoiceSendTimer();
        silenceTimerRef.current = setTimeout(() => {
          const trimmed = voiceCommandBufferRef.current.trim();
          if (!trimmed || !voiceModeRef.current) {
            resumeVoiceListening(false);
            return;
          }

          setLiveTranscript("");
          setIsTranscribing(false);
          void handleSend(trimmed, "stt");
        }, timeoutMs);
      }

      function activateVoiceListening(previewText = "") {
        clearVoiceSendTimer();
        voiceStateRef.current = "active";
        setVoiceState("active");
        setLiveTranscript(previewText || "Listening…");
      }

      function queueWakeWordGracePeriod() {
        clearVoiceSendTimer();
        silenceTimerRef.current = setTimeout(() => {
          if (!voiceCommandBufferRef.current.trim()) {
            resumeVoiceListening(false);
          }
        }, 5000);
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (voiceInputPausedRef.current && data.type !== "error") {
            return;
          }
          const currentState = voiceStateRef.current;

          if (data.type === "interim") {
            const partial = (data.text || "").trim();
            if (currentState === "listening") {
              const afterWake = extractAfterWakeWord(partial);
              if (afterWake !== null) {
                activateVoiceListening(afterWake);
              } else {
                setLiveTranscript("");
              }
            } else {
              const partialText = extractAfterWakeWord(partial) ?? partial;
              const transcript = [voiceCommandBufferRef.current, partialText].filter(Boolean).join(" ").trim();
              setLiveTranscript(transcript || "Listening…");
            }
          } else if (data.type === "final") {
            const text = (data.text || "").trim();
            if (!text) return;

            if (text.toLowerCase().replace(/[^a-z]/g, "") === "halt" || text.toLowerCase().replace(/[^a-z]/g, "") === "stop") {
              clearVoiceSendTimer();
              setLiveTranscript("");
              voiceCommandBufferRef.current = "";
              stopVoiceConversation();
              return;
            }

            if (currentState === "listening") {
              const afterWake = extractAfterWakeWord(text);
              if (afterWake !== null) {
                activateVoiceListening(afterWake);
                voiceCommandBufferRef.current = afterWake;

                if (afterWake) {
                  queueVoiceSend(3000);
                } else {
                  queueWakeWordGracePeriod();
                }
              }
            } else {
              const segment = extractAfterWakeWord(text) ?? text;
              if (segment) {
                voiceCommandBufferRef.current = [voiceCommandBufferRef.current, segment].filter(Boolean).join(" ").trim();
                setLiveTranscript(voiceCommandBufferRef.current);
                queueVoiceSend(3000);
              } else if (!voiceCommandBufferRef.current.trim()) {
                setLiveTranscript("Listening…");
                queueWakeWordGracePeriod();
              }
            }
          } else if (data.type === "error") {
            addToast("error", "Transcription error", data.text || "Unknown error");
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        addToast("error", "WebSocket error", "Lost connection to transcription service");
        stopVoiceConversation();
      };

      ws.onclose = () => {
        if (voiceModeRef.current) {
          addToast("error", "Connection lost", "Transcription WebSocket closed");
          stopVoiceConversation();
        }
      };

      scriptNode.onaudioprocess = (e) => {
        if (!voiceModeRef.current || voiceInputPausedRef.current || isSendingRef.current || isSpeakingRef.current || ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        ws.send(inputData.buffer.slice(inputData.byteOffset, inputData.byteOffset + inputData.byteLength));
      };
    } catch (error) {
      voiceModeRef.current = false;
      voiceAwaitingResponseRef.current = false;
      voiceInputPausedRef.current = false;
      setVoiceMode(false);
      addToast("error", "Mic error", error instanceof Error ? error.message : String(error));
    }
  }

  function stopVoiceConversation() {
    voiceModeRef.current = false;
    voiceAwaitingResponseRef.current = false;
    voiceInputPausedRef.current = false;
    voiceCommandBufferRef.current = "";
    setVoiceMode(false);
    setIsRecording(false);
    setLiveTranscript("");
    voiceStateRef.current = "listening";
    setVoiceState("listening");
    clearVoiceSendTimer();
    stopSpeaking();

    if (voiceAnimFrameRef.current) {
      cancelAnimationFrame(voiceAnimFrameRef.current);
      voiceAnimFrameRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    if (scriptNodeRef.current) {
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }

    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    voiceAnalyserRef.current = null;
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
                {isRecording && <RecordingPill />}
                {isTranscribing && <TranscribingPill />}
                {isSpeaking && (
                  <button type="button" onClick={stopSpeaking} className="cursor-pointer">
                    <SpeakingPill />
                  </button>
                )}
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border",
                    voiceMode && voiceState === "active"
                      ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                      : voiceMode
                        ? "bg-amber-50 border-amber-300 text-amber-700"
                        : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-900"
                  )}
                  onClick={() => voiceMode ? stopVoiceConversation() : void startVoiceConversation()}
                >
                  <IconMic className="w-3.5 h-3.5" />
                  {voiceMode
                    ? voiceState === "active"
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
              {voiceMode ? (
                <div className="flex flex-col gap-2 py-2">
                  {voiceState === "active" && liveTranscript && liveTranscript !== "…" && liveTranscript !== "Listening…" && (
                    <div className="px-3 py-2 mx-auto max-w-[600px] bg-zinc-50 border border-zinc-200 rounded-lg animate-[fade-in_150ms_ease-out_both]">
                      <p className="text-sm text-zinc-700 italic leading-relaxed">&ldquo;{liveTranscript}&rdquo;</p>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-3">
                    <div className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-full border transition-all",
                      voiceState === "active" ? "bg-emerald-50 border-emerald-200" : isSending ? "bg-blue-50 border-blue-200" : isSpeaking ? "bg-blue-50 border-blue-200" : "bg-amber-50 border-amber-200"
                    )}>
                      {voiceState === "listening" && !isSending && !isSpeaking && (
                        <>
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
                          </span>
                          <span className="text-xs font-medium text-amber-700">
                            Say &ldquo;Roxanne&rdquo; to ask a question
                          </span>
                        </>
                      )}
                      {voiceState === "active" && !isSending && (
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
                      {isTranscribing && (
                        <>
                          <svg className="w-3.5 h-3.5 text-amber-600 animate-spin" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                            <path d="M8 2a6 6 0 014.9 9.46" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                          <span className="text-xs font-medium text-amber-700">Processing...</span>
                        </>
                      )}
                      {isSending && !isTranscribing && (
                        <>
                          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                          <span className="text-xs font-medium text-blue-700">Thinking...</span>
                        </>
                      )}
                      {isSpeaking && !isSending && (
                        <>
                          <IconSpeaker className="w-3.5 h-3.5 text-blue-600" />
                          <span className="text-xs font-medium text-blue-700">Speaking...</span>
                        </>
                      )}
                      {!isRecording && !isTranscribing && !isSending && !isSpeaking && (
                        <span className="text-xs font-medium text-zinc-500">Voice mode active</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="text-xs text-zinc-400 hover:text-zinc-900 transition-colors"
                      onClick={stopVoiceConversation}
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
                      isRecording
                        ? "bg-red-50 border-red-300 text-red-600"
                        : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-900"
                    )}
                    onClick={() => void toggleRecording()}
                    title={isRecording ? "Stop recording" : "Start voice input"}
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
