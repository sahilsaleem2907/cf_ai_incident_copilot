import { Button } from "@cloudflare/kumo";
import { MicrophoneIcon, StopIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useRateLimitToast } from "../hooks/useRateLimitToast";
import { MAX_RECORD_MS, micErrorText, recorderSupported, useRecorder } from "../hooks/useRecorder";
import { transcribe, VOICE_ERROR_TEXT } from "../lib/api";
import { loadingProps } from "./CtaButton";

const clock = (ms: number) => `0:${String(Math.min(30, Math.floor(ms / 1000))).padStart(2, "0")}`;

type Props = {
  /** The transcript, for the input box; it's never sent from here (FR-61). */
  onTranscript: (text: string) => void;
  /** An error in words, or null to clear it. */
  onError: (message: string | null) => void;
  disabled?: boolean;
};

/** Voice input (WP-23): click to start, click to stop, stops by itself at 30 s. Hidden where recording isn't supported. */
export function VoiceButton({ onTranscript, onError, disabled }: Props) {
  const { recording, elapsedMs, start, stop } = useRecorder();
  const [busy, setBusy] = useState(false);
  const rateLimited = useRateLimitToast();
  if (!recorderSupported()) return null;

  const done = async (audio: Blob) => {
    setBusy(true);
    try {
      const r = await transcribe(audio);
      if (!r.ok) return onError(r.error === "rate_limited" ? rateLimited(r.retryAfter) : VOICE_ERROR_TEXT[r.error]);
      if (!r.text.trim()) return onError("Didn't catch that. Try again, a little closer to the microphone.");
      onTranscript(r.text.trim());
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (recording) return stop();
    onError(null);
    try {
      await start((audio) => void done(audio));
    } catch (e) {
      onError(micErrorText(e));
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {recording && (
        <span className="font-mono text-xs text-(--cf-fg-muted) tabular-nums">
          {clock(elapsedMs)} / {clock(MAX_RECORD_MS)}
        </span>
      )}
      <Button
        type="button"
        variant="secondary"
        shape="square"
        aria-pressed={recording}
        aria-label={busy ? "Turning your recording into text" : recording ? "Stop recording" : "Start voice input"}
        title={recording ? "Stop recording" : "Voice input (up to 30 seconds)"}
        onClick={() => void toggle()}
        {...loadingProps(busy, recording ? <StopIcon weight="fill" className="text-cf-orange" /> : <MicrophoneIcon />, disabled && !recording)}
      />
      <span className="sr-only" aria-live="polite">
        {recording ? "Recording" : busy ? "Transcribing" : ""}
      </span>
    </div>
  );
}
