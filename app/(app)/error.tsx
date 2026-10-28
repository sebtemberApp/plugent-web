"use client";

import { useEffect } from "react";
import { StatePage } from "@/components/ui/StatePage";

/** An unexpected failure while opening a page (a Sebtember outage, say), inside the app's frame. */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatePage
      title="This page couldn't open"
      text="Plugent or Sebtember didn't answer in time. Nothing was lost; try again in a moment."
      action={{ label: "Try again", onClick: () => unstable_retry() }}
    />
  );
}
