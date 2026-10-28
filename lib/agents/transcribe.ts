/**
 * Speak (audit F2): a recorded clip to text, transcribed by PLUGENT (Vaidas, 2026-10-28: model
 * work runs in Plugent, Sebtember serves data only), on the AI Gateway like every agent.
 *
 * ⚠️ THE SAME CALL AS SEBTEMBER'S MIC (`lib/notes/transcription.ts`): Gemini flash reads the clip
 * as an audio file part with sebtember's own transcription prompt, never translating.
 * ⚠️ PRICED LIKE SEBTEMBER'S MIC: sebtember bills its transcription with `computeBilledTokens`'
 * default factors (input ÷5, thinking and output ×1), so speaking costs the same in both.
 * A failed transcription is not charged; an empty one (no speech) is, as sebtember does.
 */
import "server-only";
import { generateText } from "ai";
import type { ChargeUsage } from "@/lib/sebtember/products";
import { usageOf } from "@/lib/usage";

/** Sebtember's `NATIVE_MULTIMODAL_MODEL` on the gateway. */
export const TRANSCRIBE_MODEL =
  process.env.PLUGENT_TRANSCRIBE_MODEL?.trim() || "google/gemini-3.5-flash";
/** Sebtember's `MAX_AUDIO_BYTES`: a 5-minute clip at 32 kbps is about 1.2 MB. */
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
/** Sebtember's accepted audio mimes (MediaRecorder's outputs and common uploads). */
export const AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/flac",
];
const TIMEOUT_MS = 60_000;

/** Divisors on the usage (sebtember's default `computeBilledTokens` factors). */
const DISCOUNTS = { input: 5, reasoning: 1, output: 1 };

export interface Transcript {
  text: string;
  tokens: number;
  usage: ChargeUsage;
}

/** Sebtember's transcription prompt, word for word. */
function prompt(languageName: string | null): string {
  const languageHint = languageName
    ? `\nThe speaker's preferred language is ${languageName} — expect that language unless the audio is clearly in another. Never translate; transcribe in the language actually spoken.`
    : "\nNever translate; transcribe in the language actually spoken.";
  return `You are a transcription engine. Transcribe the attached audio recording into text.

Rules:
- Output ONLY the transcript — no preamble, no commentary, no surrounding quotation marks.
- Use natural capitalization and punctuation; start a new paragraph at natural pauses or topic shifts.
- Drop filler stutters ("uh", "um") and obvious false starts when they carry no meaning; keep everything substantive verbatim.
- If the audio contains no intelligible speech, output an empty string.${languageHint}`;
}

export async function transcribe(
  audio: Uint8Array,
  mediaType: string,
  languageName: string | null,
): Promise<Transcript> {
  const result = await generateText({
    model: TRANSCRIBE_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: audio, mediaType },
          { type: "text", text: prompt(languageName) },
        ],
      },
    ],
    // Sebtember's thinking floor for this call: transcription needs no reasoning.
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "minimal" } } },
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    maxRetries: 1,
  });
  const usage = usageOf(TRANSCRIBE_MODEL, result.totalUsage);
  const input = Math.max(usage.input - (usage.cached ?? 0), 0);
  const reasoning = usage.reasoning ?? 0;
  const output = Math.max(usage.output - reasoning, 0);
  const tokens =
    Math.ceil(input / DISCOUNTS.input) +
    Math.ceil(reasoning / DISCOUNTS.reasoning) +
    Math.ceil(output / DISCOUNTS.output);
  return { text: result.text.trim(), tokens, usage };
}
