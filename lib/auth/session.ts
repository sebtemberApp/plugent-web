/**
 * Plugent's session: the browser signs in with Sebtember's Firebase Auth, posts the ID
 * token to `/api/session`, and gets back Plugent's OWN HttpOnly cookie.
 *
 * ⚠️ Why not a Firebase session cookie: `createSessionCookie` needs a credential on
 * SEBTEMBER's project. Verifying an ID token needs only its project id (Google's public
 * keys), so Plugent holds no sebtember credential at all. The cost: a user disabled on
 * sebtember stays signed in here until the cookie expires (SESSION_DAYS). Revisit before
 * launch if that matters.
 *
 * Every route reads the user with `getSessionUser()`; never trust a client-passed uid.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "__plugent_session";
export const SESSION_DAYS = 5;

export interface SessionUser {
  uid: string;
  email: string | null;
}

function secret(): string {
  const value = process.env.PLUGENT_SESSION_SECRET ?? "";
  if (value.length < 32) throw new Error("PLUGENT_SESSION_SECRET must be at least 32 characters.");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** The cookie value for a verified user: base64url(json).signature */
export function mintSession(user: SessionUser): string {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ ...user, exp })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSession(value: string | undefined): SessionUser | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.uid !== "string" || typeof data.exp !== "number" || data.exp < Date.now()) {
      return null;
    }
    return { uid: data.uid, email: typeof data.email === "string" ? data.email : null };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return readSession(store.get(SESSION_COOKIE)?.value);
}

const oauth = new OAuth2Client();

/**
 * A Firebase ID token from Sebtember's project → the user, or null. Checks Google's
 * signature, the audience (the project id), the issuer and the expiry.
 */
export async function verifySebtemberIdToken(idToken: string): Promise<SessionUser | null> {
  const projectId = process.env.NEXT_PUBLIC_SEBTEMBER_FIREBASE_PROJECT_ID;
  if (!projectId) return null;
  try {
    const ticket = await oauth.verifySignedJwtWithCertsAsync(
      idToken,
      await firebaseCerts(),
      projectId,
      [`https://securetoken.google.com/${projectId}`],
    );
    const claims = ticket.getPayload();
    if (!claims?.sub) return null;
    return { uid: claims.sub, email: claims.email ?? null };
  } catch {
    return null;
  }
}

const FIREBASE_CERTS =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certCache: { certs: Record<string, string>; until: number } | null = null;

async function firebaseCerts(): Promise<Record<string, string>> {
  if (certCache && certCache.until > Date.now()) return certCache.certs;
  const res = await fetch(FIREBASE_CERTS);
  if (!res.ok) throw new Error(`Firebase certs: ${res.status}`);
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  certCache = { certs: await res.json(), until: Date.now() + maxAge * 1000 };
  return certCache.certs;
}
