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
  const origin = process.env.SEBTEMBER_API_ORIGIN;
  const audience = process.env.SEBTEMBER_PRODUCT_API_AUDIENCE;
  const key = process.env.PLUGENT_SERVICE_ACCOUNT_JSON;
  if (!origin || !audience || !key) {
    throw new SebtemberApiError(503, "not_configured");
  }
  return { origin, audience, credentials: JSON.parse(key) };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const { origin, audience, credentials } = settings();
  const client = await new GoogleAuth({ credentials }).getIdTokenClient(audience);
  const idToken = await client.idTokenProvider.fetchIdToken(audience);
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
