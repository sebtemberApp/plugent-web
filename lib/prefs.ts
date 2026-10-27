/**
 * The user's Plugent preferences, in Plugent's Firestore at `users/{uid}`: which agents
 * they turned OFF (`disabled_agents`) and Chat's default mode (`chat_default_mode`).
 * Server-only, like every Plugent collection. A missing document = every agent on,
 * Standard mode.
 */
import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { AskMode } from "@/lib/agents/ask";
import { AGENTS, type AgentId } from "@/lib/agents/registry";
import { plugentDb } from "@/lib/firebase/admin";

export interface UserPrefs {
  disabledAgents: AgentId[];
  chatMode: AskMode;
}

const DEFAULTS: UserPrefs = { disabledAgents: [], chatMode: "standard" };

export function isAgentId(value: unknown): value is AgentId {
  return AGENTS.some((a) => a.id === value);
}

function prefsRef(uid: string) {
  return plugentDb().collection("users").doc(uid);
}

export async function readPrefs(uid: string): Promise<UserPrefs> {
  const snap = await prefsRef(uid).get();
  if (!snap.exists) return DEFAULTS;
  const disabled = snap.get("disabled_agents");
  return {
    disabledAgents: Array.isArray(disabled) ? disabled.filter(isAgentId) : [],
    chatMode: snap.get("chat_default_mode") === "deep" ? "deep" : "standard",
  };
}

/** Prefs for rendering: a read failure falls back to the defaults, never a broken page. */
export function readPrefsOrDefaults(uid: string): Promise<UserPrefs> {
  return readPrefs(uid).catch((err) => {
    console.error("[prefs] read failed", err);
    return DEFAULTS;
  });
}

export async function setAgentEnabled(uid: string, agent: AgentId, enabled: boolean) {
  await prefsRef(uid).set(
    {
      disabled_agents: enabled ? FieldValue.arrayRemove(agent) : FieldValue.arrayUnion(agent),
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function setChatMode(uid: string, mode: AskMode) {
  await prefsRef(uid).set(
    { chat_default_mode: mode, updated_at: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
