/**
 * GET /api/knowledge — the signed-in user's Sebtember catalogues that Plugent may read
 * (ticked on sebtember.app's /connect/plugent), each with its file count, plus the link
 * that changes the choice. Milestone 2's proof that knowledge access is the user's call.
 */
import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  connectUrl,
  getKnowledgeCatalogues,
  getKnowledgeSources,
  SebtemberApiError,
} from "@/lib/sebtember/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A catalogue's first page; a fuller count is shown as "200+". */
const COUNT_PAGE = 200;

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const link = connectUrl(new URL("/", req.nextUrl.origin).toString());
  try {
    const { connected, catalogues } = await getKnowledgeCatalogues(user.uid);
    const withCounts = await Promise.all(
      catalogues.map(async (c) => {
        const page = await getKnowledgeSources(user.uid, c.id, COUNT_PAGE).catch(() => null);
        return {
          ...c,
          files: page ? page.sources.length : null,
          more: page ? page.nextCursor !== null : false,
        };
      }),
    );
    return NextResponse.json({ connected, catalogues: withCounts, connectUrl: link });
  } catch (err) {
    const code = err instanceof SebtemberApiError ? err.code : "unavailable";
    if (!(err instanceof SebtemberApiError)) console.error("[knowledge]", err);
    return NextResponse.json({ error: code, connectUrl: link }, { status: 502 });
  }
}
