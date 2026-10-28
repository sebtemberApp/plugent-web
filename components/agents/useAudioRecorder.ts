"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The microphone, recorded in the browser — sebtember's `useAudioRecorder`
 * (`components/catalogues/useAudioRecorder.ts`), the hook behind its notes and chat mic.
 * Speech-grade Opus (32 kbps) with a 5-minute cap, so a clip stays well under the route's 6 MB.
 * `onComplete` gets the clip on Stop (and at the cap), never on Cancel.
 */
const MAX_SECONDS = 300;
const BITS_PER_SECOND = 32_000;

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow it in your browser to speak.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No microphone found.";
  return "Couldn't start recording.";
}

export function useAudioRecorder(onComplete: (blob: Blob, mimeType: string) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onComplete);
  done.current = onComplete;
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const mime = useRef("");
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsed = useRef(0);

  // Read after mount: the server cannot see the browser, so the first render must say "no
  // microphone" on both sides (a different first render is a hydration error in React 19).
  const [supported, setSupported] = useState(false);
  useEffect(
    () =>
      setSupported(!!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined"),
    [],
  );

  const release = useCallback(() => {
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    recorder.current = null;
  }, []);

  const finish = useCallback(
    (cancel: boolean) => {
      cancelled.current = cancel;
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setRecording(false);
      const rec = recorder.current;
      if (rec && rec.state !== "inactive") rec.stop();
      else release();
    },
    [release],
  );

  const start = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError("Voice input isn't supported in this browser.");
      return false;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      mime.current = pickMimeType();
      const rec = new MediaRecorder(media, {
        ...(mime.current ? { mimeType: mime.current } : {}),
        audioBitsPerSecond: BITS_PER_SECOND,
      });
      chunks.current = [];
      cancelled.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const type = mime.current.split(";")[0] || chunks.current[0]?.type || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        chunks.current = [];
        release();
        const wasCancelled = cancelled.current;
        cancelled.current = false;
        if (!wasCancelled && blob.size > 0) done.current(blob, type);
      };
      recorder.current = rec;
      rec.start();
      elapsed.current = 0;
      setSeconds(0);
      setRecording(true);
      timer.current = setInterval(() => {
        elapsed.current += 1;
        setSeconds(elapsed.current);
        if (elapsed.current >= MAX_SECONDS) finish(false);
      }, 1000);
      return true;
    } catch (err) {
      setError(micErrorMessage(err));
      release();
      setRecording(false);
      return false;
    }
  }, [supported, release, finish]);

  // Leaving the page mid-recording drops the clip and frees the microphone.
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      const rec = recorder.current;
      if (rec && rec.state !== "inactive") {
        cancelled.current = true;
        rec.stop();
      }
      release();
    },
    [release],
  );

  return {
    recording,
    seconds,
    error,
    supported,
    start,
    stop: useCallback(() => finish(false), [finish]),
    cancel: useCallback(() => finish(true), [finish]),
    maxSeconds: MAX_SECONDS,
  };
}
