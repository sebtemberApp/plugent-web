import { redirect } from "next/navigation";
import { AppFrame } from "@/components/shell/AppFrame";
import { getSessionUser } from "@/lib/auth/session";
import { listRuns, type RunSummary } from "@/lib/runs";

/** Every signed-in page: no Plugent session → the sign-in page. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const origin = process.env.SEBTEMBER_API_ORIGIN?.trim();
  // The sidebar's run history; a read failure leaves it empty rather than the page broken.
  const runs: RunSummary[] | null = await listRuns(user.uid).catch((err) => {
    console.error("[runs] list failed", err);
    return null;
  });
  return (
    <AppFrame
      email={user.email}
      topUpUrl={origin ? new URL("/usage", origin).toString() : null}
      runs={runs}
    >
      {children}
    </AppFrame>
  );
}
