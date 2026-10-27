import { BookOpen, Folder } from "lucide-react";

/** A folder for the user's own catalogue, a book for a Library one. */
export function CatalogueIcon({ library }: { library: boolean }) {
  const Icon = library ? BookOpen : Folder;
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-chip ${
        library ? "bg-k-lib/13 text-k-lib" : "bg-k-own/13 text-k-own"
      }`}
      title={library ? "Library catalogue" : "Your catalogue"}
    >
      <Icon aria-hidden size={17} strokeWidth={1.8} />
    </span>
  );
}
