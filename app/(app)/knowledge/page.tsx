import { redirect } from "next/navigation";
import { CatalogueIcon } from "@/components/ui/CatalogueIcon";
import { PageHeader } from "@/components/ui/PageHeader";
import { getSessionUser } from "@/lib/auth/session";
import { filesLabel, type KnowledgeCatalogue, readKnowledge } from "@/lib/knowledge";
import { requestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

const PAGE =
  "mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 py-8 min-[600px]:px-8 min-[600px]:py-10";

/** The catalogues Plugent may read, the user's own apart from the Library ones. */
export default async function KnowledgePage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const data = await readKnowledge(user.uid, `${await requestOrigin()}/knowledge`);

  const connect = data.connectUrl && (
    <a
      href={data.connectUrl}
      className="inline-flex h-11 items-center self-start rounded-full bg-act px-5 text-[15px] font-bold text-white hover:bg-act-press"
    >
      {"error" in data || !data.connected ? "Connect catalogues" : "Change catalogues"}
    </a>
  );

  if ("error" in data || !data.connected || data.catalogues.length === 0) {
    const message =
      "error" in data
        ? `Your catalogues could not be read just now (${data.error}). Try again in a moment.`
        : !data.connected
          ? "Plugent can't read any of your catalogues yet. Choose which ones on Sebtember."
          : "Plugent is connected, but no catalogue is ticked. Tick at least one on Sebtember.";
    return (
      <main className={PAGE}>
        <PageHeader title="Knowledge" />
        <div className="flex flex-col gap-4 rounded-card bg-card p-6 shadow-card">
          <p className="text-[17px] leading-[26px]">{message}</p>
          {connect}
        </div>
      </main>
    );
  }

  const own = data.catalogues.filter((c) => !c.library);
  const library = data.catalogues.filter((c) => c.library);
  return (
    <main className={PAGE}>
      <PageHeader
        title="Knowledge"
        lead="The Sebtember catalogues your agents read. Add files and catalogues on Sebtember."
      />
      {own.length > 0 && <Section title="Your catalogues" items={own} />}
      {library.length > 0 && (
        <Section
          title="From the Library"
          note="Catalogues other people publish on Sebtember that you subscribe to."
          items={library}
        />
      )}
      {connect}
    </main>
  );
}

function Section({
  title,
  note,
  items,
}: {
  title: string;
  note?: string;
  items: KnowledgeCatalogue[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-[22px] font-bold">{title}</h2>
        {note && <p className="text-[15px] text-ink2">{note}</p>}
      </div>
      <ul className="overflow-hidden rounded-list bg-card shadow-card">
        {items.map((c, i) => (
          <li
            key={c.id}
            className={`flex min-h-14 items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-hair border-t-[0.5px]" : ""}`}
          >
            <CatalogueIcon library={c.library} />
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{c.name}</span>
            <span className="shrink-0 text-[13px] text-ink2">{filesLabel(c)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
