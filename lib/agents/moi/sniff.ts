/**
 * Step 1115 (audit M6) — what a file IS, from its bytes and its name, not from
 * the browser's word. PURE and client-safe (a `Uint8Array`, no Node types).
 *
 * ⚠️ THE DECLARED MIME IS A CLAIM. `file.type` is EMPTY for a file whose
 * extension has no registered handler on the user's machine (common on
 * Windows, and on drag-drops out of some mail clients), and the upload client
 * then said `application/octet-stream`. The gather dispatched on that word
 * alone, and its fallthrough was `buf.toString("utf8")` — so a PDF became up
 * to 1.5 M characters of binary noise, chunked into paid text batches, and
 * came back as "No materials or equipment were found in this file". The
 * extraction Cloud Function has sniffed magic bytes since Step 343; this path
 * is the same document going through a different door.
 *
 * ⚠️ BYTES FIRST, EXTENSION SECOND, THE CLAIM LAST. A signature is the one
 * thing neither the browser nor the user can get wrong. A zip container
 * (`PK…`) is a docx OR an xlsx and the bytes cannot say which without reading
 * the central directory, so the extension decides between the two — and when
 * it does not, the claim stands.
 */

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The formats the picker accepts, by extension — the belt for an empty `file.type`. */
const BY_EXTENSION: Record<string, string> = {
  pdf: PDF,
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  docx: DOCX,
  xlsx: XLSX,
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
};

export function extensionOf(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return m?.[1]?.toLowerCase() ?? "";
}

/** The MIME a filename implies, or "" when the extension is unknown. */
export function mimeFromExtension(filename: string): string {
  return BY_EXTENSION[extensionOf(filename)] ?? "";
}

function startsWith(bytes: Uint8Array, sig: number[], at = 0): boolean {
  if (bytes.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) if (bytes[at + i] !== sig[i]) return false;
  return true;
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** The MIME the BYTES say, or "" when no signature is recognised. */
export function mimeFromBytes(bytes: Uint8Array, filename = ""): string {
  if (startsWith(bytes, ascii("%PDF-"))) return PDF;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF8"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // A zip: Word or Excel — the extension tells them apart.
    const ext = extensionOf(filename);
    if (ext === "docx") return DOCX;
    if (ext === "xlsx") return XLSX;
    return "";
  }
  return "";
}

/**
 * The MIME the gather should dispatch on: the bytes' say, else the
 * extension's, else the declared one, else the octet-stream it started as.
 */
export function sniffMimeType(bytes: Uint8Array, declared: string, filename: string): string {
  return (
    mimeFromBytes(bytes, filename) ||
    mimeFromExtension(filename) ||
    (declared || "").trim() ||
    "application/octet-stream"
  );
}
