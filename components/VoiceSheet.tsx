"use client";

import { useEffect, useRef, useState } from "react";
import { localParse } from "@/lib/localParse";
import { Recorder, speechSupported, startDictation } from "@/lib/speech";
import { List, ParsedTask, Settings } from "@/lib/types";

type Stage = "idle" | "listening" | "thinking" | "review";

export default function VoiceSheet({
  lists,
  settings,
  onClose,
  onCommit,
}: {
  lists: List[];
  settings: Settings;
  onClose: () => void;
  onCommit: (tasks: ParsedTask[], transcript: string) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  /** Segments already closed off by the "New task" button. */
  const [parts, setParts] = useState<string[]>([]);
  const [draft, setDraft] = useState<ParsedTask[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const supported = speechSupported();

  useEffect(() => () => recorder.current?.stop(), []);

  function begin() {
    setMessage(null);
    setFinalText("");
    setInterim("");
    setParts([]);
    recorder.current = startDictation({
      onTranscript: (f, i) => {
        setFinalText(f);
        setInterim(i);
      },
      onError: (m) => {
        setMessage(m);
        setStage("idle");
      },
      onEnd: () => setInterim(""),
    });
    if (!recorder.current) {
      setMessage("Speech recognition isn't available in this browser. Type the note instead.");
      return;
    }
    setStage("listening");
  }

  /** Spoken separators become the same boundary the button inserts. */
  function normalize(text: string): string {
    return text
      .replace(/\b(?:new task|next task|new item|next item|next one)\b[,.]?/gi, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }

  const liveText = [...parts, `${finalText} ${interim}`.trim()].filter(Boolean).join("\n");

  /** Close the current segment and start the next one. */
  function markBoundary() {
    const current = `${finalText} ${interim}`.trim();
    if (current) setParts((p) => [...p, current]);
    recorder.current?.clear();
    setFinalText("");
    setInterim("");
  }

  async function process(raw: string) {
    const transcript = normalize(raw);
    if (!transcript) {
      setStage("idle");
      return;
    }
    setStage("thinking");

    const explicitBoundaries = transcript.includes("\n");

    const fallback = () => {
      setDraft(localParse(transcript, lists, settings.defaultListId, explicitBoundaries));
      setStage("review");
    };

    if (!settings.aiParsing) {
      fallback();
      return;
    }

    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          explicitBoundaries,
          lists: lists.map((l) => ({ id: l.id, name: l.name, keywords: l.keywords })),
          apiKey: settings.apiKey || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(`${body.error ?? "Parsing failed"} — sorted these locally instead.`);
        fallback();
        return;
      }

      const body = (await res.json()) as { tasks: ParsedTask[] };
      if (!body.tasks?.length) {
        setMessage("Nothing actionable found in that note.");
        setDraft([]);
        setStage("review");
        return;
      }
      setDraft(body.tasks);
      setStage("review");
    } catch {
      setMessage("Couldn't reach the parser — sorted these locally instead.");
      fallback();
    }
  }

  function stopAndProcess() {
    recorder.current?.stop();
    recorder.current = null;
    void process(liveText);
  }

  const update = (i: number, patch: Partial<ParsedTask>) =>
    setDraft((d) => d.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#e3e2de]">
      <header className="flex h-20 shrink-0 items-center justify-between border-b border-[#c7c7c7] px-6">
        <p className="label">Voice note</p>
        <button onClick={onClose} className="text-sm font-semibold underline underline-offset-4">
          Close
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        {message && (
          <p className="mb-6 border-l-2 border-[#141414] pl-4 text-sm text-[#444343]">{message}</p>
        )}

        {stage !== "review" && (
          <>
            <h2 className="text-5xl font-extrabold leading-[0.9] tracking-[-0.03em] sm:text-6xl">
              {stage === "listening" ? (
                <>
                  Listening<span style={{ color: "var(--accent)" }}>.</span>
                </>
              ) : stage === "thinking" ? (
                <>
                  Sorting<span style={{ color: "var(--accent)" }}>.</span>
                </>
              ) : (
                <>
                  Say it<span style={{ color: "var(--accent)" }}>.</span>
                </>
              )}
            </h2>

            {stage === "listening" && (
              <p className="label mt-4">
                {parts.length === 0
                  ? 'Tap "New task" between items, or just say "new task"'
                  : `${parts.length + 1} task${parts.length === 0 ? "" : "s"} so far`}
              </p>
            )}

            <textarea
              value={liveText}
              onChange={(e) => {
                setParts([]);
                setFinalText(e.target.value);
                setInterim("");
              }}
              placeholder={
                supported
                  ? 'Tap record, or type here. One task per line — say "new task" to start a new line.'
                  : "Speech recognition isn't supported here — type the note, one task per line."
              }
              className="field mt-8 min-h-48 resize-none text-lg leading-relaxed"
            />
          </>
        )}

        {stage === "review" && (
          <>
            <h2 className="text-5xl font-extrabold leading-[0.9] tracking-[-0.03em] sm:text-6xl">
              {draft.length} task{draft.length === 1 ? "" : "s"}
            </h2>
            <p className="mt-4 max-w-md text-base text-[#444343]">
              Adjust anything before it lands. Removing a row drops just that task.
            </p>

            <div className="mt-10 border-t border-[#c7c7c7]">
              {draft.map((t, i) => (
                <div key={i} className="border-b border-[#c7c7c7] py-6">
                  <div className="flex items-start gap-4">
                    <span className="idx mt-2 shrink-0">{String(i + 1).padStart(3, "0")}</span>
                    <div className="flex-1">
                      <input
                        value={t.title}
                        onChange={(e) => update(i, { title: e.target.value })}
                        className="w-full border-none bg-transparent p-0 text-2xl font-bold leading-tight tracking-[-0.02em] outline-none"
                      />
                      {t.note && <p className="mt-2 text-sm text-[#444343]">{t.note}</p>}

                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <select
                          value={t.listId}
                          onChange={(e) => update(i, { listId: e.target.value })}
                          className="rounded-[8px] border border-[#c7c7c7] bg-transparent px-3 py-2 text-xs font-bold uppercase tracking-[0.15em] text-[#444343]"
                        >
                          {lists.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>

                        <input
                          type="date"
                          value={t.due ?? ""}
                          onChange={(e) => update(i, { due: e.target.value || undefined })}
                          className="rounded-[8px] border border-[#c7c7c7] bg-transparent px-3 py-2 text-xs text-[#444343]"
                        />

                        <button
                          onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                          className="ml-auto text-xs font-bold uppercase tracking-[0.15em] text-[#7a7a7a] underline underline-offset-4"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="shrink-0 border-t border-[#c7c7c7] p-6">
        {stage === "idle" && (
          <div className="flex gap-3">
            {supported && (
              <button onClick={begin} className="btn-primary flex-1">
                Record
              </button>
            )}
            <button
              onClick={() => void process(liveText)}
              disabled={!finalText.trim()}
              className={supported ? "btn-ghost flex-1" : "btn-primary flex-1"}
            >
              Sort it
            </button>
          </div>
        )}

        {stage === "listening" && (
          <div className="flex gap-3">
            <button onClick={markBoundary} className="btn-ghost flex-1">
              New task
            </button>
            <button onClick={stopAndProcess} className="btn-dark flex-1">
              Stop &amp; sort
            </button>
          </div>
        )}

        {stage === "thinking" && (
          <button disabled className="btn-primary w-full">
            Working…
          </button>
        )}

        {stage === "review" && (
          <div className="flex gap-3">
            <button onClick={() => setStage("idle")} className="btn-ghost flex-1">
              Back
            </button>
            <button
              onClick={() => onCommit(draft, finalText.trim())}
              disabled={draft.length === 0}
              className="btn-primary flex-1"
            >
              Add {draft.length}
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
