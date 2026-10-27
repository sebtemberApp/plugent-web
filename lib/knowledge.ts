/**
 * The signed-in user's Sebtember catalogues for Plugent. Every catalogue they can open is
 * connected by default; the one control is Pause, and every agent skips a paused one
 * (sebtember Step 1178). Each comes with its file count, split into the user's own and the
 * Library ones (other users' published catalogues, sebtember Step 1176).
 * Read by `/api/knowledge` and the Knowledge page.
 */
import "server-only";
import {
  getKnowledgeCatalogues,
  getKnowledgeSources,
  SebtemberApiError,
} from "@/lib/sebtember/products";

/** A catalogue's first page; a fuller count is shown as "200+". */
const COUNT_PAGE = 200;

export interface KnowledgeCatalogue {
  id: string;
  name: string;
  library: boolean;
  paused: boolean;
  files: number | null;
  more: boolean;
}

export type Knowledge = { catalogues: KnowledgeCatalogue[] } | { error: string };

export async function readKnowledge(uid: string): Promise<Knowledge> {
  try {
    const { connected, catalogues } = await getKnowledgeCatalogues(uid);
    // An older sebtember still asks for ticks: nothing to show until it is updated.
    if (!connected) return { error: "sebtember_update_pending" };
    const withCounts = await Promise.all(
      catalogues.map(async (c) => {
        const paused = c.paused === true;
        // A paused catalogue's files are not readable; its count is not shown.
        const page = paused
          ? null
          : await getKnowledgeSources(uid, c.id, COUNT_PAGE).catch(() => null);
        return {
          id: c.id,
          name: c.name,
          library: c.library === true,
          paused,
          files: page ? page.sources.length : null,
          more: page ? page.nextCursor !== null : false,
        };
      }),
    );
    return { catalogues: withCounts };
  } catch (err) {
    if (!(err instanceof SebtemberApiError)) console.error("[knowledge]", err);
    return { error: err instanceof SebtemberApiError ? err.code : "unavailable" };
  }
}

/** "12 files", "200+ files", or "Files unknown" when the count could not be read. */
export function filesLabel(c: Pick<KnowledgeCatalogue, "files" | "more">): string {
  if (c.files === null) return "Files unknown";
  const n = `${c.files.toLocaleString("en-US")}${c.more ? "+" : ""}`;
  return c.files === 1 && !c.more ? "1 file" : `${n} files`;
}
