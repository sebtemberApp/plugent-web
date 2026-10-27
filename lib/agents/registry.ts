/**
 * The agents Plugent offers, as PLAIN DATA (no React): the sidebar, Home and All agents
 * read it. Users cannot add an agent; they suggest one to the platform admin.
 * `available: false` shows the agent as "Coming soon" until it is ported from Sebtember.
 */
export type AgentId = "chat" | "troubleshooting" | "specification" | "quotation" | "pricing";

export interface AgentEntry {
  id: AgentId;
  name: string;
  /** One sentence, shown on cards. */
  description: string;
  href: string;
  available: boolean;
  /** The Tailwind colour token of the agent's accent (globals.css `--a-*`). */
  accent: "a-chat" | "a-ts" | "a-spec" | "a-quo" | "a-price";
}

export const AGENTS: readonly AgentEntry[] = [
  {
    id: "chat",
    name: "Chat",
    description: "Ask anything and get an answer from your documents, with its sources.",
    href: "/agents/chat",
    available: true,
    accent: "a-chat",
  },
  {
    id: "troubleshooting",
    name: "Troubleshooting",
    description: "Describe a fault and work through it one checked step at a time.",
    href: "/agents/troubleshooting",
    available: false,
    accent: "a-ts",
  },
  {
    id: "specification",
    name: "Specification",
    description: "Name a product and get its parameters, installation and operation notes.",
    href: "/agents/specification",
    available: false,
    accent: "a-spec",
  },
  {
    id: "quotation",
    name: "Quotation",
    description: "Turn a request into a quotation drafted from your documents.",
    href: "/agents/quotation",
    available: false,
    accent: "a-quo",
  },
  {
    id: "pricing",
    name: "Pricing",
    description: "Upload a tender or bill of materials and price every line from your price lists.",
    href: "/agents/pricing",
    available: false,
    accent: "a-price",
  },
];

export function agentById(id: AgentId): AgentEntry {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`Unknown agent ${id}`);
  return agent;
}
