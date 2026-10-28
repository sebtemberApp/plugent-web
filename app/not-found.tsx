import { StatePage } from "@/components/ui/StatePage";

/** A URL Plugent has no page for. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh bg-page">
      <StatePage title="This page isn't here" text="The link may be wrong or out of date." />
    </div>
  );
}
