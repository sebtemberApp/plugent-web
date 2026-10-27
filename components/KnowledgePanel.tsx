"use client";

import { useEffect, useState } from "react";

type Knowledge =
  | {
      connected: boolean;
      catalogues: { id: string; name: string; files: number | null; more: boolean }[];
      connectUrl: string | null;
    }
  | { error: string; connectUrl: string | null };

/** The Sebtember catalogues Plugent may read, and the link to change that choice. */
export function KnowledgePanel() {
  const [data, setData] = useState<Knowledge | null>(null);

  useEffect(() => {
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ error: "unavailable", connectUrl: null }));
  }, []);

  if (!data) return <p className="text-sm text-muted">Reading your Sebtember catalogues…</p>;

  const link = data.connectUrl ? (
    <a
      href={data.connectUrl}
      className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
    >
      {"error" in data || !data.connected ? "Connect Sebtember catalogues" : "Change catalogues"}
    </a>
  ) : null;

  return (
    <div className="space-y-3 rounded-xl border border-line p-4 text-sm">
      <p className="font-semibold">Your Sebtember knowledge</p>
      {"error" in data ? (
        <p>Catalogues unavailable ({data.error}).</p>
      ) : !data.connected ? (
        <p className="text-muted">
          Plugent can't read any of your catalogues yet. Choose which ones on Sebtember.
        </p>
      ) : data.catalogues.length === 0 ? (
        <p className="text-muted">Connected, but no catalogues are ticked.</p>
      ) : (
        <ul className="space-y-1">
          {data.catalogues.map((c) => (
            <li key={c.id} className="flex justify-between gap-4">
              <span className="truncate">{c.name}</span>
              <span className="shrink-0 text-muted">
                {c.files === null ? "?" : `${c.files}${c.more ? "+" : ""}`} files
              </span>
            </li>
          ))}
        </ul>
      )}
      {link}
    </div>
  );
}
