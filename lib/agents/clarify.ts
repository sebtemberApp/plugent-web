/**
 * Sebtember chat's `ask_clarification` tool (`lib/chat/clarify.ts`), as the AI SDK tool both
 * Chat and Troubleshooting pass: its description and parameter wording, and `sanitizeClarify`,
 * are sebtember's, copied verbatim. Calling it ENDS the turn: the question and its 2-4 options
 * are the reply, shown as chips, and the user's pick is their next message.
 */
import { jsonSchema, tool } from "ai";

export const CLARIFY_TOOL = tool({
  description:
    "Ask the user ONE focused clarifying question, with a short list of options, " +
    "when their request is genuinely ambiguous in a way that materially changes the " +
    "answer (e.g. several distinct product variants match what they named). Prefer " +
    "answering directly; only call this when guessing would risk a wrong answer. " +
    "Provide 2-4 concise, mutually exclusive options.",
  inputSchema: jsonSchema<{ question: string; options: string[] }>({
    type: "object",
    properties: {
      question: { type: "string", description: "The single clarifying question to show the user." },
      options: {
        type: "array",
        items: { type: "string" },
        description: "2-4 short, mutually exclusive choices the user can pick from.",
      },
    },
    required: ["question", "options"],
  }),
});

/** sebtember `sanitizeClarify`: trim, dedupe, 2-4 options, length caps. */
export function sanitizeClarify(raw: unknown): { question: string; options: string[] } | null {
  const args = (raw ?? {}) as Record<string, unknown>;
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (!question) return null;
  const options = Array.from(
    new Set(
      (Array.isArray(args.options) ? args.options : [])
        .filter((o): o is string => typeof o === "string")
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    ),
  );
  if (options.length < 2) return null;
  return {
    question: question.slice(0, 300),
    options: options.slice(0, 4).map((o) => o.slice(0, 80)),
  };
}
