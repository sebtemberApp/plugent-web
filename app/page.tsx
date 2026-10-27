import { BookOpen, FileSearch, Layers, ListChecks, Plug, Upload } from "lucide-react";
import { redirect } from "next/navigation";
import { SignIn } from "@/components/SignIn";
import { Logo } from "@/components/shell/Logo";
import { AgentIcon } from "@/components/ui/AgentIcon";
import { AGENTS } from "@/lib/agents/registry";
import { getSessionUser } from "@/lib/auth/session";

const PILLARS = [
  {
    icon: <ListChecks aria-hidden size={22} />,
    title: "Specialised agents",
    text: "Each agent does one job and does it the same way every time: price a materials list, draft a specification, fix a fault. The steps are built in, so you don't write them as prompts.",
  },
  {
    icon: <FileSearch aria-hidden size={22} />,
    title: "Only your content",
    text: "Agents work only from the documents you feed them, never the open web. Every answer shows its sources. If your documents don't hold the answer, the agent says so instead of guessing.",
  },
  {
    icon: <BookOpen aria-hidden size={22} />,
    title: "A wiki for AI",
    text: "Your knowledge lives in sebtember.app: manuals, price lists, contracts, drawings. Sebtember reads each file once and keeps it searchable, so every agent can use it straight away.",
  },
];

const STEPS = [
  {
    icon: <Upload aria-hidden size={18} />,
    title: "Upload in Sebtember",
    text: "Add documents, spreadsheets, images and notes to your catalogues. Sebtember reads them for you.",
  },
  {
    icon: <Layers aria-hidden size={18} />,
    title: "Your catalogues are connected",
    text: "Every catalogue you can open, Library ones too. Pause any you want the agents to skip.",
  },
  {
    icon: <Plug aria-hidden size={18} />,
    title: "Run an agent",
    text: "Pick the task, give it the input, get the result. Pay only for the tokens a run uses.",
  },
];

/** Signed out: what Plugent is, why it exists, and the one way in. Signed in: Home. */
export default async function Landing() {
  if (await getSessionUser()) redirect("/home");
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-4 py-5 sm:px-8">
        <Logo className="h-8" />
        <a href="#sign-in" className="text-[15px] font-semibold text-link">
          Sign in
        </a>
      </header>

      <main className="mx-auto flex max-w-[1080px] flex-col gap-20 px-4 pt-8 pb-16 sm:px-8 sm:pt-14">
        <section className="grid items-center gap-10 md:grid-cols-[1fr_400px]">
          <div className="flex flex-col gap-5">
            <h1 className="text-[36px] leading-[42px] font-bold tracking-[-0.025em] sm:text-[48px] sm:leading-[54px]">
              Specialised AI agents that work from your own documents
            </h1>
            <p className="max-w-[560px] text-[18px] leading-[28px] text-ink2">
              Plugent is a collection of focused, well-structured agents. Each one does a task your
              organisation does every day, using only the content you give it.
            </p>
          </div>
          <div id="sign-in" className="scroll-mt-8 rounded-card bg-card p-6 shadow-card">
            <h2 className="mb-1 text-[20px] font-bold">Start with your Sebtember account</h2>
            <p className="mb-5 text-[15px] leading-[22px] text-ink2">
              The same login and the same balance as sebtember.app.
            </p>
            <SignIn />
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-card bg-card p-6 shadow-card sm:p-10">
          <p className="text-[13px] font-semibold tracking-[0.06em] text-act uppercase">
            Why Plugent
          </p>
          <h2 className="max-w-[720px] text-[28px] leading-[34px] font-bold tracking-[-0.015em]">
            Complex work shouldn't take a hundred prompts
          </h2>
          <div className="grid gap-6 text-[16px] leading-[26px] text-ink2 md:grid-cols-2">
            <p>
              A chat assistant can do a lot, but a real task takes real effort: explaining the job,
              attaching the files again, steering each reply, checking every number.
            </p>
            <p>
              Our job is to do that work once, properly, and give you a plug-and-play tool for it.
              You bring the documents and the input. The agent already knows the job.
            </p>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.title} className="flex flex-col gap-3 rounded-card bg-card p-6 shadow-card">
              <span className="flex size-10 items-center justify-center rounded-control bg-sel text-act">
                {p.icon}
              </span>
              <h3 className="text-[19px] font-bold">{p.title}</h3>
              <p className="text-[15px] leading-[23px] text-ink2">{p.text}</p>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-5">
          <h2 className="text-[28px] leading-[34px] font-bold tracking-[-0.015em]">The agents</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AGENTS.map((a) => (
              <div key={a.id} className="flex gap-3 rounded-card bg-card p-5 shadow-card">
                <AgentIcon agent={a} size="card" />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[17px] font-bold">{a.name}</span>
                    {!a.available && (
                      <span className="rounded-chip bg-fill1 px-2 py-0.5 text-[12px] font-semibold text-ink2">
                        Coming soon
                      </span>
                    )}
                  </span>
                  <span className="text-[15px] leading-[22px] text-ink2">{a.description}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-5">
          <h2 className="text-[28px] leading-[34px] font-bold tracking-[-0.015em]">How it works</h2>
          <ol className="grid gap-3 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2 rounded-card bg-fill1 p-5">
                <span className="flex items-center gap-2 text-ink2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-page">
                    {i + 1}
                  </span>
                  {s.icon}
                </span>
                <span className="text-[17px] font-bold">{s.title}</span>
                <span className="text-[15px] leading-[22px] text-ink2">{s.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col items-start gap-4 rounded-card bg-ink p-6 text-page sm:p-10">
          <h2 className="text-[28px] leading-[34px] font-bold tracking-[-0.015em]">
            Plug in your knowledge. Pick a task.
          </h2>
          <p className="max-w-[560px] text-[16px] leading-[26px] opacity-80">
            No setup and no new account. If you already use sebtember.app, your catalogues are
            waiting.
          </p>
          <a
            href="#sign-in"
            className="flex h-[52px] items-center rounded-full bg-act px-6 text-[17px] font-bold text-white hover:bg-act-press"
          >
            Sign in with Sebtember
          </a>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-3 px-4 pb-10 text-[13px] text-ink2 sm:px-8">
        <span>
          Plugent runs on{" "}
          <a href="https://sebtember.app" className="font-semibold text-link">
            sebtember.app
          </a>
          , your wiki for AI.
        </span>
        <span>Build {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"}</span>
      </footer>
    </div>
  );
}
