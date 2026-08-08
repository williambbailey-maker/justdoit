"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DayPlanner from "@/components/DayPlanner";
import LockScreen from "@/components/LockScreen";
import Mark from "@/components/Mark";
import SettingsPanel from "@/components/SettingsPanel";
import Splash from "@/components/Splash";
import VoiceSheet from "@/components/VoiceSheet";
import * as db from "@/lib/db";
import { clearUnlocked, hashCode, isUnlocked, markUnlocked, touchUnlocked } from "@/lib/lock";
import { localParse } from "@/lib/localParse";
import { verifyFaceId } from "@/lib/webauthn";
import {
  Block,
  DEFAULT_SETTINGS,
  DONE_LIST_ID,
  List,
  ParsedTask,
  Settings,
  Task,
  TODAY_LIST_ID,
  TOMORROW_LIST_ID,
} from "@/lib/types";

type Gate = "loading" | "set" | "locked" | "open";
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The splash length is mirrored to localStorage because it has to be known
 * synchronously on mount — well before IndexedDB settings finish loading.
 */
const SPLASH_KEY = "swoosh:splash-seconds";
const THEME_KEY = "swoosh:theme";

function Mic() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3.5" />
    </svg>
  );
}

function Gear() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--fg)" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="3.2" />
      <path
        strokeLinecap="round"
        d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9.1a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z"
      />
    </svg>
  );
}

function resolveDark(theme: Settings["theme"]): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** A date in the user's own timezone, as YYYY-MM-DD. */
function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const todayKey = () => dayKey();

function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dayKey(d);
}

function dueLabel(iso: string): string {
  const t = todayKey();
  if (iso === t) return "Today";
  if (iso < t) return "Overdue";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Home() {
  const [gate, setGate] = useState<Gate>("loading");
  const [lockError, setLockError] = useState<string>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [activeList, setActiveList] = useState<string>(TODAY_LIST_ID);
  const [quick, setQuick] = useState("");
  /** The logo toggles the day planner. */
  const [planOpen, setPlanOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState<Record<string, string>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [showVoice, setShowVoice] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [splashSeconds, setSplashSeconds] = useState(2);
  const [splashDone, setSplashDone] = useState(false);

  // Read the splash preference on mount rather than during render, so the
  // server and first client render agree.
  useEffect(() => {
    // A missing key must fall back to the default, not to Number(null) === 0,
    // which would read as "splash off" on every first launch.
    const raw = localStorage.getItem(SPLASH_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    const secs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
    setSplashSeconds(secs);
    if (secs === 0) setSplashDone(true);
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    const [t, l, bl, s] = await Promise.all([
      db.getTasks(),
      db.getLists(),
      db.getBlocks(),
      db.getSettings(),
    ]);
    setTasks(t);
    setLists(l);
    setBlocks(bl);
    setSettings(s);
    return s;
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await load();
      localStorage.setItem(SPLASH_KEY, String(s.splashSeconds));
      if (!s.codeHash) setGate("set");
      else setGate(isUnlocked(s.autoLockMinutes) ? "open" : "locked");
    })();
  }, [load]);

  // Theme and accent travel together: dark forces a monochrome accent.
  useEffect(() => {
    const apply = () => {
      const dark = resolveDark(settings.theme);
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
      // Dark is strictly monochrome, so the chosen accent applies to light only.
      document.documentElement.style.setProperty(
        "--accent",
        dark ? "#ffffff" : settings.accent,
      );
    };
    apply();
    localStorage.setItem(THEME_KEY, settings.theme);

    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.accent, settings.theme]);

  // Register the service worker, then actively check for a newer one. Without
  // the update()/controllerchange pair an installed PWA can keep serving the
  // build it first cached, which looks exactly like "my changes aren't live".
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        void reg.update();
        // Re-check whenever the app is brought back to the foreground.
        const onVisible = () => document.visibilityState === "visible" && void reg.update();
        document.addEventListener("visibilitychange", onVisible);
        return onVisible;
      })
      .catch(() => undefined);

    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  // Swipe left/right to move between buckets.
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipe.current = { x: t.clientX, y: t.clientY };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - from.x;
    const dy = t.clientY - from.y;
    // Needs to be a decisive horizontal move, or a diagonal scroll would
    // change bucket under the user.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    step(dx < 0 ? 1 : -1);
  };

  // Dismiss the gear menu on any click outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  // Keep an in-use session from auto-locking under the user.
  useEffect(() => {
    if (gate !== "open") return;
    const bump = () => touchUnlocked();
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [gate]);

  const persistSettings = async (s: Settings) => {
    setSettings(s);
    localStorage.setItem(SPLASH_KEY, String(s.splashSeconds));
    await db.saveSettings(s);
  };

  const tryFaceId = useCallback(async () => {
    if (!settings.faceIdCredential) return;
    if (await verifyFaceId(settings.faceIdCredential)) {
      markUnlocked();
      setLockError(undefined);
      setGate("open");
    }
    // A failed or dismissed prompt says nothing — the keypad is still there.
  }, [settings.faceIdCredential]);

  const handleCode = useCallback(
    async (code: string) => {
      const hash = await hashCode(code);
      if (gate === "set") {
        await persistSettings({ ...settings, codeHash: hash });
        markUnlocked();
        setGate("open");
        return;
      }
      if (hash === settings.codeHash) {
        markUnlocked();
        setLockError(undefined);
        setGate("open");
      } else {
        setLockError("Wrong code.");
      }
    },
    [gate, settings],
  );

  async function addTasks(
    parsed: ParsedTask[],
    transcript: string,
    source?: "voice",
    extra?: Partial<Task>,
  ) {
    const now = Date.now();
    const created: Task[] = parsed.map((p, i) => ({
      id: uid(),
      title: p.title,
      note: p.note,
      listId: p.listId,
      done: false,
      priority: p.priority ?? "none",
      due: p.due,
      createdAt: now + i,
      source,
      ...extra,
    }));
    await Promise.all(created.map((t) => db.saveTask(t)));

    if (source === "voice" && settings.keepTranscripts && transcript) {
      await db.saveNote({
        id: uid(),
        transcript,
        createdAt: now,
        taskIds: created.map((t) => t.id),
      });
    }
    setTasks((prev) => [...prev, ...created]);
  }

  async function toggle(task: Task) {
    const completing = !task.done;
    // Completing files the task under Done; un-checking sends it home again.
    const next: Task = completing
      ? {
          ...task,
          done: true,
          completedAt: Date.now(),
          prevListId: task.listId === DONE_LIST_ID ? task.prevListId : task.listId,
          listId: DONE_LIST_ID,
        }
      : {
          ...task,
          done: false,
          completedAt: undefined,
          listId: lists.some((l) => l.id === task.prevListId)
            ? task.prevListId!
            : settings.defaultListId,
          prevListId: undefined,
        };
    await db.saveTask(next);
    setTasks((prev) => prev.map((t) => (t.id === next.id ? next : t)));
  }

  async function remove(id: string) {
    await db.deleteTask(id);
    await db.deleteBlocksForTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setBlocks((prev) => prev.filter((b) => b.taskId !== id));
    setExpandedId((cur) => (cur === id ? null : cur));
  }

  async function patchTask(task: Task, patch: Partial<Task>) {
    const next = { ...task, ...patch };
    setTasks((prev) => prev.map((t) => (t.id === next.id ? next : t)));
    await db.saveTask(next);
  }

  const addSubtask = async (task: Task) => {
    const title = (subtaskDraft[task.id] ?? "").trim();
    if (!title) return;
    setSubtaskDraft((d) => ({ ...d, [task.id]: "" }));
    await patchTask(task, {
      subtasks: [...(task.subtasks ?? []), { id: uid(), title, done: false }],
    });
  };

  const toggleSubtask = (task: Task, id: string) =>
    patchTask(task, {
      subtasks: (task.subtasks ?? []).map((s) => (s.id === id ? { ...s, done: !s.done } : s)),
    });

  const removeSubtask = (task: Task, id: string) =>
    patchTask(task, { subtasks: (task.subtasks ?? []).filter((s) => s.id !== id) });

  /**
   * Planning doesn't move or duplicate the task — it surfaces the same task
   * in the Today or Tomorrow view while it stays in its own bucket, so
   * ticking it off in one place is ticking it off everywhere. Tapping the
   * tag it already carries clears it; tapping the other one moves it.
   */
  const setPlanned = (task: Task, day: string) =>
    patchTask(task, { plannedOn: task.plannedOn === day ? undefined : day, todayOn: undefined });

  /** Moving a task out of Done necessarily means it is no longer done. */
  const rebucket = (task: Task, listId: string) =>
    task.done
      ? patchTask(task, { listId, done: false, completedAt: undefined, prevListId: undefined })
      : patchTask(task, { listId });

  const saveBlock = async (b: Block) => {
    setBlocks((prev) => (prev.some((x) => x.id === b.id) ? prev.map((x) => (x.id === b.id ? b : x)) : [...prev, b]));
    await db.saveBlock(b);
  };

  const removeBlock = async (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    await db.deleteBlock(id);
  };

  async function submitQuick() {
    const text = quick.trim();
    if (!text) return;
    // Today, Tomorrow and Done are views, not homes — a task can never live
    // in one. Adding from those lands it in the default bucket instead, and
    // from Today/Tomorrow it also picks up the matching plan date so it shows
    // up in the view you added it from.
    const onSystemView = activeList === "all" || lists.some((l) => l.id === activeList && l.system);
    const target = onSystemView ? settings.defaultListId : activeList;
    const plannedOn =
      activeList === TODAY_LIST_ID
        ? todayKey()
        : activeList === TOMORROW_LIST_ID
          ? tomorrowKey()
          : undefined;

    const [parsed] = localParse(text, lists, target);
    await addTasks(
      [{ ...(parsed ?? { title: text, listId: target }), listId: target }],
      "",
      undefined,
      plannedOn ? { plannedOn } : undefined,
    );
    setQuick("");
  }

  const visible = useMemo(() => {
    // Nothing is deleted here — completed tasks live in the Done bucket and
    // stay there until explicitly removed. "All" means all the live lists.
    return tasks
      .filter((t) => {
        if (t.listId === DONE_LIST_ID && activeList !== DONE_LIST_ID) return false;
        if (activeList === "all") return true;
        if (activeList === TODAY_LIST_ID) return t.plannedOn === todayKey();
        if (activeList === TOMORROW_LIST_ID) return t.plannedOn === tomorrowKey();
        return t.listId === activeList;
      })
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
        if (a.due !== b.due) return a.due ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
  }, [tasks, activeList]);

  // Counts follow whatever bucket you're looking at; only "All" is global.
  const inDoneView = activeList === DONE_LIST_ID;
  const inPlan = planOpen;

  /** Rail order, used by both the tabs and the swipe gesture. */
  const railIds = useMemo(() => ["all", ...lists.map((l) => l.id)], [lists]);

  const step = (dir: 1 | -1) => {
    const i = railIds.indexOf(activeList);
    const next = railIds[i + dir];
    if (next) {
      setActiveList(next);
      setExpandedId(null);
    }
  };

  const headlineCount = inDoneView ? visible.length : visible.filter((t) => !t.done).length;
  const doneVisible = visible.filter((t) => t.done);

  async function clearCompleted() {
    if (doneVisible.length === 0) return;
    if (!confirm(`Delete ${doneVisible.length} completed task${doneVisible.length === 1 ? "" : "s"}?`)) return;
    const ids = new Set(doneVisible.map((t) => t.id));
    await Promise.all([...ids].map((id) => db.deleteTask(id)));
    setTasks((prev) => prev.filter((t) => !ids.has(t.id)));
  }
  const listName = activeList === "all" ? "Everything" : (lists.find((l) => l.id === activeList)?.name ?? "");

  // The splash covers the whole launch, including the IndexedDB read behind it.
  /** One task row. Shared by the bucket list and every Rundown group. */
  const taskRow = (task: Task, i: number) => (
    <div key={task.id}>
      <div className="group border-b border-[var(--rule)] py-4">
        <div className="flex items-start gap-4">
          <span className="idx mt-2 w-8 shrink-0">{String(i + 1).padStart(3, "0")}</span>

          <button
            onClick={() => void toggle(task)}
            aria-label={task.done ? "Mark as not done" : "Mark as done"}
            className="mt-1 h-5 w-5 shrink-0 rounded-[5px] border border-[var(--fg)] transition-colors duration-300"
            style={{ background: task.done ? "var(--accent)" : "transparent" }}
          />

          <div className="min-w-0 flex-1">
            {/* Tapping opens the detail pane. Completing stays with the
                checkbox, so a stray tap can't tick a task off. */}
            <button
              onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}
              aria-expanded={expandedId === task.id}
              className="block w-full text-left text-2xl font-medium leading-[1.1] tracking-[-0.02em] sm:text-3xl"
              style={{
                color: task.done ? "var(--muted)" : undefined,
                textDecoration: task.done ? "line-through" : undefined,
              }}
            >
              {task.title}
            </button>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="label">
                {lists.find((l) => l.id === task.listId)?.name ?? "Inbox"}
              </span>
              {(task.subtasks?.length ?? 0) > 0 && (
                <span className="label">
                  {task.subtasks!.filter((s) => s.done).length}/{task.subtasks!.length} sub-tasks
                </span>
              )}
              {task.note?.trim() && <span className="label">Note</span>}

              {([
                ["Today", todayKey()],
                ["Tomorrow", tomorrowKey()],
              ] as const).map(([label, day]) => {
                const on = task.plannedOn === day;
                return (
                  <button
                    key={label}
                    onClick={() => void setPlanned(task, day)}
                    aria-pressed={on}
                    className="label rounded-[6px] border px-2 py-0.5 transition-colors duration-300"
                    style={
                      on
                        ? {
                            borderColor: "var(--accent)",
                            color: "var(--on-accent)",
                            background: "var(--accent)",
                          }
                        : { borderColor: "var(--rule)" }
                    }
                  >
                    {label}
                  </button>
                );
              })}
              {task.due && (
                <span
                  className="label"
                  style={{ color: dueLabel(task.due) === "Overdue" ? "var(--accent)" : undefined }}
                >
                  {dueLabel(task.due)}
                </span>
              )}
              {task.priority === "high" && (
                <span className="label" style={{ color: "var(--accent)" }}>
                  Urgent
                </span>
              )}
              {task.source === "voice" && <span className="label">Voice</span>}
              <button
                onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}
                className="label ml-auto underline underline-offset-4"
              >
                {expandedId === task.id ? "Close" : "Details"}
              </button>
            </div>

          </div>
        </div>

            {expandedId === task.id && (
              <div className="mt-6 space-y-6 rounded-[10px] border border-[var(--rule)] p-4">
                <div>
                  <p className="label mb-2">Note</p>
                  <textarea
                    value={task.note ?? ""}
                    onChange={(e) => void patchTask(task, { note: e.target.value })}
                    placeholder="anything worth remembering"
                    autoCapitalize="none"
                    className="field min-h-24 resize-none text-base"
                  />
                </div>

                <div>
                  <p className="label mb-2">Sub-tasks</p>
                  {(task.subtasks ?? []).map((s) => (
                    <div key={s.id} className="flex items-center gap-3 py-2">
                      <button
                        onClick={() => void toggleSubtask(task, s.id)}
                        aria-label={s.done ? "Mark sub-task as not done" : "Mark sub-task as done"}
                        className="h-4 w-4 shrink-0 rounded-[4px] border border-[var(--fg)] transition-colors duration-300"
                        style={{ background: s.done ? "var(--accent)" : "transparent" }}
                      />
                      <span
                        className="flex-1 text-base"
                        style={{
                          color: s.done ? "var(--muted)" : "var(--fg)",
                          textDecoration: s.done ? "line-through" : undefined,
                        }}
                      >
                        {s.title}
                      </span>
                      <button
                        onClick={() => void removeSubtask(task, s.id)}
                        className="label underline underline-offset-4"
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  <div className="mt-2 flex gap-3">
                    <input
                      value={subtaskDraft[task.id] ?? ""}
                      onChange={(e) =>
                        setSubtaskDraft((d) => ({ ...d, [task.id]: e.target.value }))
                      }
                      onKeyDown={(e) => e.key === "Enter" && void addSubtask(task)}
                      placeholder="add sub-task"
                      autoCapitalize="none"
                      className="field flex-1 text-base"
                    />
                    <button
                      onClick={() => void addSubtask(task)}
                      disabled={!(subtaskDraft[task.id] ?? "").trim()}
                      className="btn-ghost"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div>
                  <p className="label mb-2">Bucket</p>
                  <select
                    value={task.done ? (task.prevListId ?? settings.defaultListId) : task.listId}
                    onChange={(e) => void rebucket(task, e.target.value)}
                    className="field text-base"
                  >
                    {lists
                      .filter((l) => !l.system)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                  {task.done && (
                    <p className="mt-2 text-sm text-[var(--fg-2)]">
                      Moving it out of Done marks it not done.
                    </p>
                  )}
                </div>

                <button onClick={() => void remove(task.id)} className="btn-ghost w-full">
                  Delete task
                </button>
              </div>
            )}

      </div>
    </div>
  );

  if (mounted && !splashDone) {
    return <Splash seconds={splashSeconds} onDone={() => setSplashDone(true)} />;
  }

  if (!mounted || gate === "loading") {
    return <main className="min-h-dvh bg-[var(--bg)]" />;
  }

  if (gate === "set" || gate === "locked") {
    return (
      <LockScreen
        mode={gate === "set" ? "set" : "unlock"}
        onSubmit={handleCode}
        onFaceId={settings.faceIdCredential ? () => void tryFaceId() : undefined}
        error={lockError}
      />
    );
  }

  return (
    <main
      className="min-h-dvh bg-[var(--bg)] pb-12"
      onTouchStart={inPlan ? undefined : onTouchStart}
      onTouchEnd={inPlan ? undefined : onTouchEnd}
    >
      <header className="sticky top-0 z-30 border-b border-[var(--rule)] bg-[var(--bg-95)] backdrop-blur">
        <div className="flex h-20 items-center justify-between px-6">
          {/* The mark doubles as the day-planner toggle. */}
          <h1 className="flex items-center">
            <button
              onClick={() => setPlanOpen((o) => !o)}
              aria-pressed={planOpen}
              aria-label={planOpen ? "Close the day plan" : "Open the day plan"}
              className="flex items-center rounded-[10px] px-2 py-1 transition-colors duration-300"
              style={{ background: planOpen ? "var(--accent)" : "transparent" }}
            >
              <Mark height={36} color={planOpen ? "var(--on-accent)" : "var(--fg)"} />
            </button>
            <span className="sr-only">swoosh</span>
          </h1>
          <div className="flex items-center gap-5">
            <span className="label hidden sm:inline">
              {headlineCount} {inDoneView ? "done" : "open"}
            </span>

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Menu"
                aria-expanded={menuOpen}
                className="flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors duration-300 hover:bg-[var(--hover)]"
              >
                <Gear />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-12 z-40 w-44 overflow-hidden rounded-[10px] border border-[var(--rule)] bg-[var(--bg)]">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowSettings(true);
                    }}
                    className="block w-full px-4 py-3 text-left text-sm font-semibold transition-colors duration-300 hover:bg-[var(--hover)]"
                  >
                    Settings
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      clearUnlocked();
                      setGate("locked");
                    }}
                    className="block w-full border-t border-[var(--rule)] px-4 py-3 text-left text-sm font-semibold transition-colors duration-300 hover:bg-[var(--hover)]"
                  >
                    Lock
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="no-bar flex gap-6 overflow-x-auto border-t border-[var(--rule)] px-6 py-4">
          {[{ id: "all", name: "All" }, ...lists].map((l) => {
            const active = activeList === l.id;
            return (
              <button
                key={l.id}
                onClick={() => {
                  setActiveList(l.id);
                  setPlanOpen(false);
                }}
                className="whitespace-nowrap text-[1.125rem] font-medium uppercase transition-colors duration-300"
                style={{
                  letterSpacing: "0.2em",
                  color: active ? "var(--accent)" : "var(--muted)",
                }}
              >
                {l.name}
              </button>
            );
          })}
        </div>
      </header>

      {!inPlan && (
      <section className="border-b border-[var(--rule)] px-6 py-10">
        <p className="section-title">{listName}</p>
        <h2 className="mt-4 text-6xl font-semibold leading-[0.85] tracking-[-0.04em] sm:text-7xl">
          {headlineCount === 0 ? (
            <>
              {inDoneView ? "Nothing" : "All"}
              <span style={{ color: "var(--accent)" }}>&nbsp;{inDoneView ? "yet" : "clear"}</span>
            </>
          ) : (
            <>
              {headlineCount}
              <span style={{ color: "var(--accent)" }}>
                &nbsp;{inDoneView ? "done" : "to go"}
              </span>
            </>
          )}
        </h2>

        <div className="mt-8 flex max-w-xl gap-3">
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submitQuick()}
            placeholder="add a task…"
            autoCapitalize="none"
            className="field flex-1"
          />
          <button onClick={() => void submitQuick()} disabled={!quick.trim()} className="btn-dark">
            Add
          </button>
          {/* Explicit square. The row stretches to the tallest item, so Add
              matches this height rather than the other way round. */}
          <button
            onClick={() => setShowVoice(true)}
            aria-label="Leave a voice note"
            className="btn-dark !flex h-14 w-14 shrink-0 items-center justify-center !p-0"
          >
            <Mic />
          </button>
        </div>
      </section>
      )}

      <section className={inPlan ? "" : "px-6"}>
        {inPlan ? (
          <DayPlanner
            embedded
            tasks={tasks}
            blocks={blocks}
            onSaveBlock={(b) => void saveBlock(b)}
            onDeleteBlock={(id) => void removeBlock(id)}
            onToggleTask={(t) => void toggle(t)}
          />
        ) : visible.length === 0 ? (
          <p className="py-16 text-base text-[var(--fg-2)]">
            Nothing here yet. Add a task above, or leave a voice note.
          </p>
        ) : (
          <div className="border-t border-transparent">{visible.map(taskRow)}</div>
        )}

        {!inPlan && doneVisible.length > 0 && (
          <div className="py-8">
            <button onClick={() => void clearCompleted()} className="label underline underline-offset-4">
              Clear {doneVisible.length} completed
            </button>
          </div>
        )}
      </section>

      {showVoice && (
        <VoiceSheet
          lists={lists.filter((l) => !l.system)}
          settings={settings}
          onClose={() => setShowVoice(false)}
          onCommit={async (parsed, transcript) => {
            await addTasks(parsed, transcript, "voice");
            setShowVoice(false);
          }}
        />
      )}

      {showSettings && (
        <SettingsPanel
          lists={lists}
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaveSettings={(s) => void persistSettings(s)}
          onSaveList={async (l) => {
            await db.saveList(l);
            setLists((prev) => {
              const next = prev.some((p) => p.id === l.id)
                ? prev.map((p) => (p.id === l.id ? l : p))
                : [...prev, l];
              return next.sort((a, b) => a.order - b.order);
            });
          }}
          onDeleteList={async (id) => {
            const fallback = lists.find((l) => l.id !== id)?.id ?? "inbox";
            const moved = tasks.filter((t) => t.listId === id).map((t) => ({ ...t, listId: fallback }));
            await Promise.all(moved.map((t) => db.saveTask(t)));
            await db.deleteList(id);
            setTasks((prev) => prev.map((t) => (t.listId === id ? { ...t, listId: fallback } : t)));
            setLists((prev) => prev.filter((l) => l.id !== id));
            if (activeList === id) setActiveList("all");
            if (settings.defaultListId === id) void persistSettings({ ...settings, defaultListId: fallback });
          }}
          onReload={() => void load()}
        />
      )}
    </main>
  );
}
