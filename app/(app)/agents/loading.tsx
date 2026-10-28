/** While a page's server work runs (reading a run, a Sebtember call): the page's outline. */
export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading"
      className="flex min-h-[calc(100dvh-56px)] flex-1 flex-col min-[900px]:min-h-dvh"
    >
      <div className="flex items-center gap-3 border-hair border-b-[0.5px] px-4 py-3.5 min-[600px]:px-8">
        <span className="size-9 animate-pulse rounded-control bg-fill2" />
        <span className="flex flex-col gap-1.5">
          <span className="h-4 w-48 animate-pulse rounded-full bg-fill2" />
          <span className="h-3 w-28 animate-pulse rounded-full bg-fill1" />
        </span>
      </div>
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-4 py-7 min-[600px]:px-8">
        <span className="h-12 w-2/3 animate-pulse self-end rounded-list bg-fill1" />
        <span className="h-40 animate-pulse rounded-card bg-fill1" />
      </div>
    </main>
  );
}
