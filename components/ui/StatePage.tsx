import Link from "next/link";

const PILL =
  "inline-flex h-11 items-center justify-center rounded-full bg-act px-6 text-[15px] font-bold text-white hover:bg-act-press";
const PILL_QUIET =
  "inline-flex h-11 items-center justify-center rounded-full bg-fill2 px-5 text-[15px] font-semibold text-ink hover:bg-sel hover:text-link";

/** A whole-page message in Plugent's card style (not found, an error): what happened, and a
 *  way on. `action` is an extra button beside "Back to Home". */
export function StatePage({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <main className="flex min-h-[calc(100dvh-56px)] flex-1 items-center justify-center px-4 py-10 min-[900px]:min-h-dvh">
      <div className="flex w-full max-w-[460px] flex-col items-center gap-3 rounded-card bg-card px-8 py-10 text-center shadow-card">
        <h1 className="text-[22px] font-bold">{title}</h1>
        <p className="text-[15px] leading-[22px] text-ink2">{text}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {action && (
            <button type="button" onClick={action.onClick} className={PILL_QUIET}>
              {action.label}
            </button>
          )}
          <Link href="/home" className={PILL}>
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
