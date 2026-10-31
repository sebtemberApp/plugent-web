import { ClipboardList, FileText, type LucideIcon, MessageCircle, Tag, Wrench } from "lucide-react";
import type { AgentEntry, AgentId } from "@/lib/agents/registry";

const ICONS: Record<AgentId, LucideIcon> = {
  chat: MessageCircle,
  troubleshooting: Wrench,
  specification: FileText,
  quotation: ClipboardList,
  pricing: Tag,
};

/** Text colour and a 13% tint of the agent's accent, spelled out so Tailwind sees them. */
const TINT: Record<AgentEntry["accent"], string> = {
  "a-chat": "text-a-chat bg-a-chat/13",
  "a-ts": "text-a-ts bg-a-ts/13",
  "a-spec": "text-a-spec bg-a-spec/13",
  "a-quo": "text-a-quo bg-a-quo/13",
  "a-price": "text-a-price bg-a-price/13",
};

/** The agent's icon on its accent tint: 28px in a row, 40px on a card. */
export function AgentIcon({ agent, size = "row" }: { agent: AgentEntry; size?: "row" | "card" }) {
  const Icon = ICONS[agent.id];
  const box = size === "card" ? "size-10 rounded-control" : "size-7 rounded-chip";
  return (
    <span className={`flex shrink-0 items-center justify-center ${box} ${TINT[agent.accent]}`}>
      <Icon aria-hidden size={size === "card" ? 22 : 16} strokeWidth={1.8} />
    </span>
  );
}
