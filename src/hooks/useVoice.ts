// Push-to-talk voice input. Records while the mic button is held (or with
// auto-stop when triggered from the tray / wake word), then transcribes via
// the configured STT provider.
import { useCallback, useRef, useState } from "react";
import * as api from "../lib/api";
import { useStore } from "../stores/store";
import { runAgent } from "../agent/loop";

type Recording = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  autoStop: boolean;
  analyser?: AnalyserNode;
  ctx?: AudioContext;
  raf?: number;
  silenceMs: number;
  spoke: boolean;
  timer: number;
};

function pickMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function transcribe(blob: Blob): Promise<string> {
  const { ai } = useStore.getState().settings;
  const b64 = await blobToBase64(blob);
  const mime = blob.type || "audio/webm";

  if (ai.stt_provider === "local") {
    const resp = await fetch("http://127.0.0.1:11437/transcribe", {
      method: "POST",
      headers: { "Content-Type": mime, "X-Audio-Base64": "1" },
      body: b64,
    });
    const json = await resp.json();
    if (!resp.ok || json.error) throw new Error(json.error ?? "local STT failed");
    return json.text ?? "";
  }

  const endpoints: Record<string, string> = {
    openai: "https://api.openai.com/v1/audio/transcriptions",
    groq: "https://api.groq.com/openai/v1/audio/transcriptions",
  };
  let endpoint = endpoints[ai.stt_provider];
  let key = await api.getSecret(ai.stt_provider).catch(() => null);
  let model = ai.stt_model || "whisper-1";

  if (ai.stt_provider === "custom") {
    endpoint = ai.stt_custom_endpoint;
    model = ai.stt_model || "whisper-1";
    if (!endpoint) throw new Error("Custom STT endpoint not configured (Settings → AI).");
  }
  if (!endpoint) throw new Error("Speech-to-text provider not configured.");
  if (!key && ai.stt_provider !== "custom") {
    // fall back to the main provider key
    key = await api.getSecret(ai.provider).catch(() => null);
  }
  if (!key) throw new Error(`No API key for speech-to-text (${ai.stt_provider}).`);

  const form = new FormData();
  const ext = mime.includes("mp4") ? "mp4" : "webm";
  form.append("file", new File([blob], `speech.${ext}`, { type: mime }));
  form.append("model", model);
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(
      `Speech-to-text failed (HTTP ${resp.status}): ${text.slice(0, 200)}`
    );
  }
  return JSON.parse(text).text ?? "";
}

export function useVoice() {
  const [listening, setListening] = useState(false);
  const recRef = useRef<Recording | null>(null);
  const store = useStore;

  const finish = useCallback(async (autoStop: boolean) => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    setListening(false);
    store.getState().setOrb("transcribing");
    try {
      await new Promise<void>((resolve) => {
        rec.recorder.onstop = () => resolve();
        rec.recorder.stop();
      });
      rec.stream.getTracks().forEach((t) => t.stop());
      if (rec.raf) cancelAnimationFrame(rec.raf);
      void rec.ctx?.close();
      const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || "audio/webm" });
      if (blob.size < 2000) {
        store.getState().setOrb("idle");
        store.getState().toast("info", "Heard nothing — hold the mic button while speaking.");
        return;
      }
      const text = await transcribe(blob);
      if (!text.trim()) {
        store.getState().setOrb("idle");
        store.getState().toast("info", "Speech-to-text returned nothing. Try again.");
        return;
      }
      // Hand the transcript to the agent (palette input also shows it briefly)
      window.dispatchEvent(new CustomEvent("cipher-voice-text", { detail: text }));
      if (autoStop) {
        await runAgent(text);
      }
    } catch (e) {
      store.getState().setOrb("error");
      store.getState().toast(
        "error",
        e instanceof Error ? e.message : "Voice input failed."
      );
      setTimeout(() => store.getState().setOrb("idle"), 2500);
    }
  }, [store]);

  const start = useCallback(
    async (autoStop = false) => {
      const { privacy } = store.getState().settings;
      if (privacy.disable_voice) {
        store.getState().toast("info", "Voice is disabled in Settings → Privacy.");
        return;
      }
      if (recRef.current) return;
      try {
        const micSetting = store.getState().settings.voice.microphone;
        const constraints: MediaStreamConstraints = {
          audio:
            micSetting && micSetting !== "default"
              ? { deviceId: { exact: micSetting } }
              : true,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const recorder = new MediaRecorder(stream, pickMime() ? { mimeType: pickMime() } : undefined);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        const rec: Recording = {
          recorder,
          stream,
          chunks,
          autoStop,
          silenceMs: 0,
          spoke: false,
          timer: 0,
        };
        recRef.current = rec;
        recorder.start(250);
        setListening(true);
        store.getState().setOrb("listening");

        if (autoStop) {
          // stop after ~1.6s of silence following speech, or 15s max
          const ctx = new AudioContext();
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
          rec.ctx = ctx;
          rec.analyser = analyser;
          const buf = new Uint8Array(analyser.fftSize);
          const tick = () => {
            const current = recRef.current;
            if (!current) return;
            current.analyser?.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) {
              const v = (buf[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / buf.length);
            if (rms > 0.04) {
              current.spoke = true;
              current.silenceMs = 0;
            } else if (current.spoke) {
              current.silenceMs += 100;
            }
            if ((current.spoke && current.silenceMs > 1600) || current.silenceMs > 15000) {
              void finish(true);
              return;
            }
            current.raf = requestAnimationFrame(() => setTimeout(tick, 100));
          };
          setTimeout(tick, 300);
          rec.timer = window.setTimeout(() => {
            if (recRef.current === rec) void finish(true);
          }, 15000);
          void rec.timer;
        }
      } catch (e) {
        store.getState().setOrb("idle");
        store.getState().toast(
          "error",
          e instanceof Error
            ? `Microphone unavailable: ${e.message}`
            : "Microphone unavailable."
        );
      }
    },
    [finish, store]
  );

  const stop = useCallback(() => {
    void finish(false);
  }, [finish]);

  return { listening, start, stop };
}
