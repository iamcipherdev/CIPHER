#!/usr/bin/env python3
"""
CIPHER local voice sidecar (experimental, fully offline).

Provides:
    GET  /health            -> {"ok": true, "features": {"stt": bool, "wake": bool}}
    POST /transcribe        -> body: base64 audio (header X-Audio-Base64: 1)
                               or raw audio bytes (Content-Type: audio/webm|wav|mp4)
                               returns {"text": "..."}

    POST /wake/start        -> start local wake-word detection loop ("cipher")
    POST /wake/stop         -> stop the loop
    GET  /wake/status       -> {"listening": bool, "detected": bool, "last_text": str}

All audio stays on this machine. Nothing is uploaded anywhere.

Usage:
    pip install -r agent/requirements.txt
    python agent/voice_server.py [--port 11437] [--model small]
"""
import argparse
import base64
import io
import json
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "small"
STATE = {
    "stt_available": False,
    "wake_available": False,
    "listening": False,
    "detected": False,
    "last_text": "",
}
WAKE_QUEUE: "queue.Queue[bytes]" = queue.Queue(maxsize=4)
WAKE_THREAD = None
STOP_EVENT = threading.Event()


def load_stt():
    """Load faster-whisper lazily; report availability in /health."""
    global MODEL_HANDLE
    try:
        from faster_whisper import WhisperModel

        MODEL_HANDLE = WhisperModel(MODEL, device="auto", compute_type="auto")
        STATE["stt_available"] = True
    except Exception as e:  # noqa: BLE001
        print(f"[voice] STT unavailable: {e}")


MODEL_HANDLE = None


def transcribe_bytes(audio: bytes, mime: str) -> str:
    ext = "webm"
    if "wav" in mime:
        ext = "wav"
    elif "mp4" in mime or "aac" in mime:
        ext = "mp4"
    tmp = f"/tmp/cipher_stt_{int(time.time()*1000)}.{ext}"
    with open(tmp, "wb") as f:
        f.write(audio)
    segments, _ = MODEL_HANDLE.transcribe(
        tmp, vad_filter=True, beam_size=1, language=None
    )
    return " ".join(s.text.strip() for s in segments).strip()


def wake_loop():
    """Record 2s chunks with sounddevice and check for the wake word locally."""
    try:
        import numpy as np
        import sounddevice as sd
    except Exception as e:  # noqa: BLE001
        print(f"[voice] wake word unavailable: {e}")
        return

    samplerate = 16000
    chunk_seconds = 2.0

    def audio_cb(indata, frames, time_info, status):
        try:
            WAVE_QUEUE.put(bytes(indata), block=False)
        except queue.Full:
            pass

    buffer = bytearray()
    with sd.InputStream(samplerate=samplerate, channels=1, dtype="int16", blocksize=int(samplerate * chunk_seconds), callback=audio_cb):
        while not STOP_EVENT.is_set():
            try:
                buffer.extend(WAVE_QUEUE.get(timeout=0.5))
            except queue.Empty:
                continue
            if len(buffer) < samplerate * 2 * 2:
                continue
            audio = np.frombuffer(bytes(buffer[: samplerate * 2 * 2]), dtype=np.int16).astype("float32") / 32768.0
            buffer.clear()
            if MODEL_HANDLE is None:
                continue
            try:
                # faster-whisper accepts float32 numpy audio at 16 kHz directly
                segments, _ = MODEL_HANDLE.transcribe(
                    audio,
                    language="en",
                    vad_filter=True,
                    beam_size=1,
                )
            except Exception:  # noqa: BLE001
                continue
            text = " ".join(s.text for s in segments).strip().lower()
            if text:
                STATE["last_text"] = text
                for kw in ("cipher", "cypher", "seifer", "sifer"):
                    if kw in text:
                        STATE["detected"] = True
                        break


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            self._json({
                "ok": True,
                "features": {
                    "stt": STATE["stt_available"],
                    "wake": STATE["stt_available"],
                },
            })
        elif self.path == "/wake/status":
            self._json({
                "listening": STATE["listening"],
                "detected": STATE["detected"],
                "last_text": STATE["last_text"],
            })
            # auto-reset the flag once read
            STATE["detected"] = False
        else:
            self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""
        if self.path == "/transcribe":
            if MODEL_HANDLE is None:
                self._json({"ok": False, "error": "STT model not loaded"}, 503)
                return
            try:
                mime = self.headers.get("Content-Type", "audio/webm")
                if self.headers.get("X-Audio-Base64") == "1":
                    audio = base64.b64decode(body)
                else:
                    audio = body
                text = transcribe_bytes(audio, mime)
                self._json({"ok": True, "text": text})
            except Exception as e:  # noqa: BLE001
                self._json({"ok": False, "error": str(e)})
        elif self.path == "/wake/start":
            global WAKE_THREAD
            if MODEL_HANDLE is None:
                self._json({"ok": False, "error": "STT model not loaded"}, 503)
                return
            if not STATE["listening"]:
                STATE["listening"] = True
                STOP_EVENT.clear()
                WAKE_THREAD = threading.Thread(target=wake_loop, daemon=True)
                WAKE_THREAD.start()
            self._json({"ok": True})
        elif self.path == "/wake/stop":
            STATE["listening"] = False
            STOP_EVENT.set()
            self._json({"ok": True})
        else:
            self._json({"ok": False, "error": "not found"}, 404)

    def _json(self, obj, status=200):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    ap = argparse.ArgumentParser(description="CIPHER voice sidecar (offline STT)")
    ap.add_argument("--port", type=int, default=11437)
    ap.add_argument("--model", default="small", help="faster-whisper model size")
    args = ap.parse_args()
    global MODEL
    MODEL = args.model

    load_stt()
    try:
        import sounddevice  # noqa: F401

        STATE["wake_available"] = True
    except Exception:  # noqa: BLE001
        STATE["wake_available"] = False

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"CIPHER voice sidecar listening on 127.0.0.1:{args.port} (model={MODEL})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
