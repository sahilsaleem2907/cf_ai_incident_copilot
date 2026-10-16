import { useCallback, useEffect, useRef, useState } from "react";

/** FR-60: at most 30 seconds. 24 kbps Opus keeps that under the server's 160 KB cap (TDD §8.7). */
export const MAX_RECORD_MS = 30_000;
const BITS_PER_SECOND = 24_000;
/** Opus in WebM (Chrome, Firefox), then Ogg, then MP4 (Safari). */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  return MIME_TYPES.find((t) => isSupported(t)) ?? null;
}

export function recorderSupported(): boolean {
  return typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** Why the microphone couldn't start, in words. */
export function micErrorText(e: unknown): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked. Allow it in the browser's site settings, then try again.";
  if (name === "NotFoundError") return "No microphone found.";
  return "Couldn't start the microphone.";
}

/**
 * Push-to-talk recording (WP-23, user decision: click to start, click to stop, auto-stop at 30 s). `start` takes
 * the callback that gets the finished recording, whichever way it stopped.
 */
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timers = useRef<{ stop?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval> }>({});

  const clearTimers = () => {
    clearTimeout(timers.current.stop);
    clearInterval(timers.current.tick);
    timers.current = {};
  };

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async (onDone: (audio: Blob) => void) => {
    if (recorder.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: BITS_PER_SECOND });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    r.onstop = () => {
      clearTimers();
      for (const track of stream.getTracks()) track.stop();
      recorder.current = null;
      setRecording(false);
      onDone(new Blob(chunks, { type: (r.mimeType || mimeType || "audio/webm").split(";")[0] }));
    };
    recorder.current = r;
    r.start();
    const began = Date.now();
    setElapsedMs(0);
    setRecording(true);
    timers.current.tick = setInterval(() => setElapsedMs(Date.now() - began), 250);
    timers.current.stop = setTimeout(() => r.state === "recording" && r.stop(), MAX_RECORD_MS);
  }, []);

  // Leaving the page mid-recording releases the microphone.
  useEffect(() => () => stop(), [stop]);

  return { recording, elapsedMs, start, stop };
}
