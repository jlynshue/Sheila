import { useCallback, useEffect, useRef, useState } from "react";
import { getSpeechStatus, synthesizeSpeech, uploadAudio } from "../api";
import { stripStreamingCitations, toSpeechPlainText } from "../components/ChatMessages";
import { makeId } from "../lib/config";
import type { SetupNeed } from "../components/SetupModal";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface UseVoiceModeOptions {
  baseUrl: string;
  isSending: boolean;
  onSend: (text: string, origin: "stt") => void;
  onTranscription: (text: string) => void;
  onSetupNeeded: (need: SetupNeed) => void;
  addToast: (type: "error" | "success" | "info", title: string, message: string) => void;
}

export interface UseVoiceModeReturn {
  // State exposed to UI
  voiceMode: boolean;
  voiceState: "listening" | "active";
  liveTranscript: string;
  isRecording: boolean;
  isTranscribing: boolean;
  isSpeaking: boolean;

  // Actions for UI
  startVoiceConversation: () => Promise<void>;
  stopVoiceConversation: () => void;
  toggleRecording: () => Promise<void>;
  stopSpeaking: () => void;

  // Methods called by chat handler
  isVoiceActive: () => boolean;
  resetTTSState: () => void;
  onSendFromSTT: () => void;
  feedTTSDelta: (delta: string) => void;
  flushTTSBuffer: () => void;
  enqueueTTS: (chunk: string) => void;
  finishVoiceTurnIfReady: () => void;
  isTTSPlaying: () => boolean;
  isTTSQueueEmpty: () => boolean;

  // Cleanup for bootstrap effect
  cleanup: () => void;
}

/* ------------------------------------------------------------------ */
/*  Hook Implementation                                                */
/* ------------------------------------------------------------------ */

export function useVoiceMode(options: UseVoiceModeOptions): UseVoiceModeReturn {
  const { baseUrl, isSending, onSend, onTranscription, onSetupNeeded, addToast } = options;

  // Voice conversation mode state
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceAnimFrameRef = useRef<number | null>(null);

  const [voiceState, setVoiceState] = useState<"listening" | "active">("listening");
  const voiceStateRef = useRef<"listening" | "active">("listening");

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Media refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);

  // Voice conversation refs
  const isSendingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const voiceInputPausedRef = useRef(false);
  const voiceAwaitingResponseRef = useRef(false);
  const voiceCommandBufferRef = useRef("");
  const ttsStreamStartedRef = useRef(false);

  // Audio contexts
  const notificationAudioContextRef = useRef<AudioContext | null>(null);
  const ttsPlaybackContextRef = useRef<AudioContext | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ttsGainRef = useRef<GainNode | null>(null);
  const ttsPlaybackGenerationRef = useRef(0);

  // WebSocket for voice conversation
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);

  // TTS queue state
  const piperCheckedRef = useRef(false);
  const ttsQueueRef = useRef<string[]>([]);
  const ttsPlayingRef = useRef(false);
  const ttsCancelledRef = useRef(false);
  const ttsChunkBufferRef = useRef("");
  const ttsCitationCarryRef = useRef("");

  // Sync isSending prop to ref
  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  // Sync isSpeaking state to ref
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  /* ---- Voice helpers ---- */

  function clearVoiceSendTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  const playVoiceCue = useCallback(async (kind: "sent" | "listening") => {
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
  }, []);

  function resetVoiceRecognizer() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send("RESET");
    }
  }

  const resumeVoiceListening = useCallback((playCue = false, mode: "wake" | "direct" = "wake") => {
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
  }, [playVoiceCue]);

  function pauseVoiceListening() {
    clearVoiceSendTimer();
    voiceInputPausedRef.current = true;
    voiceCommandBufferRef.current = "";
    setLiveTranscript("");
    voiceStateRef.current = "listening";
    setVoiceState("listening");
    resetVoiceRecognizer();
  }

  const finishVoiceTurnIfReady = useCallback(() => {
    if (!voiceModeRef.current || !voiceAwaitingResponseRef.current) return;
    if (isSendingRef.current || ttsPlayingRef.current || ttsQueueRef.current.length > 0) return;
    voiceAwaitingResponseRef.current = false;
    resumeVoiceListening(true, "direct");
  }, [resumeVoiceListening]);

  /* ---- Speech (streaming chunk queue) ---- */

  const enqueueTTS = useCallback((chunk: string) => {
    const cleaned = toSpeechPlainText(chunk);
    if (!cleaned || ttsCancelledRef.current) return;
    ttsQueueRef.current.push(cleaned);
    if (!ttsPlayingRef.current) {
      void drainTTSQueue();
    }
  }, []);

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
          onSetupNeeded("piper");
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

  const feedTTSDelta = useCallback((delta: string) => {
    const streamed = stripStreamingCitations(`${ttsCitationCarryRef.current}${delta}`);
    ttsCitationCarryRef.current = streamed.carry;
    ttsChunkBufferRef.current += streamed.clean;
    pumpTTSBuffer(false);
  }, [enqueueTTS]);

  const flushTTSBuffer = useCallback(() => {
    if (ttsCitationCarryRef.current) {
      const streamed = stripStreamingCitations(ttsCitationCarryRef.current, true);
      ttsChunkBufferRef.current += streamed.clean;
      ttsCitationCarryRef.current = "";
    }
    pumpTTSBuffer(true);
  }, [enqueueTTS]);

  const speakText = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (!(await ensureSpeechReady())) return;
    ttsCancelledRef.current = false;
    const streamed = stripStreamingCitations(text.trim(), true);
    ttsCitationCarryRef.current = "";
    ttsChunkBufferRef.current = streamed.clean.trim();
    flushTTSBuffer();
  }, [flushTTSBuffer]);

  const stopSpeaking = useCallback(() => {
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
  }, [finishVoiceTurnIfReady]);

  /* ---- Recording (push-to-transcribe) ---- */

  const toggleRecording = useCallback(async () => {
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
          onTranscription(text);
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
  }, [baseUrl, isRecording, addToast]);

  /* ---- Voice conversation mode (WebSocket streaming transcription) ---- */

  const startVoiceConversation = useCallback(async () => {
    if (!baseUrl) return;

    try {
      const speechSt = await getSpeechStatus(baseUrl);
      if (!speechSt.vosk_ready) {
        onSetupNeeded("vosk");
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
          onSend(trimmed, "stt");
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
  }, [baseUrl, onSetupNeeded, onSend, resumeVoiceListening, addToast]);

  const stopVoiceConversation = useCallback(() => {
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
  }, [stopSpeaking]);

  /* ---- Cleanup ---- */

  const cleanup = useCallback(() => {
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
  }, []);

  /* ---- Public API Methods ---- */

  const isVoiceActive = useCallback(() => voiceModeRef.current, []);

  const resetTTSState = useCallback(() => {
    ttsCancelledRef.current = false;
    ttsQueueRef.current = [];
    ttsChunkBufferRef.current = "";
    ttsCitationCarryRef.current = "";
    ttsStreamStartedRef.current = false;
  }, []);

  const onSendFromSTT = useCallback(() => {
    voiceAwaitingResponseRef.current = true;
    pauseVoiceListening();
    void playVoiceCue("sent");
  }, [playVoiceCue]);

  const isTTSPlaying = useCallback(() => ttsPlayingRef.current, []);

  const isTTSQueueEmpty = useCallback(() => ttsQueueRef.current.length === 0, []);

  return {
    // State
    voiceMode,
    voiceState,
    liveTranscript,
    isRecording,
    isTranscribing,
    isSpeaking,

    // Actions
    startVoiceConversation,
    stopVoiceConversation,
    toggleRecording,
    stopSpeaking,

    // Methods for chat handler
    isVoiceActive,
    resetTTSState,
    onSendFromSTT,
    feedTTSDelta,
    flushTTSBuffer,
    enqueueTTS,
    finishVoiceTurnIfReady,
    isTTSPlaying,
    isTTSQueueEmpty,

    // Cleanup
    cleanup,
  };
}
