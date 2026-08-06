"use client";

import { useEffect, useState } from "react";

/**
 * Launch animation: the mark spins against black, wordmark underneath,
 * then hands off to the app. Duration is set in Settings.
 */
export default function Splash({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Start the fade a beat before the handoff so the two overlap.
    const fade = setTimeout(() => setLeaving(true), Math.max(0, seconds * 1000 - 400));
    const done = setTimeout(onDone, seconds * 1000);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [seconds, onDone]);

  // Skip the spin for anyone who asked the OS to reduce motion.
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black"
      style={{
        opacity: leaving ? 0 : 1,
        transition: "opacity 0.4s linear",
      }}
      aria-hidden="true"
    >
      <div
        style={{
          // Fixed spin rate rather than one tied to the duration, so the mark
          // reads the same whether the splash runs 2 seconds or 6.
          animation: reduced ? undefined : "swoosh-spin 1.4s linear infinite",
          transformOrigin: "50% 50%",
        }}
      >
        <svg viewBox="0 0 24 24" width="260" height="260" fill="#ffffff" role="img">
          <title>swoosh</title>
          <path d="M24 7.8 6.442 15.276c-1.456.616-2.679.925-3.668.925-1.12 0-1.933-.392-2.437-1.177-.317-.504-.462-1.143-.434-1.918.028-.775.234-1.606.616-2.492.31-.72.837-1.63 1.583-2.729-.43.696-.734 1.36-.91 1.99-.174.63-.24 1.19-.196 1.68.045.49.196.9.455 1.23.26.33.62.55 1.08.66.46.11.98.11 1.56 0 .58-.11 1.22-.32 1.92-.63L24 7.8z" />
        </svg>
      </div>

      <p
        className="mt-10 text-4xl font-extrabold lowercase text-white"
        style={{ letterSpacing: "-0.04em" }}
      >
        just do it
      </p>

      <style>{`
        @keyframes swoosh-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
