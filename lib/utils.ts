/**
 * The two helpers the copied pricing view code (sebtember's `components/pricing/*`) imports from
 * `@/lib/utils`.
 *
 * ⚠️ `cn` JOINS, it does not merge: sebtember's runs tailwind-merge, which drops the earlier of two
 * conflicting utilities. The copied components pass a conflicting pair only where they override a
 * default on purpose (`mt-0` over the downloads' margin), and those few call sites are adjusted in the
 * copy rather than pulling in two packages for them.
 */
type ClassValue = string | false | null | undefined | 0;

export function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(" ");
}

/** Thousands separators, pinned to en-US so the server and the browser print the same text. */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
