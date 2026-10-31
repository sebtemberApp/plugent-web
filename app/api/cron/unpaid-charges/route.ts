/**
 * GET /api/cron/unpaid-charges — Vercel Cron (`vercel.json`, daily): pays the charge lines that
 * failed when their run finished (`lib/unpaid.ts`). Vercel sends `Authorization: Bearer
 * $CRON_SECRET`; without the variable set the route refuses everyone.
 */
import { type NextRequest, NextResponse } from "next/server";
import { retryUnpaid } from "@/lib/unpaid";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await retryUnpaid(null, 200);
  console.log(`[cron] unpaid charges paid=${result.paid} still_unpaid=${result.failed}`);
  return NextResponse.json(result);
}
