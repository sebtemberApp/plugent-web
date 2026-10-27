/**
 * The signed-in user's Sebtember catalogues that Plugent may read (ticked on
 * sebtember.app's /connect/plugent), each with its file count, split into the user's own
 * and the Library ones (other users' published catalogues, sebtember Step 1176).
 * Read by `/api/knowledge` and the Knowledge page.
 */
import "server-only";
import {
  connectUrl,
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
  files: number | null;
  more: boolean;
}

export type Knowledge =
  | { connected: boolean; catalogues: KnowledgeCatalogue[]; connectUrl: string | null }
  | { error: string; connectUrl: string | null };

export async function readKnowledge(uid: string, returnTo: string): Promise<Knowledge> {
  const link = connectUrl(returnTo);
  try {
    const { connected, catalogues } = await getKnowledgeCatalogues(uid);
    const withCounts = await Promise.all(
      catalogues.map(async (c) => {
        const page = await getKnowledgeSources(uid, c.id, COUNT_PAGE).catch(() => null);
        return {
          id: c.id,
          name: c.name,
          library: c.library === true,
          files: page ? page.sources.length : null,
          more: page ? page.nextCursor !== null : false,
        };
      }),
    );
    return { connected, catalogues: withCounts, connectUrl: link };
  } catch (err) {
    if (!(err instanceof SebtemberApiError)) console.error("[knowledge]", err);
    return { error: err instanceof SebtemberApiError ? err.code : "unavailable", connectUrl: link };
  }
}

/** "12 files", "200+ files", or "Files unknown" when the count could not be read. */
export function filesLabel(c: Pick<KnowledgeCatalogue, "files" | "more">): string {
  if (c.files === null) return "Files unknown";
  const n = `${c.files.toLocaleString("en-US")}${c.more ? "+" : ""}`;
  return c.files === 1 && !c.more ? "1 file" : `${n} files`;
}
