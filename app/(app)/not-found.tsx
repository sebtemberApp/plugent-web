import { StatePage } from "@/components/ui/StatePage";

/** A run or page that does not exist (or was deleted), inside the app's frame. */
export default function NotFound() {
  return (
    <StatePage
      title="This page isn't here"
      text="The run may have been deleted, or the link is wrong. Your other runs are in the sidebar."
    />
  );
}
