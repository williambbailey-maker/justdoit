/**
 * Thin wrapper over the Web Speech API. Chrome and Safari (incl. iOS 15+)
 * expose it as webkitSpeechRecognition; Firefox has no support.
 */

type Ctor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function ctor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => ctor() !== null;

export interface Recorder {
  stop(): void;
  /** Drop the accumulated text so the next results start a fresh segment. */
  clear(): void;
}

export function startDictation(handlers: {
  onTranscript: (final: string, interim: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}): Recorder | null {
  const C = ctor();
  if (!C) return null;

  const rec = new C();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || "en-US";

  let final = "";
  let stopped = false;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += chunk;
      else interim += chunk;
    }
    handlers.onTranscript(final.trim(), interim.trim());
  };

  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    handlers.onError(
      e.error === "not-allowed"
        ? "Microphone permission denied."
        : `Speech recognition error: ${e.error}`,
    );
  };

  rec.onend = () => {
    // Chrome ends the session on silence; restart until the user taps stop.
    if (stopped) {
      handlers.onEnd();
      return;
    }
    try {
      rec.start();
    } catch {
      handlers.onEnd();
    }
  };

  rec.start();

  return {
    stop() {
      stopped = true;
      rec.stop();
    },
    clear() {
      final = "";
    },
  };
}
