"use client";

import { useState } from "react";

type AskResult =
  | {
      kind: "answer";
      answer: string;
      sources: { n: number; fileName: string; catalogueName: string | null; page: string | null }[];
      tokens: number;
      balanceAfter: number | null;
      charged: boolean;
    }
  | { kind: "not_covered"; tokens: number; balanceAfter: number | null };

const ERRORS: Record<string, string> = {
  low_balance: "Your Sebtember balance is too low. Top it up on Sebtember.",
  not_connected: "Plugent isn't connected to your Sebtember catalogues.",
  invalid_question: "Type a question first (up to 2,000 characters).",
};

/** The Ask agent: a question in, an answer from the connected catalogues with sources. */
export function AskPanel({ onSpent }: { onSpent?: (balanceAfter: number) => void }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/agents/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json().catch(() => ({ error: `http_${res.status}` }));
      if (!res.ok) {
        setError(ERRORS[data.error] ?? `Something went wrong (${data.error}).`);
        return;
      }
      setResult(data);
      if (typeof data.balanceAfter === "number") onSpent?.(data.balanceAfter);
    } catch {
      setError("Plugent couldn't be reached. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line p-4 text-sm">
      <p className="font-semibold">Ask your knowledge</p>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy && question.trim()) ask();
        }}
        rows={3}
        maxLength={2000}
        placeholder="Ask a question about the documents in your connected catalogues"
        className="w-full resize-y rounded-lg border border-line bg-transparent p-2"
      />
      <button
        type="button"
        onClick={ask}
        disabled={busy || question.trim().length === 0}
        className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Searching and answering…" : "Ask"}
      </button>
      {error && <p className="text-red-500">{error}</p>}
      {result?.kind === "not_covered" && (
        <p className="text-muted">
          Your connected catalogues don't seem to cover this. Try other words, or connect more
          catalogues.
        </p>
      )}
      {result?.kind === "answer" && (
        <div className="space-y-3">
          <p className="whitespace-pre-wrap leading-relaxed">{result.answer}</p>
          <ol className="space-y-1 text-xs text-muted">
            {result.sources.map((s) => (
              <li key={s.n}>
                [{s.n}] {s.fileName}
                {s.page ? `, p. ${s.page}` : ""}
                {s.catalogueName ? ` (${s.catalogueName})` : ""}
              </li>
            ))}
          </ol>
        </div>
      )}
      {result && (
        <p className="text-xs text-muted">
          Cost: {result.tokens.toLocaleString("en-US")} tokens
          {result.kind === "answer" && !result.charged ? " (not charged: billing failed)" : ""}
        </p>
      )}
    </div>
  );
}
