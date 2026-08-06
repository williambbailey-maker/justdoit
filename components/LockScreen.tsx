"use client";

import { useEffect, useRef, useState } from "react";
import Mark from "@/components/Mark";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

export default function LockScreen({
  mode,
  onSubmit,
  error,
}: {
  /** "unlock" checks an existing code; "set" captures a new one twice. */
  mode: "unlock" | "set";
  onSubmit: (code: string) => void;
  error?: string;
}) {
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [mismatched, setMismatched] = useState(false);
  // onSubmit is async and changes identity as parent state settles; without
  // this guard the effect would re-fire on the same completed code.
  const submitted = useRef(false);

  useEffect(() => {
    if (code.length < 4) {
      submitted.current = false;
      return;
    }
    if (submitted.current) return;

    if (mode === "unlock") {
      submitted.current = true;
      onSubmit(code);
      setCode("");
      return;
    }

    if (confirm === null) {
      setConfirm(code);
      setCode("");
    } else if (confirm === code) {
      submitted.current = true;
      onSubmit(code);
    } else {
      setConfirm(null);
      setMismatched(true);
      setCode("");
    }
  }, [code, mode, confirm, onSubmit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) setCode((c) => (c.length < 4 ? c + e.key : c));
      if (e.key === "Backspace") setCode((c) => c.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const heading =
    mode === "set" ? (confirm === null ? "Set a code" : "Confirm it") : "Enter code";


  return (
    <main className="flex min-h-dvh flex-col justify-between bg-[var(--bg)] px-6 py-10">
      <div>
        <Mark height={18} />
      </div>

      <div className="flex flex-col items-center gap-10">
        <div className="text-center">
          <h1
            className="text-6xl font-semibold leading-[0.85] tracking-[-0.04em] sm:text-7xl"
            style={{ letterSpacing: "-0.04em" }}
          >
            {heading}
          </h1>
          <p className="mt-4 text-sm text-[var(--fg-2)]">
            {mode === "set"
              ? "Four digits. It stays on this device."
              : "Four digits to open your lists."}
          </p>
          {error && <p className="mt-3 text-sm font-semibold text-[var(--fg)]">{error}</p>}
        </div>

        <div className="flex gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-4 w-4 rounded-[4px] border border-[var(--fg)]"
              style={{ background: i < code.length ? "var(--accent)" : "transparent" }}
            />
          ))}
        </div>

        <div className="grid w-full max-w-xs grid-cols-3 overflow-hidden rounded-[14px] border-l border-t border-[var(--rule)]">
          {KEYS.map((k, i) =>
            k === "" ? (
              <div key={i} className="border-b border-r border-[var(--rule)]" />
            ) : (
              <button
                key={i}
                onClick={() =>
                  k === "del"
                    ? setCode((c) => c.slice(0, -1))
                    : setCode((c) => (c.length < 4 ? c + k : c))
                }
                className="border-b border-r border-[var(--rule)] py-5 text-2xl font-medium transition-colors duration-300 hover:bg-[var(--hover)] active:bg-[var(--hover)]"
              >
                {k === "del" ? "←" : k}
              </button>
            ),
          )}
        </div>
      </div>

      <p className="label text-center">{mismatched ? "Codes didn't match — try again" : "Private"}</p>
    </main>
  );
}
