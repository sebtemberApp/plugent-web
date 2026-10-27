/**
 * GET /api/health — which build is live and which settings it can see. Never a value:
 * only whether each variable is present, so a misconfigured deployment can be diagnosed
 * from a browser without reading Vercel's logs.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED = [
  "NEXT_PUBLIC_SEBTEMBER_FIREBASE_API_KEY",
  "NEXT_PUBLIC_SEBTEMBER_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_SEBTEMBER_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_SEBTEMBER_FIREBASE_APP_ID",
  "PLUGENT_SESSION_SECRET",
  "SEBTEMBER_API_ORIGIN",
  "SEBTEMBER_PRODUCT_API_AUDIENCE",
  "PLUGENT_SERVICE_ACCOUNT_JSON",
] as const;

export function GET() {
  const settings = Object.fromEntries(
    REQUIRED.map((name) => [name, Boolean(process.env[name]?.trim())]),
  );
  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    env: process.env.VERCEL_ENV ?? "local",
    settings,
    sessionSecretLongEnough: (process.env.PLUGENT_SESSION_SECRET ?? "").length >= 32,
    serviceAccountJsonParses: parses(process.env.PLUGENT_SERVICE_ACCOUNT_JSON),
    // The Ask agent's model: an AI Gateway key, else Vercel's OIDC token on a deployment.
    aiGateway: process.env.AI_GATEWAY_API_KEY?.trim()
      ? "key"
      : process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL
        ? "oidc"
        : "none",
  });
}

function parses(raw: string | undefined): boolean {
  try {
    const key = JSON.parse(raw ?? "");
    return typeof key.client_email === "string" && typeof key.private_key === "string";
  } catch {
    return false;
  }
}
