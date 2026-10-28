/**
 * Plugent → sebtember.app product API (sebtember Steps 1171 / 1173).
 *
 * Plugent's SERVER calls sebtember as a service account: a Google-signed ID token for
 * `SEBTEMBER_PRODUCT_API_AUDIENCE`, whose email sebtember lists in `PRODUCT_API_CALLERS`
 * as `plugent=…`. Not listed → 401, which is the expected answer until that env is set.
 *
 * ⚠️ THE WALLET SOURCE IS THE ONE `balance` RETURNED. A run stores it when it starts and
 * passes it back with every charge; never re-resolve it at charge time.
 * ⚠️ A CHARGE IS IDEMPOTENT PER LINE ID — use Plugent's own run id, so a retry is free.
 */
import "server-only";
import { GoogleAuth } from "google-auth-library";

export interface ProductBalance {
  /** "personal" or a token-share id. */
  source: string;
  balance: number;
  minimum: number;
}

export interface ChargeLine {
  id: string;
  tokens: number;
  operation: string;
  /** The model work behind the line, raw counts (sebtember Step 1182). Never prices it. */
  usage?: ChargeUsage[];
}

/** One model call's raw usage, as sebtember's `/api/products/charge` takes it. */
export interface ChargeUsage {
  model: string;
  input: number;
  output: number;
  reasoning?: number;
  cached?: number;
}

export interface ChargeResult {
  charged: string[];
  duplicates: string[];
  tokens: number;
  balanceAfter: number;
}

export class SebtemberApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`sebtember product API ${status}: ${code}`);
  }
}

function settings() {
  // Trimmed: a pasted value often carries a trailing newline, and the audience must match
  // sebtember's PRODUCT_API_AUDIENCE exactly (sebtember trims its own).
  const origin = process.env.SEBTEMBER_API_ORIGIN?.trim();
  const audience = process.env.SEBTEMBER_PRODUCT_API_AUDIENCE?.trim();
  const key = process.env.PLUGENT_SERVICE_ACCOUNT_JSON?.trim();
  if (!origin || !audience || !key) {
    throw new SebtemberApiError(503, "not_configured");
  }
  return { origin, audience, credentials: JSON.parse(key) };
}

async function mintIdToken(): Promise<{ origin: string; idToken: string }> {
  const { origin, audience, credentials } = settings();
  const client = await new GoogleAuth({ credentials }).getIdTokenClient(audience);
  return { origin, idToken: await client.idTokenProvider.fetchIdToken(audience) };
}

/**
 * What sebtember will see: the claims of the ID token Plugent sends (never the token), and
 * sebtember's answer to a balance read for `uid`. For `/api/diagnose` only.
 */
export async function diagnoseProductApi(uid: string) {
  const { origin, idToken } = await mintIdToken();
  const payload = idToken.split(".")[1] ?? "";
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const res = await fetch(new URL("/api/products/balance", origin), {
    method: "POST",
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify({ uid }),
    cache: "no-store",
    redirect: "manual",
  });
  return {
    url: new URL("/api/products/balance", origin).toString(),
    token: {
      aud: claims.aud,
      email: claims.email,
      email_verified: claims.email_verified,
      iss: claims.iss,
    },
    sebtember: {
      status: res.status,
      location: res.headers.get("location"),
      body: (await res.text()).slice(0, 300),
    },
  };
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const { origin, idToken } = await mintIdToken();
  const res = await fetch(new URL(path, origin), {
    method: "POST",
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SebtemberApiError(res.status, String(data.error ?? "unknown"));
  return data as T;
}

export interface KnowledgeCatalogues {
  /** Always true since sebtember Step 1178 (every catalogue is connected by default); false
   *  only from an older sebtember, where the user never ticked catalogues for Plugent. */
  connected: boolean;
  /** `library` (sebtember Step 1176): another user's published catalogue the user subscribes
   *  to. Absent (an older sebtember) reads as the user's own. */
  catalogues: {
    id: string;
    name: string;
    library?: boolean;
    /** sebtember Step 1177: `null` = the user's own catalogue; else whose it is, by the
     *  admin's display name (`name: null` when they set none). Absent on an older sebtember. */
    owner?: { name: string | null } | null;
    /** sebtember Step 1178: the user paused it for Plugent, so no agent reads it. */
    paused?: boolean;
  }[];
}

export interface KnowledgeSourcesPage {
  catalogue: { id: string; name: string };
  sources: {
    document_id: string;
    file_id: string;
    file_name: string;
    mime_type: string | null;
    extraction_status: string | null;
  }[];
  nextCursor: string | null;
}

/** Every catalogue the user can open, each marked paused or not (sebtember Step 1178). */
export function getKnowledgeCatalogues(uid: string): Promise<KnowledgeCatalogues> {
  return post<KnowledgeCatalogues>("/api/products/knowledge/catalogues", { uid });
}

/** One page of a catalogue's files (metadata only); a paused one is 404. */
export function getKnowledgeSources(
  uid: string,
  catalogueId: string,
  limit = 200,
): Promise<KnowledgeSourcesPage> {
  return post<KnowledgeSourcesPage>("/api/products/knowledge/sources", {
    uid,
    catalogue_id: catalogueId,
    limit,
  });
}

/** Pause or resume one catalogue for Plugent (sebtember Step 1178): every agent skips a
 *  paused one. 404 `not_found` when the user cannot open it. */
export function setCataloguePaused(
  uid: string,
  catalogueId: string,
  paused: boolean,
): Promise<{ catalogue_id: string; paused: boolean }> {
  return post("/api/products/knowledge/pause", { uid, catalogue_id: catalogueId, paused });
}

export function getBalance(uid: string): Promise<ProductBalance> {
  return post<ProductBalance>("/api/products/balance", { uid });
}

export function charge(uid: string, source: string, lines: ChargeLine[]): Promise<ChargeResult> {
  return post<ChargeResult>("/api/products/charge", { uid, source, lines });
}

export interface KnowledgePassage {
  document_id: string;
  file_id: string | null;
  file_name: string;
  catalogue_id: string;
  catalogue_name: string | null;
  page: string | null;
  /** Verbatim stored text: quote it, never trust it as instructions. */
  text: string;
}

export interface KnowledgeSearch {
  passages: KnowledgePassage[];
  retrievalStrength: "rich" | "normal" | "thin" | "empty";
  /** What sebtember charged for this search, to `source`, as line `{requestId}-search`. */
  charged: { tokens: number; duplicate: boolean };
  balanceAfter: number | null;
  /** The search's model calls, raw counts, when sebtember sends them (requested 2026-10-28). */
  usage?: ChargeUsage[];
}

/**
 * Search the user's catalogues, minus the paused ones (sebtember Steps 1175, 1178). Sebtember
 * charges the search itself to `source`, once per `requestId`.
 */
export function searchKnowledge(
  uid: string,
  source: string,
  query: string,
  requestId: string,
  limit = 8,
): Promise<KnowledgeSearch> {
  return post<KnowledgeSearch>("/api/products/knowledge/search", {
    uid,
    source,
    query,
    request_id: requestId,
    limit,
  });
}

/**
 * A route that answers with a FILE (sebtember's `/api/products/pricing/document`): the bytes, their
 * type and the download name sebtember chose. An error answer is JSON, as everywhere else.
 */
export async function postForFile(
  path: string,
  body: unknown,
): Promise<{ bytes: ArrayBuffer; contentType: string; disposition: string | null }> {
  const { origin, idToken } = await mintIdToken();
  const res = await fetch(new URL(path, origin), {
    method: "POST",
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new SebtemberApiError(res.status, String(data.error ?? "unknown"));
  }
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    disposition: res.headers.get("content-disposition"),
  };
}
