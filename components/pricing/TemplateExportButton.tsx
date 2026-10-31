"use client";

/**
 * The Price step's way out: the priced list written into a plain PDF or Word document and downloaded
 * on the spot. Sebtember's `TemplateExportButton` (its Step 1110) with the default templates only —
 * a user's own letterhead templates live in Sebtember's Preferences and come later.
 *
 * It POSTs the Match step's TICKS and the beneficiary's NAME; sebtember re-derives every figure from
 * the stored run and the discount table (nothing here is trusted as a price) and streams the file.
 * ⚠️ NOT a paid call: an export is a view, like the sheet.
 */
import { FileTextIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const CHOICES = [
  { id: "default-pdf", label: "PDF", kind: "pdf" },
  { id: "default-docx", label: "Word", kind: "docx" },
] as const;

export function TemplateExportButton({
  docId,
  selected,
  client,
  className,
}: {
  docId: string;
  selected: ReadonlyMap<number, ReadonlySet<number>>;
  client: string | null;
  className?: string;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(choice: (typeof CHOICES)[number]) {
    if (busyId) return;
    setBusyId(choice.id);
    setError(null);
    try {
      const res = await fetch("/api/agents/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "document",
          runId: docId,
          templateId: choice.id,
          selected: Object.fromEntries([...selected].map(([i, set]) => [String(i), [...set]])),
          client,
        }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const m = /filename\*=UTF-8''([^;]+)/.exec(disposition);
      const filename = m?.[1] ? decodeURIComponent(m[1]) : `pricing.${choice.kind}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <div className="flex gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={busyId !== null}
            onClick={() => void download(c)}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-fill2 px-4 text-[14px] font-semibold text-ink transition-colors hover:bg-sel hover:text-link disabled:opacity-50"
          >
            {busyId === c.id ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FileTextIcon size={15} aria-hidden="true" />
            )}
            {c.label}
          </button>
        ))}
      </div>
      {error ? <span className="text-footnote text-destructive">{error}</span> : null}
    </div>
  );
}
