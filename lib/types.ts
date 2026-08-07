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
  /** YYYY-MM-DD the task is planned for. Drives the Today and Tomorrow
   *  views; a date in the past simply stops matching either. */
  plannedOn?: string;
  /** @deprecated Pre-Tomorrow name for plannedOn; normalised on read. */
  todayOn?: string;
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

/**
 * A view, not a home: tasks tagged for today appear here *and* stay in their
 * own bucket. Nothing is ever stored with this as its listId.
 */
export const TODAY_LIST_ID = "today";

/** Same idea as Today, one day out. A tag dated tomorrow rolls into the
 *  Today view by itself once tomorrow arrives. */
export const TOMORROW_LIST_ID = "tomorrow";

/** The day planner, surfaced as a bucket rather than a separate screen. */
export const PLAN_LIST_ID = "plan";

/**
 * A slot on the day planner. A block either schedules a task (taskId set) or
 * is a standalone commitment with no task behind it — a meeting, a commute,
 * lunch. Scheduling never creates or mutates tasks.
 */
export interface Block {
  id: string;
  /** YYYY-MM-DD, local. */
  date: string;
  /** Minutes from midnight. */
  start: number;
  /** Length in minutes. */
  duration: number;
  title: string;
  /** Set when the block schedules an existing task. */
  taskId?: string;
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

export const SETTINGS_VERSION = 3;

export const DEFAULT_SETTINGS: Settings = {
  codeHash: null,
  autoLockMinutes: 60,
  defaultListId: "inbox",
  accent: "#1351AA",
  apiKey: "",
  aiParsing: true,
  keepTranscripts: true,
  theme: "dark",
  splashSeconds: 2,
  v: SETTINGS_VERSION,
};

export const DEFAULT_LISTS: List[] = [
  { id: "inbox", name: "Inbox", keywords: [], order: 0 },
  { id: "work", name: "Work", keywords: ["work", "meeting", "email", "client", "deck"], order: 1 },
  { id: "personal", name: "Personal", keywords: ["home", "buy", "call", "pick up", "grocery"], order: 2 },
  { id: TODAY_LIST_ID, name: "Today", keywords: [], order: -1, system: true },
  // -0.5 keeps Tomorrow between Today and Inbox without renumbering the
  // lists already stored on devices.
  { id: TOMORROW_LIST_ID, name: "Tomorrow", keywords: [], order: -0.5, system: true },
  { id: PLAN_LIST_ID, name: "Plan", keywords: [], order: -0.25, system: true },
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
