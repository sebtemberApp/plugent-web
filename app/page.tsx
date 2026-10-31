import { BookOpen, FileSearch, ListChecks } from "lucide-react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { AgentCarousel } from "@/components/marketing/AgentCarousel";
import { SignIn } from "@/components/SignIn";
import { Logo } from "@/components/shell/Logo";
import { getSessionUser } from "@/lib/auth/session";

const PROMISES = [
  {
    icon: <ListChecks aria-hidden size={22} />,
    title: "Built for one job each",
    text: "Every agent already knows its task, step by step. You don't write long prompts or explain the job again.",
  },
  {
    icon: <FileSearch aria-hidden size={22} />,
    title: "Only from your documents",
    text: "Agents use what you give them, never the open web. Each answer shows its sources, and if the answer isn't there, the agent tells you.",
  },
  {
    icon: <BookOpen aria-hidden size={22} />,
    title: "Your knowledge, ready for AI",
    text: "Keep your files in sebtember.app, a wiki made for AI. Upload once and every agent can use them.",
  },
];

const SEBTEMBER = "https://sebtember.app";

const PRICING = [
  {
    title: "Pay per run",
    text: "Each run uses tokens for the work it does. You pay only for the work that was done, and reading a finished result again is free.",
  },
  {
    title: "One balance with Sebtember",
    text: "Plugent spends the same token balance as your Sebtember account. Top up once and use it in both.",
  },
  {
    title: "Start free, share with your team",
    text: "New Sebtember accounts get a free starting balance. A company can share its balance with the team, with a monthly cap per person.",
  },
];

/** A screenshot of the app, framed like a browser window. */
function Screen({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-card bg-card shadow-pop">
      <div aria-hidden className="flex gap-1.5 border-hair border-b-[0.5px] px-4 py-3">
        <span className="size-2.5 rounded-full bg-fill2" />
        <span className="size-2.5 rounded-full bg-fill2" />
        <span className="size-2.5 rounded-full bg-fill2" />
      </div>
      <Image
        src={src}
        alt={alt}
        width={2560}
        height={1600}
        priority={priority}
        sizes="(min-width: 1080px) 1016px, 100vw"
        className="w-full"
      />
    </div>
  );
}

/** Signed out: what Plugent does, shown rather than told, and the one way in. Signed in: Home. */
export default async function Landing() {
  if (await getSessionUser()) redirect("/home");
  return (
    <div className="min-h-dvh overflow-x-hidden">
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-4 py-5 sm:px-8">
        <Logo className="h-8" />
        <nav className="flex items-center gap-5 text-[15px] font-semibold">
          <a href="#pricing" className="text-ink2 hover:text-ink">
            Pricing
          </a>
          <a href="#sign-in" className="text-link">
            Sign in
          </a>
        </nav>
      </header>

      <main className="mx-auto flex max-w-[1080px] flex-col gap-24 px-4 pt-8 pb-16 sm:px-8 sm:pt-12">
        <section className="flex flex-col gap-10">
          <div className="grid items-end gap-8 md:grid-cols-[1fr_380px]">
            <div className="flex flex-col gap-5">
              <h1 className="text-[38px] leading-[44px] font-bold tracking-[-0.025em] sm:text-[52px] sm:leading-[58px]">
                Pre-built AI agents for daily tasks
              </h1>
              <p className="max-w-[580px] text-[18px] leading-[28px] text-ink2">
                Plugent's agents answer questions, fix faults, write specifications and price
                materials lists, all from your own documents.
              </p>
            </div>
            <div id="sign-in" className="scroll-mt-8 rounded-card bg-card p-6 shadow-card">
              <p className="mb-4 text-[15px] leading-[22px] text-ink2">
                Sign in with your Sebtember account. Same login, same balance.
              </p>
              <SignIn />
            </div>
          </div>
          <Screen
            src="/marketing/chat.png"
            alt="Plugent's Chat agent answering a price question, with the two source files it used"
            priority
          />
        </section>

        <section className="grid gap-8 md:grid-cols-[1fr_1fr] md:items-center">
          <div className="flex flex-col gap-4">
            <p className="text-[13px] font-semibold tracking-[0.06em] text-act uppercase">
              Why Plugent
            </p>
            <h2 className="text-[32px] leading-[38px] font-bold tracking-[-0.02em]">
              Chat assistants can do a lot. Getting them to do your task takes work.
            </h2>
          </div>
          <div className="flex flex-col gap-4 text-[17px] leading-[27px] text-ink2">
            <p>
              You explain the job, attach the files again, correct the answer, and check every
              number. Then you do it all again tomorrow.
            </p>
            <p className="text-ink">
              We do that work once, properly. You get a plug-and-play tool for a task your team does
              every day.
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-[32px] leading-[38px] font-bold tracking-[-0.02em]">
              Meet the agents
            </h2>
            <p className="text-[17px] leading-[26px] text-ink2">
              How each one works, and what it saves you.
            </p>
          </div>
          <AgentCarousel />
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {PROMISES.map((p) => (
            <div key={p.title} className="flex flex-col gap-3 rounded-card bg-card p-6 shadow-card">
              <span className="flex size-10 items-center justify-center rounded-control bg-sel text-act">
                {p.icon}
              </span>
              <h3 className="text-[19px] font-bold">{p.title}</h3>
              <p className="text-[15px] leading-[23px] text-ink2">{p.text}</p>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-[32px] leading-[38px] font-bold tracking-[-0.02em]">
              Every agent in one place
            </h2>
            <p className="text-[17px] leading-[26px] text-ink2">
              Pick a task from Home. Your earlier runs wait in the sidebar.
            </p>
          </div>
          <Screen
            src="/marketing/home.png"
            alt="Plugent's Home page with the agents to choose from"
          />
        </section>

        <section id="pricing" className="flex scroll-mt-8 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-[32px] leading-[38px] font-bold tracking-[-0.02em]">Pricing</h2>
            <p className="text-[17px] leading-[26px] text-ink2">
              No subscription and no seats. You pay for the work an agent does, nothing else.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {PRICING.map((p) => (
              <div
                key={p.title}
                className="flex flex-col gap-2 rounded-card bg-card p-6 shadow-card"
              >
                <h3 className="text-[19px] font-bold">{p.title}</h3>
                <p className="text-[15px] leading-[23px] text-ink2">{p.text}</p>
              </div>
            ))}
          </div>
          <p className="text-[15px] leading-[23px] text-ink2">
            Token prices in your currency, with VAT, are on{" "}
            <a href={`${SEBTEMBER}/usage`} className="font-semibold text-link">
              sebtember.app
            </a>{" "}
            when you top up.
          </p>
        </section>

        <section className="flex flex-col items-start gap-4 rounded-card bg-[#16152E] p-6 text-white sm:p-10">
          <h2 className="text-[30px] leading-[36px] font-bold tracking-[-0.02em]">
            Plug in your knowledge. Pick a task.
          </h2>
          <p className="max-w-[560px] text-[17px] leading-[27px] text-white/75">
            No setup and no new account. If you already use sebtember.app, your documents are
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

      <footer className="mx-auto flex max-w-[1080px] flex-col gap-3 px-4 pb-10 text-[13px] leading-[20px] text-ink2 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Plugent runs on{" "}
            <a href={SEBTEMBER} className="font-semibold text-link">
              sebtember.app
            </a>
            , your wiki for AI.
          </span>
          <nav aria-label="Legal" className="flex gap-4 font-semibold">
            <a href={`${SEBTEMBER}/terms`} className="hover:text-ink">
              Terms of Service
            </a>
            <a href={`${SEBTEMBER}/privacy`} className="hover:text-ink">
              Privacy Policy
            </a>
            <a href={`${SEBTEMBER}/security`} className="hover:text-ink">
              Security
            </a>
          </nav>
        </div>
        <p>
          You sign in to Plugent with your Sebtember account, so Sebtember's Terms of Service and
          Privacy Policy apply. Build{" "}
          {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"}
        </p>
      </footer>
    </div>
  );
}
