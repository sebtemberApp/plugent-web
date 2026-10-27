import { AccountPanel } from "@/components/AccountPanel";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-3xl font-bold">Plugent</h1>
        <p className="mt-2 text-muted">
          AI agents that work from the knowledge you keep in Sebtember. One account, one balance.
        </p>
      </div>
      <AccountPanel />
      <p className="text-xs text-muted">
        Build {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"}
      </p>
    </main>
  );
}
