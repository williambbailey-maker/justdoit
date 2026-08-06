"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LockScreen from "@/components/LockScreen";
import SettingsPanel from "@/components/SettingsPanel";
import Splash from "@/components/Splash";
import VoiceSheet from "@/components/VoiceSheet";
import * as db from "@/lib/db";
import { clearUnlocked, hashCode, isUnlocked, markUnlocked, touchUnlocked } from "@/lib/lock";
import { localParse } from "@/lib/localParse";
import { DEFAULT_SETTINGS, List, ParsedTask, Settings, Task } from "@/lib/types";

type Gate = "loading" | "set" | "locked" | "open";
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The splash length is mirrored to localStorage because it has to be known
 * synchronously on mount — well before IndexedDB settings finish loading.
 */
const SPLASH_KEY = "swoosh:splash-seconds";

function dueLabel(iso: string): string {
  const today = new Date();
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
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
  const [activeList, setActiveList] = useState<string>("all");
  const [quick, setQuick] = useState("");
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
    const [t, l, s] = await Promise.all([db.getTasks(), db.getLists(), db.getSettings()]);
    setTasks(t);
    setLists(l);
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

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", settings.accent);
  }, [settings.accent]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

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

  async function addTasks(parsed: ParsedTask[], transcript: string, source?: "voice") {
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
    const next: Task = {
      ...task,
      done: !task.done,
      completedAt: task.done ? undefined : Date.now(),
    };
    await db.saveTask(next);
    setTasks((prev) => prev.map((t) => (t.id === next.id ? next : t)));
  }

  async function remove(id: string) {
    await db.deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function submitQuick() {
    const text = quick.trim();
    if (!text) return;
    const target = activeList === "all" ? settings.defaultListId : activeList;
    const [parsed] = localParse(text, lists, target);
    await addTasks([{ ...(parsed ?? { title: text, listId: target }), listId: target }], "");
    setQuick("");
  }

  const visible = useMemo(() => {
    // Nothing is hidden here — done tasks drop to the bottom and stay until
    // they are explicitly deleted.
    return tasks
      .filter((t) => (activeList === "all" ? true : t.listId === activeList))
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
        if (a.due !== b.due) return a.due ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
  }, [tasks, activeList]);

  const openCount = tasks.filter((t) => !t.done).length;
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
  if (mounted && !splashDone) {
    return <Splash seconds={splashSeconds} onDone={() => setSplashDone(true)} />;
  }

  if (!mounted || gate === "loading") {
    return <main className="min-h-dvh bg-[#e3e2de]" />;
  }

  if (gate === "set" || gate === "locked") {
    return <LockScreen mode={gate === "set" ? "set" : "unlock"} onSubmit={handleCode} error={lockError} />;
  }

  return (
    <main className="min-h-dvh bg-[#e3e2de] pb-32">
      <header className="sticky top-0 z-30 border-b border-[#c7c7c7] bg-[#e3e2de]/95 backdrop-blur">
        <div className="flex h-20 items-center justify-between px-6">
          <h1 className="text-2xl font-extrabold lowercase tracking-[-0.03em]">swoosh</h1>
          <div className="flex items-center gap-5">
            <span className="label hidden sm:inline">
              {openCount} open
            </span>
            <button
              onClick={() => setShowSettings(true)}
              className="text-sm font-semibold underline underline-offset-4"
            >
              Settings
            </button>
            <button
              onClick={() => {
                clearUnlocked();
                setGate("locked");
              }}
              className="text-sm font-semibold underline underline-offset-4"
            >
              Lock
            </button>
          </div>
        </div>

        <div className="no-bar flex gap-6 overflow-x-auto border-t border-[#c7c7c7] px-6 py-4">
          {[{ id: "all", name: "All" }, ...lists].map((l) => {
            const active = activeList === l.id;
            return (
              <button
                key={l.id}
                onClick={() => setActiveList(l.id)}
                className="whitespace-nowrap text-xs font-bold uppercase transition-colors duration-300"
                style={{
                  letterSpacing: "0.2em",
                  color: active ? "var(--accent)" : "#7a7a7a",
                }}
              >
                {l.name}
              </button>
            );
          })}
        </div>
      </header>

      <section className="border-b border-[#c7c7c7] px-6 py-10">
        <p className="label">{listName}</p>
        <h2 className="mt-4 text-6xl font-extrabold leading-[0.85] tracking-[-0.04em] sm:text-7xl">
          {openCount === 0 ? (
            <>
              All<span style={{ color: "var(--accent)" }}>&nbsp;clear</span>
            </>
          ) : (
            <>
              {openCount}
              <span style={{ color: "var(--accent)" }}>&nbsp;to&nbsp;go</span>
            </>
          )}
        </h2>

        <div className="mt-8 flex max-w-xl gap-3">
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submitQuick()}
            placeholder="Add a task…"
            className="field flex-1"
          />
          <button onClick={() => void submitQuick()} disabled={!quick.trim()} className="btn-dark">
            Add
          </button>
        </div>
      </section>

      <section className="px-6">
        {visible.length === 0 ? (
          <p className="py-16 text-base text-[#444343]">
            Nothing here yet. Add a task above, or leave a voice note.
          </p>
        ) : (
          <div className="border-t border-transparent">
            {visible.map((task, i) => (
              <div key={task.id} className="group border-b border-[#c7c7c7] py-6">
                <div className="flex items-start gap-4">
                  <span className="idx mt-3 w-8 shrink-0">{String(i + 1).padStart(3, "0")}</span>

                  <button
                    onClick={() => void toggle(task)}
                    aria-label={task.done ? "Mark as not done" : "Mark as done"}
                    className="mt-2 h-5 w-5 shrink-0 border border-[#141414] transition-colors duration-300"
                    style={{ background: task.done ? "var(--accent)" : "transparent" }}
                  />

                  <div className="min-w-0 flex-1">
                    {/* Text only — completing is the checkbox's job, so a stray
                        tap on the title can't tick a task off. */}
                    <p
                      className="block w-full text-3xl font-bold leading-[1.05] tracking-[-0.02em] sm:text-4xl"
                      style={{
                        color: task.done ? "#7a7a7a" : undefined,
                        textDecoration: task.done ? "line-through" : undefined,
                      }}
                    >
                      {task.title}
                    </p>

                    {task.note && <p className="mt-2 text-sm text-[#444343]">{task.note}</p>}

                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <span className="label">
                        {lists.find((l) => l.id === task.listId)?.name ?? "Inbox"}
                      </span>
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
                        onClick={() => void remove(task.id)}
                        className="label ml-auto underline underline-offset-4"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {doneVisible.length > 0 && (
          <div className="py-8">
            <button onClick={() => void clearCompleted()} className="label underline underline-offset-4">
              Clear {doneVisible.length} completed
            </button>
          </div>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#c7c7c7] bg-[#e3e2de]/95 p-4 backdrop-blur">
        <button onClick={() => setShowVoice(true)} className="btn-primary w-full">
          Leave a voice note
        </button>
      </div>

      {showVoice && (
        <VoiceSheet
          lists={lists}
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
