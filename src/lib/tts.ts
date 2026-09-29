// Text-to-speech: Windows SAPI via the Rust backend, gated by the user's
// TTS mode. Never reads long logs aloud.
import * as api from "./api";
import { useStore } from "../stores/store";

export async function speakIfEnabled(
  text: string,
  kind: "final" | "step"
): Promise<void> {
  const { ai, privacy } = useStore.getState().settings;
  if (privacy.disable_voice) return;
  const mode = ai.tts_mode;
  if (mode === "off") return;
  if (mode === "important" && kind !== "final") return;

  // never read long terminal logs aloud
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length > 700) return;

  const store = useStore.getState();
  store.setOrb("speaking");
  try {
    await api.speak(clean);
  } catch {
    // TTS is best-effort; silence failures
  } finally {
    if (!useStore.getState().busy) {
      store.setOrb("idle");
    }
  }
}
