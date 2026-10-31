/**
 * The Pricing upload (client). Sebtember's `lib/agents/moi/upload-client.ts` puts the file in its
 * own Storage with the user's Firebase session; Plugent has no Sebtember Storage session, so
 * `start` asks sebtember for a SIGNED upload URL and the browser PUTs the file to it (a 25 MB
 * file cannot pass through two Vercel functions). `moiFileProblem` is sebtember's, copied.
 */
import { mimeFromExtension } from "@/lib/agents/moi/sniff";
import {
  acceptsMoiFile,
  MOI_UNSUPPORTED_FILE_MESSAGE,
  uploadSizeProblem,
} from "@/lib/agents/moi/types";

/**
 * Step 1159 — why this file cannot be priced, or null: its TYPE (a drop
 * bypasses the input's `accept`) and its SIZE (the storage rule's caps). The
 * drop zone runs it before anything is uploaded, so a refusal names the reason
 * instead of surfacing as a failed upload.
 */
export function moiFileProblem(file: File): string | null {
  const mimeType = file.type || mimeFromExtension(file.name);
  if (!acceptsMoiFile(file.name, mimeType)) return MOI_UNSUPPORTED_FILE_MESSAGE;
  return uploadSizeProblem(file.size, mimeType);
}

const REFUSALS: Record<string, string> = {
  low_balance: "Your Sebtember balance is too low. Top up in Sebtember to price a list.",
  too_large: "This file is too large to price.",
  blocked_type: "This kind of file can't be priced.",
  agent_off: "Pricing is turned off. Turn it on in All agents.",
};

export class PricingUploadError extends Error {}

/** Starts a run for `file` and uploads it. Returns Plugent's run id. */
export async function uploadPricingFile(file: File): Promise<{ runId: string }> {
  const mimeType = file.type || mimeFromExtension(file.name) || "application/octet-stream";
  const res = await fetch("/api/agents/pricing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", filename: file.name, mimeType, size: file.size }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    runId?: string;
    upload?: { url: string; method: string; headers?: Record<string, string> };
    error?: string;
  };
  if (!res.ok || !data.runId || !data.upload) {
    throw new PricingUploadError(REFUSALS[data.error ?? ""] ?? "Couldn't start pricing.");
  }
  const put = await fetch(data.upload.url, {
    method: data.upload.method || "PUT",
    // ⚠️ The signed URL's OWN headers, exactly as given: it signs `Content-Type`, and adding our own
    // `content-type` beside it made the browser send the value twice, joined ("a, a") — a 403.
    headers: data.upload.headers ?? { "content-type": mimeType },
    body: file,
  });
  if (!put.ok) throw new PricingUploadError("Couldn't upload that file.");
  return { runId: data.runId };
}
