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

async function post<T>(path: string, body: unknown): Promise<T> {
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

export function getBalance(uid: string): Promise<ProductBalance> {
  return post<ProductBalance>("/api/products/balance", { uid });
}

export function charge(uid: string, source: string, lines: ChargeLine[]): Promise<ChargeResult> {
  return post<ChargeResult>("/api/products/charge", { uid, source, lines });
}
