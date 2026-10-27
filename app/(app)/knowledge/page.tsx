import { redirect } from "next/navigation";
import { PauseButton } from "@/components/knowledge/PauseButton";
import { CatalogueIcon } from "@/components/ui/CatalogueIcon";
import { PageHeader } from "@/components/ui/PageHeader";
import { getSessionUser } from "@/lib/auth/session";
import { filesLabel, type KnowledgeCatalogue, readKnowledge } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

const PAGE =
  "mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 py-8 min-[600px]:px-8 min-[600px]:py-10";

/** Every Sebtember catalogue the user can open, own apart from Library, each with Pause. */
export default async function KnowledgePage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const data = await readKnowledge(user.uid);

  if ("error" in data || data.catalogues.length === 0) {
    const message =
      "error" in data
        ? `Your catalogues could not be read just now (${data.error}). Try again in a moment.`
        : "You have no catalogues on Sebtember yet. Add files there and they show up here.";
    return (
      <main className={PAGE}>
        <PageHeader title="Knowledge" />
        <div className="rounded-card bg-card p-6 shadow-card">
          <p className="text-[17px] leading-[26px]">{message}</p>
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
        lead="Your agents read every Sebtember catalogue you can open. Pause one and every agent skips it until you resume it."
      />
      {own.length > 0 && <Section title="Your catalogues" items={own} />}
      {library.length > 0 && (
        <Section
          title="From the Library"
          note="Catalogues other people publish on Sebtember that you subscribe to."
          items={library}
        />
      )}
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
            <span
              className={`flex min-w-0 flex-1 items-center gap-3 ${c.paused ? "opacity-50" : ""}`}
            >
              <CatalogueIcon library={c.library} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-semibold">{c.name}</span>
                <span className="text-[13px] text-ink2">
                  {c.paused ? "Paused · agents skip it" : filesLabel(c)}
                </span>
              </span>
            </span>
            <PauseButton catalogueId={c.id} name={c.name} paused={c.paused} />
          </li>
        ))}
      </ul>
    </section>
  );
}
