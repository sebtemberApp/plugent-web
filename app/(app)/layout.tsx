import { redirect } from "next/navigation";
import { AppFrame } from "@/components/shell/AppFrame";
import { getSessionUser } from "@/lib/auth/session";

/** Every signed-in page: no Plugent session → the sign-in page. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const origin = process.env.SEBTEMBER_API_ORIGIN?.trim();
  return (
    <AppFrame email={user.email} topUpUrl={origin ? new URL("/usage", origin).toString() : null}>
      {children}
    </AppFrame>
  );
}
