"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Block, Task } from "@/lib/types";

const START_HOUR = 6;
const END_HOUR = 23;
const PX_PER_MIN = 1.2; // 72px per hour — a 30-minute block still fits a line of text
const SNAP = 15;
const MIN_DURATION = 30;
const NEW_DURATION = 45;
const DAY_START = START_HOUR * 60;
const DAY_END = END_HOUR * 60;
const GRID_HEIGHT = (DAY_END - DAY_START) * PX_PER_MIN;

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const snap = (min: number) => Math.round(min / SNAP) * SNAP;
const clampStart = (min: number, duration: number) =>
  Math.max(DAY_START, Math.min(min, DAY_END - duration));

function timeLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

function headingFor(date: string): string {
  const today = dayKey(new Date());
  if (date === today) return "Today";
  if (date === shiftDate(today, 1)) return "Tomorrow";
  if (date === shiftDate(today, -1)) return "Yesterday";
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** What the pointer is currently doing. */
type Drag =
  | { kind: "move"; id: string; grabOffsetMin: number }
  | { kind: "resize"; id: string }
  | { kind: "new"; taskId?: string; title: string; duration: number; grabOffsetMin: number };

export default function DayPlanner({
  tasks,
  blocks,
  embedded = false,
  onClose,
  onSaveBlock,
  onDeleteBlock,
  onToggleTask,
}: {
  tasks: Task[];
  blocks: Block[];
  /** Rendered as a bucket inside the page rather than as a full-screen sheet. */
  embedded?: boolean;
  onClose?: () => void;
  onSaveBlock: (b: Block) => void;
  onDeleteBlock: (id: string) => void;
  onToggleTask: (task: Task) => void;
}) {
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Live geometry while dragging, so the DB isn't written on every frame. */
  const [ghost, setGhost] = useState<{ start: number; duration: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const ghostRef = useRef<{ start: number; duration: number } | null>(null);

  dragRef.current = drag;
  ghostRef.current = ghost;

  const dayBlocks = useMemo(
    () => blocks.filter((b) => b.date === date).sort((a, b) => a.start - b.start),
    [blocks, date],
  );

  const scheduledTaskIds = useMemo(
    () => new Set(dayBlocks.map((b) => b.taskId).filter(Boolean)),
    [dayBlocks],
  );

  /** Unscheduled open tasks, the ones planned for this day first. */
  const tray = useMemo(
    () =>
      tasks
        .filter((t) => !t.done && !scheduledTaskIds.has(t.id))
        .sort((a, b) => {
          const ap = a.plannedOn === date ? 0 : 1;
          const bp = b.plannedOn === date ? 0 : 1;
          return ap - bp || b.createdAt - a.createdAt;
        })
        .slice(0, 24),
    [tasks, scheduledTaskIds, date],
  );

  /** Pointer y -> minutes from midnight, snapped to the grid. */
  function minutesAt(clientY: number): number {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return DAY_START;
    return snap(DAY_START + (clientY - rect.top) / PX_PER_MIN);
  }

  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      const d = dragRef.current;
      if (!d) return;
      const at = minutesAt(e.clientY);

      if (d.kind === "resize") {
        const block = dayBlocks.find((b) => b.id === d.id);
        if (!block) return;
        const duration = Math.max(MIN_DURATION, snap(at - block.start));
        setGhost({ start: block.start, duration: Math.min(duration, DAY_END - block.start) });
        return;
      }

      const duration =
        d.kind === "new" ? d.duration : (dayBlocks.find((b) => b.id === d.id)?.duration ?? NEW_DURATION);
      // Snap after subtracting the grab offset: the offset itself is arbitrary,
      // so without this a block lands between grid lines (e.g. 8:07:30).
      setGhost({ start: clampStart(snap(at - d.grabOffsetMin), duration), duration });
    };

    const onUp = () => {
      const d = dragRef.current;
      const g = ghostRef.current;
      if (d && g) {
        if (d.kind === "new") {
          onSaveBlock({
            id: uid(),
            date,
            start: g.start,
            duration: g.duration,
            title: d.title,
            taskId: d.taskId,
          });
        } else {
          const block = dayBlocks.find((b) => b.id === d.id);
          if (block) onSaveBlock({ ...block, start: g.start, duration: g.duration });
        }
      }
      setDrag(null);
      setGhost(null);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, dayBlocks, date, onSaveBlock]);

  function startMove(e: React.PointerEvent, block: Block) {
    e.preventDefault();
    const grabOffsetMin = minutesAt(e.clientY) - block.start;
    setGhost({ start: block.start, duration: block.duration });
    setDrag({ kind: "move", id: block.id, grabOffsetMin });
  }

  function startResize(e: React.PointerEvent, block: Block) {
    e.preventDefault();
    e.stopPropagation();
    setGhost({ start: block.start, duration: block.duration });
    setDrag({ kind: "resize", id: block.id });
  }

  function startFromTray(e: React.PointerEvent, task: Task) {
    e.preventDefault();
    setGhost({ start: clampStart(minutesAt(e.clientY), NEW_DURATION), duration: NEW_DURATION });
    setDrag({
      kind: "new",
      taskId: task.id,
      title: task.title,
      duration: NEW_DURATION,
      grabOffsetMin: NEW_DURATION / 2,
    });
  }

  /** Standalone block: no task involved, ever. */
  function addFreeBlock() {
    const last = dayBlocks[dayBlocks.length - 1];
    const start = clampStart(last ? last.start + last.duration : 9 * 60, NEW_DURATION);
    const block: Block = { id: uid(), date, start, duration: NEW_DURATION, title: "" };
    onSaveBlock(block);
    setEditing(block.id);
  }

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const activeId = drag && drag.kind !== "new" ? drag.id : null;

  return (
    <div className={embedded ? "flex flex-col" : "fixed inset-0 z-50 flex flex-col bg-[var(--bg)]"}>
      {!embedded && (
        <header className="flex h-20 shrink-0 items-center justify-between border-b border-[var(--rule)] px-6">
          <p className="label">Plan</p>
          <button onClick={onClose} className="text-sm font-semibold underline underline-offset-4">
            Done
          </button>
        </header>
      )}

      <div className="flex shrink-0 items-center justify-between border-b border-[var(--rule)] px-6 py-4">
        <button onClick={() => setDate(shiftDate(date, -1))} className="label px-2">
          ←
        </button>
        <button onClick={() => setDate(dayKey(new Date()))} className="text-xl font-medium">
          {headingFor(date)}
        </button>
        <button onClick={() => setDate(shiftDate(date, 1))} className="label px-2">
          →
        </button>
      </div>

      {/* Tray: drag one of these onto the grid to schedule it. */}
      <div className="shrink-0 border-b border-[var(--rule)] px-6 py-3">
        <p className="label mb-2">Drag onto the day</p>
        {tray.length === 0 ? (
          <p className="py-2 text-sm text-[var(--fg-2)]">Everything open is scheduled.</p>
        ) : (
          <div className="no-bar flex gap-2 overflow-x-auto pb-1">
            {tray.map((t) => (
              <button
                key={t.id}
                onPointerDown={(e) => startFromTray(e, t)}
                style={{ touchAction: "none" }}
                className="max-w-[60vw] shrink-0 truncate rounded-[8px] border border-[var(--rule)] px-3 py-2 text-sm"
              >
                {t.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={embedded ? "" : "flex-1 overflow-y-auto"}>
        <div className="relative flex px-6 py-4">
          {/* Hour gutter */}
          <div className="w-14 shrink-0" style={{ height: GRID_HEIGHT }}>
            {hours.map((h) => (
              <div
                key={h}
                className="idx"
                style={{ height: 60 * PX_PER_MIN, transform: "translateY(-0.5em)" }}
              >
                {timeLabel(h * 60)}
              </div>
            ))}
          </div>

          {/* The grid itself */}
          <div
            ref={gridRef}
            className="relative flex-1 border-l border-[var(--rule)]"
            style={{ height: GRID_HEIGHT }}
          >
            {hours.map((h) => (
              <div
                key={h}
                className="absolute inset-x-0 border-t border-[var(--rule)]"
                style={{ top: (h * 60 - DAY_START) * PX_PER_MIN }}
              />
            ))}

            {dayBlocks.map((b) => {
              const isActive = activeId === b.id;
              const start = isActive && ghost ? ghost.start : b.start;
              const duration = isActive && ghost ? ghost.duration : b.duration;
              const task = b.taskId ? tasks.find((t) => t.id === b.taskId) : undefined;
              const done = task?.done ?? false;

              return (
                <div
                  key={b.id}
                  onPointerDown={(e) => startMove(e, b)}
                  style={{
                    position: "absolute",
                    top: (start - DAY_START) * PX_PER_MIN,
                    height: duration * PX_PER_MIN,
                    left: 8,
                    right: 0,
                    touchAction: "none",
                    opacity: isActive ? 0.85 : 1,
                    background: b.taskId ? "var(--accent)" : "transparent",
                    color: b.taskId ? "var(--on-accent)" : "var(--fg)",
                    borderColor: "var(--rule)",
                  }}
                  className="overflow-hidden rounded-[8px] border px-3 py-1"
                >
                  <div className="flex h-full items-start gap-2">
                    {task && (
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onToggleTask(task)}
                        aria-label={done ? "Mark as not done" : "Mark as done"}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[4px] border"
                        style={{
                          borderColor: "currentColor",
                          background: done ? "currentColor" : "transparent",
                        }}
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      {editing === b.id ? (
                        <input
                          autoFocus
                          defaultValue={b.title}
                          onPointerDown={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            onSaveBlock({ ...b, title: e.target.value.trim() || "block" });
                            setEditing(null);
                          }}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                          placeholder="what is this?"
                          autoCapitalize="none"
                          className="w-full border-none bg-transparent p-0 text-sm outline-none"
                        />
                      ) : (
                        <p
                          className="truncate text-sm leading-tight"
                          style={{ textDecoration: done ? "line-through" : undefined }}
                        >
                          {b.title || "untitled"}
                        </p>
                      )}
                      {duration >= 45 && (
                        <p className="mt-0.5 text-[0.65rem] leading-tight opacity-60">
                          {timeLabel(start)} – {timeLabel(start + duration)}
                        </p>
                      )}
                    </div>

                    {!b.taskId && (
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setEditing(b.id)}
                        aria-label="Rename block"
                        className="shrink-0 text-[0.7rem] opacity-60"
                      >
                        ✎
                      </button>
                    )}
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => onDeleteBlock(b.id)}
                      aria-label={b.taskId ? "Unschedule" : "Delete block"}
                      className="shrink-0 text-[0.8rem] leading-none opacity-60"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Thin edge strip, so resizing works at any block height. */}
                  <span
                    onPointerDown={(e) => startResize(e, b)}
                    style={{ touchAction: "none" }}
                    aria-label="Resize block"
                    className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                  />
                </div>
              );
            })}

            {/* Ghost for a task being dragged in from the tray */}
            {drag?.kind === "new" && ghost && (
              <div
                style={{
                  position: "absolute",
                  top: (ghost.start - DAY_START) * PX_PER_MIN,
                  height: ghost.duration * PX_PER_MIN,
                  left: 8,
                  right: 0,
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  opacity: 0.7,
                }}
                className="pointer-events-none overflow-hidden rounded-[8px] px-3 py-1 text-sm"
              >
                {drag.title}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-[var(--rule)] p-4 pb-8">
        <div className="flex gap-3">
          <button onClick={addFreeBlock} className="btn-ghost flex-1">
            Add block
          </button>
          <button
            onClick={() => dayBlocks.forEach((b) => onDeleteBlock(b.id))}
            disabled={dayBlocks.length === 0}
            className="btn-ghost flex-1"
          >
            Clear day
          </button>
        </div>
      </footer>
    </div>
  );
}
