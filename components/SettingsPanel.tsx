"use client";

import { useEffect, useRef, useState } from "react";
import { exportAll, importAll, wipeAll } from "@/lib/db";
import { hashCode } from "@/lib/lock";
import { FaceIdStatus, faceIdStatus, registerFaceId } from "@/lib/webauthn";
import { List, Settings } from "@/lib/types";

// Literal colours, not theme variables: these are stored as the accent value.
const ACCENTS = ["#1351AA", "#141414", "#A6431F", "#1F6B47", "#6B3FA0"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--rule)] py-6">
      <p className="label mb-3">{label}</p>
      {children}
    </div>
  );
}

export default function SettingsPanel({
  lists,
  settings,
  onClose,
  onSaveSettings,
  onSaveList,
  onDeleteList,
  onReload,
}: {
  lists: List[];
  settings: Settings;
  onClose: () => void;
  onSaveSettings: (s: Settings) => void;
  onSaveList: (l: List) => void;
  onDeleteList: (id: string) => void;
  onReload: () => void;
}) {
  const [newList, setNewList] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [faceId, setFaceId] = useState<FaceIdStatus | null>(null);

  useEffect(() => {
    void faceIdStatus().then(setFaceId);
  }, []);

  async function enrolFaceId() {
    setStatus("Asking for Face ID…");
    const result = await registerFaceId();
    if ("error" in result) {
      setStatus(`Face ID setup failed: ${result.error}`);
      return;
    }
    onSaveSettings({ ...settings, faceIdCredential: result.id });
    setStatus("Face ID is on.");
  }

  const patch = (p: Partial<Settings>) => onSaveSettings({ ...settings, ...p });

  async function download() {
    const data = await exportAll();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `swoosh-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Exported.");
  }

  async function upload(file: File) {
    try {
      await importAll(JSON.parse(await file.text()));
      onReload();
      setStatus("Imported.");
    } catch {
      setStatus("That file couldn't be read.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]">
      <header className="flex h-20 shrink-0 items-center justify-between border-b border-[var(--rule)] px-6">
        <p className="label">Settings</p>
        <button onClick={onClose} className="text-sm font-semibold underline underline-offset-4">
          Done
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-16">
        <h2 className="py-10 text-6xl font-semibold leading-[0.85] tracking-[-0.04em]">
          Make it<br />
          <span style={{ color: "var(--accent)" }}>yours</span>
        </h2>

        {status && <p className="mb-6 border-l-2 border-[var(--fg)] pl-4 text-sm text-[var(--fg-2)]">{status}</p>}

        <div className="border-t border-[var(--rule)]">
          <Row label="Lists">
            <div className="space-y-4">
              {lists.map((l) => (
                <div key={l.id} className="rounded-[10px] border border-[var(--rule)] p-4">
                  <div className="flex items-center gap-3">
                    <input
                      value={l.name}
                      onChange={(e) => onSaveList({ ...l, name: e.target.value })}
                      autoCapitalize="none"
                      className="flex-1 border-none bg-transparent p-0 text-xl font-medium outline-none"
                    />
                    {!l.system && lists.length > 1 && (
                      <button
                        onClick={() => onDeleteList(l.id)}
                        className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)] underline underline-offset-4"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <input
                    value={l.keywords.join(", ")}
                    onChange={(e) =>
                      onSaveList({
                        ...l,
                        keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                      })
                    }
                    placeholder="routing keywords, comma separated"
                    autoCapitalize="none"
                    className="mt-3 w-full border-none bg-transparent p-0 text-sm text-[var(--fg-2)] outline-none"
                  />
                </div>
              ))}

              <div className="flex gap-3">
                <input
                  value={newList}
                  onChange={(e) => setNewList(e.target.value)}
                  placeholder="new list name"
                  autoCapitalize="none"
                  className="field flex-1"
                />
                <button
                  onClick={() => {
                    const name = newList.trim();
                    if (!name) return;
                    onSaveList({
                      id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`,
                      name,
                      keywords: [],
                      order: lists.length,
                    });
                    setNewList("");
                  }}
                  className="btn-dark"
                >
                  Add
                </button>
              </div>
            </div>
          </Row>

          <Row label="Default list">
            <select
              value={settings.defaultListId}
              onChange={(e) => patch({ defaultListId: e.target.value })}
              className="field"
            >
              {lists.filter((l) => !l.system).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Theme">
            <select
              value={settings.theme}
              onChange={(e) => patch({ theme: e.target.value as Settings["theme"] })}
              className="field"
            >
              <option value="system">Match my device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Row>

          <Row label="Accent">
            <p className="mb-3 text-sm text-[var(--fg-2)]">
              Light mode only — dark mode stays black, white and grey.
            </p>
            <div className="flex gap-3">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  onClick={() => patch({ accent: c })}
                  aria-label={`Accent ${c}`}
                  className="h-10 w-10 rounded-[8px] border transition-transform duration-300"
                  style={{
                    background: c,
                    borderColor: settings.accent === c ? "var(--fg)" : "var(--rule)",
                    transform: settings.accent === c ? "scale(1.1)" : "none",
                  }}
                />
              ))}
            </div>
          </Row>

          <Row label="Voice parsing">
            <label className="flex items-center justify-between gap-4">
              <span className="text-base text-[var(--fg-2)]">
                Use Claude to split notes into tasks. Off means local keyword rules.
              </span>
              <input
                type="checkbox"
                checked={settings.aiParsing}
                onChange={(e) => patch({ aiParsing: e.target.checked })}
                className="h-6 w-6 shrink-0 accent-[var(--accent)]"
              />
            </label>
            <input
              type="password"
              value={settings.apiKey}
              onChange={(e) => patch({ apiKey: e.target.value })}
              placeholder="Anthropic API key (optional — server key is used first)"
              className="field mt-4"
            />
          </Row>

          <Row label="Transcripts">
            <label className="flex items-center justify-between gap-4">
              <span className="text-base text-[var(--fg-2)]">Keep the raw text of each voice note</span>
              <input
                type="checkbox"
                checked={settings.keepTranscripts}
                onChange={(e) => patch({ keepTranscripts: e.target.checked })}
                className="h-6 w-6 shrink-0 accent-[var(--accent)]"
              />
            </label>
          </Row>

          <Row label="Launch animation">
            <select
              value={settings.splashSeconds}
              onChange={(e) => patch({ splashSeconds: Number(e.target.value) })}
              className="field"
            >
              <option value={0}>Off — open straight to the code</option>
              <option value={2}>2 seconds</option>
              <option value={4}>4 seconds</option>
              <option value={6}>6 seconds</option>
            </select>
          </Row>

          <Row label="Auto-lock">
            <select
              value={settings.autoLockMinutes}
              onChange={(e) => patch({ autoLockMinutes: Number(e.target.value) })}
              className="field"
            >
              <option value={0}>Never (until the tab closes)</option>
              <option value={5}>After 5 minutes</option>
              <option value={60}>After 1 hour</option>
              <option value={1440}>After 1 day</option>
            </select>
          </Row>

          <Row label="Face ID">
            {faceId?.state === "blocked" ? (
              <p className="text-sm text-[var(--fg-2)]">Not available here: {faceId.reason}.</p>
            ) : settings.faceIdCredential ? (
              <>
                <p className="mb-3 text-sm text-[var(--fg-2)]">
                  On. Your code still works if Face ID fails.
                </p>
                <button
                  onClick={() => {
                    patch({ faceIdCredential: "" });
                    setStatus("Face ID turned off.");
                  }}
                  className="btn-ghost"
                >
                  Turn off Face ID
                </button>
              </>
            ) : (
              <>
                <p className="mb-3 text-sm text-[var(--fg-2)]">
                  {faceId?.state === "unlikely"
                    ? `${faceId.reason}. Worth trying anyway — if the prompt appears, it works.`
                    : "Unlock with your face instead of typing the code. Enrolment is per-device and never leaves it."}
                </p>
                <button onClick={enrolFaceId} className="btn-dark">
                  {faceId?.state === "unlikely" ? "Try Face ID anyway" : "Turn on Face ID"}
                </button>
              </>
            )}
          </Row>

          <Row label="Change code">
            <div className="flex gap-3">
              <input
                value={codeDraft}
                onChange={(e) => setCodeDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                placeholder="New 4-digit code"
                className="field flex-1"
              />
              <button
                onClick={async () => {
                  if (codeDraft.length !== 4) return;
                  patch({ codeHash: await hashCode(codeDraft) });
                  setCodeDraft("");
                  setStatus("Code updated.");
                }}
                disabled={codeDraft.length !== 4}
                className="btn-dark"
              >
                Save
              </button>
            </div>
          </Row>

          <Row label="Your data">
            <div className="flex flex-wrap gap-3">
              <button onClick={download} className="btn-ghost">
                Export JSON
              </button>
              <button onClick={() => fileRef.current?.click()} className="btn-ghost">
                Import
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={async () => {
                  if (!confirm("Erase every task, list, and note on this device?")) return;
                  await wipeAll();
                  onReload();
                  setStatus("Everything erased.");
                }}
                className="btn-ghost"
              >
                Erase all
              </button>
            </div>
            <p className="mt-4 text-sm text-[var(--fg-2)]">
              Data lives in this browser only. Export before clearing site data or switching devices.
            </p>
          </Row>

          <Row label="Build">
            <p className="text-sm text-[var(--fg-2)]">
              Running <span className="font-mono">{process.env.NEXT_PUBLIC_BUILD}</span>. If that
              doesn't match your latest deploy, tap below to clear the cached app.
            </p>
            <button
              onClick={async () => {
                if ("serviceWorker" in navigator) {
                  const regs = await navigator.serviceWorker.getRegistrations();
                  await Promise.all(regs.map((r) => r.unregister()));
                }
                if ("caches" in window) {
                  const keys = await caches.keys();
                  await Promise.all(keys.map((k) => caches.delete(k)));
                }
                window.location.reload();
              }}
              className="btn-ghost mt-4"
            >
              Force update
            </button>
          </Row>
        </div>
      </div>
    </div>
  );
}
