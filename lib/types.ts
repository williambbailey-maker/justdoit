export type Priority = "none" | "low" | "med" | "high";

export interface Task {
  id: string;
  title: string;
  note?: string;
  listId: string;
  done: boolean;
  priority: Priority;
  /** ISO date string, YYYY-MM-DD. */
  due?: string;
  createdAt: number;
  completedAt?: number;
  /** Set when the task came out of a voice note. */
  source?: "voice";
}

export interface List {
  id: string;
  name: string;
  /** Keywords used to route voice-note tasks when AI parsing is unavailable. */
  keywords: string[];
  order: number;
}

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
  showCompleted: boolean;
  accent: string;
  /** Optional per-device Anthropic key; the server env var takes precedence. */
  apiKey: string;
  /** Turn AI voice parsing off and fall back to local rules. */
  aiParsing: boolean;
  /** Keep the raw transcript of every processed voice note. */
  keepTranscripts: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  codeHash: null,
  autoLockMinutes: 60,
  defaultListId: "inbox",
  showCompleted: false,
  accent: "#1351AA",
  apiKey: "",
  aiParsing: true,
  keepTranscripts: true,
};

export const DEFAULT_LISTS: List[] = [
  { id: "inbox", name: "Inbox", keywords: [], order: 0 },
  { id: "work", name: "Work", keywords: ["work", "meeting", "email", "client", "deck"], order: 1 },
  { id: "personal", name: "Personal", keywords: ["home", "buy", "call", "pick up", "grocery"], order: 2 },
];

/** Shape returned by /api/parse for each extracted task. */
export interface ParsedTask {
  title: string;
  listId: string;
  due?: string;
  priority?: Priority;
  note?: string;
}
