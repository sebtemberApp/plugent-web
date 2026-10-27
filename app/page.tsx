import { redirect } from "next/navigation";
import { SignIn } from "@/components/SignIn";
import { Logo } from "@/components/shell/Logo";
import { getSessionUser } from "@/lib/auth/session";

/** Signed out: what Plugent is and the one way in. Signed in: Home. */
export default async function Landing() {
  if (await getSessionUser()) redirect("/home");
  return (
    <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col justify-center gap-8 px-4 py-10">
      <Logo className="h-9" />
      <div className="flex flex-col gap-3">
        <h1 className="text-[34px] leading-[40px] font-bold tracking-[-0.02em]">
          Agents that work from your knowledge
        </h1>
        <p className="text-[17px] leading-[26px] text-ink2">
          Keep your documents, price lists and manuals in Sebtember. Plugent's agents read them to
          answer, troubleshoot, specify and price. One account, one balance.
        </p>
      </div>
      <div className="rounded-card bg-card p-6 shadow-card">
        <SignIn />
        <p className="mt-4 text-[13px] leading-[18px] text-ink2">
          Use the Google account you sign in to Sebtember with.
        </p>
      </div>
      <p className="text-[12px] text-ink2">
        Build {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"}
      </p>
    </main>
  );
}
