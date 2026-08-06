export type Priority = "none" | "low" | "med" | "high";

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  note?: string;
  subtasks?: Subtask[];
  listId: string;
  done: boolean;
  priority: Priority;
  /** ISO date string, YYYY-MM-DD. */
  due?: string;
  createdAt: number;
  completedAt?: number;
  /** List the task sat in before completion, so un-checking can restore it. */
  prevListId?: string;
  /** Set when the task came out of a voice note. */
  source?: "voice";
}

export interface List {
  id: string;
  name: string;
  /** Keywords used to route voice-note tasks when AI parsing is unavailable. */
  keywords: string[];
  order: number;
  /** Managed by the app — not a routing target, and can't be deleted. */
  system?: boolean;
}

/** Completed tasks are moved here automatically. */
export const DONE_LIST_ID = "done";

export interface VoiceNote {
  id: string;
  transcript: string;
  createdAt: number;
  /** Task ids created from this note. */
  taskIds: string[];
}

export interface Settings {
  /** SHA-256 of the 4-digit code. Null means the app is unlocked/unconfigured. */
  codeHash: string | null;
  /** Minutes of inactivity before re-locking. 0 disables auto-lock. */
  autoLockMinutes: number;
  defaultListId: string;
  accent: string;
  /** Optional per-device Anthropic key; the server env var takes precedence. */
  apiKey: string;
  /** Turn AI voice parsing off and fall back to local rules. */
  aiParsing: boolean;
  /** Keep the raw transcript of every processed voice note. */
  keepTranscripts: boolean;
  /** "system" follows the OS setting. */
  theme: "system" | "light" | "dark";
  /** Length of the launch animation in seconds. 0 skips it. */
  splashSeconds: number;
  /** Bumped when a stored settings object needs migrating. */
  v: number;
}

export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: Settings = {
  codeHash: null,
  autoLockMinutes: 60,
  defaultListId: "inbox",
  accent: "#1351AA",
  apiKey: "",
  aiParsing: true,
  keepTranscripts: true,
  theme: "system",
  splashSeconds: 2,
  v: SETTINGS_VERSION,
};

export const DEFAULT_LISTS: List[] = [
  { id: "inbox", name: "Inbox", keywords: [], order: 0 },
  { id: "work", name: "Work", keywords: ["work", "meeting", "email", "client", "deck"], order: 1 },
  { id: "personal", name: "Personal", keywords: ["home", "buy", "call", "pick up", "grocery"], order: 2 },
  { id: DONE_LIST_ID, name: "Done", keywords: [], order: 999, system: true },
];

/** Shape returned by /api/parse for each extracted task. */
export interface ParsedTask {
  title: string;
  listId: string;
  due?: string;
  priority?: Priority;
  note?: string;
}
