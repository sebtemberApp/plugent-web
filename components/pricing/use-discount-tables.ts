"use client";

/**
 * Step 1105 — the discount table, loaded ONCE for the pricing page and shared
 * by the two stages that read it: the Match step's ask ("who is the discount
 * for?", `DiscountPrompt`) and the Price step's panel (`DiscountPanel`).
 *
 * ⚠️ GATED ON THE RUN'S OWN GROUPS, which cost nothing to read: `discountGroupsOf`
 * walks the stored result on the client. A run whose prices carry no group — a
 * run from before Step 1104, or price lists without the column — never asks the
 * server at all, which is what lets the ask sit on a stage EVERY completed run
 * reaches. Step 1104 loaded the table "when the step opens" because the Price
 * step was the only reader and most visits never reached it; the gate moved from
 * "which stage" to "does this run carry groups", and the ~100 small reads are
 * paid once per page rather than once per stage.
 *
 * ⚠️ DISABLED IS THE SERVER'S OWN NO-GROUP ANSWER — `{ groups: [], clients: [] }`
 * — rather than a fourth state, so the panel's empty-state branches are the same
 * ones the server would have produced, with no request made.
 *
 * ⚠️ Step 1117 (audit L6) — WHAT ARRIVES IS NAMES AND ONE ROW, not the table.
 * The server resolves the stored client (`loadDiscountMatrices`) and the typed
 * one (`applyPricingDiscountClient`); the ask hands its result to `apply` so the
 * page prices on the new row without a second load. The whole matrix — every
 * client's percentages, from every catalogue the user can reach — no longer
 * reaches the browser.
 */
import { useEffect, useState } from "react";
import type { DiscountClient, DiscountTableView } from "@/lib/agents/ipl/discount";
import { loadDiscountMatrices } from "@/lib/pricing/server";

export type DiscountTables =
  | { kind: "loading" }
  | ({ kind: "loaded" } & DiscountTableView)
  | { kind: "error"; message: string };

const NO_GROUPS: DiscountTables = {
  kind: "loaded",
  groups: [],
  clients: [],
  client: null,
  sourceFile: "",
};

export function useDiscountTables(
  docId: string,
  enabled: boolean,
): {
  tables: DiscountTables;
  reload: () => void;
  /** The ask resolved (or cleared) a client on the server: price on it now. */
  apply: (client: DiscountClient | null, sourceFile: string) => void;
} {
  const [tables, setTables] = useState<DiscountTables>(enabled ? { kind: "loading" } : NO_GROUPS);
  const [reloadKey, setReloadKey] = useState(0);

  // `reloadKey` is the "look again" button: bumping it re-runs the lookup.
  useEffect(() => {
    if (!enabled) {
      setTables(NO_GROUPS);
      return;
    }
    let live = true;
    setTables({ kind: "loading" });
    // Step 1115 — the reload button asks for a RESCAN (a new table may be a
    // new file); a plain open takes the remembered location.
    loadDiscountMatrices(docId, { rescan: reloadKey > 0 })
      .then((r) => {
        if (live) setTables({ kind: "loaded", ...r });
      })
      .catch((err: unknown) => {
        if (live)
          setTables({
            kind: "error",
            message: err instanceof Error ? err.message : "Could not load the discount table.",
          });
      });
    return () => {
      live = false;
    };
  }, [docId, enabled, reloadKey]);

  return {
    tables,
    reload: () => setReloadKey((k) => k + 1),
    apply: (client, sourceFile) =>
      setTables((t) => (t.kind === "loaded" ? { ...t, client, sourceFile } : t)),
  };
}
