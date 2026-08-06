import { List, ParsedTask, Priority } from "./types";

const SPLIT = /(?:\.|;|\n|\band then\b|\balso\b|,\s*and\b|\band also\b)+/i;
const LEAD = /^(?:i need to|i have to|i should|remind me to|remember to|todo|to do|please|and|then|also)\s+/i;

/** Resolve a relative day word to YYYY-MM-DD in the caller's local timezone. */
function isoDay(offsetDays: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function extractDue(text: string): { due?: string; cleaned: string } {
  const lower = text.toLowerCase();

  if (/\btoday\b/.test(lower)) return { due: isoDay(0), cleaned: strip(text, /\btoday\b/i) };
  if (/\btomorrow\b/.test(lower)) return { due: isoDay(1), cleaned: strip(text, /\btomorrow\b/i) };
  if (/\btonight\b/.test(lower)) return { due: isoDay(0), cleaned: strip(text, /\btonight\b/i) };

  for (let i = 0; i < WEEKDAYS.length; i++) {
    const re = new RegExp(`\\b(?:on |next |this )?${WEEKDAYS[i]}\\b`, "i");
    if (re.test(lower)) {
      const today = new Date().getDay();
      const delta = (i - today + 7) % 7 || 7;
      return { due: isoDay(delta), cleaned: strip(text, re) };
    }
  }
  return { cleaned: text };
}

function strip(text: string, re: RegExp): string {
  return text.replace(re, " ").replace(/\s{2,}/g, " ").trim();
}

function extractPriority(text: string): { priority: Priority; cleaned: string } {
  const re = /\b(urgent|asap|important|high priority|top priority)\b/i;
  if (re.test(text)) return { priority: "high", cleaned: strip(text, re) };
  const low = /\b(some ?time|eventually|low priority|whenever)\b/i;
  if (low.test(text)) return { priority: "low", cleaned: strip(text, low) };
  return { priority: "none", cleaned: text };
}

function routeList(text: string, lists: List[], defaultListId: string): string {
  const lower = text.toLowerCase();
  for (const list of lists) {
    if (list.keywords.some((k) => k.trim() && lower.includes(k.trim().toLowerCase()))) return list.id;
  }
  return lists.some((l) => l.id === defaultListId) ? defaultListId : lists[0]?.id ?? "inbox";
}

/**
 * Rule-based transcript → tasks. Used when AI parsing is off or the API
 * route is unavailable, so a voice note is never lost.
 */
export function localParse(
  transcript: string,
  lists: List[],
  defaultListId: string,
  explicitBoundaries = false,
): ParsedTask[] {
  // When the speaker marked the breaks themselves, take them at their word —
  // guessing further would split "call the bank and the dentist" in two.
  const segments = explicitBoundaries ? transcript.split("\n") : transcript.split(SPLIT);

  return segments
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
    .map((segment) => {
      const withoutLead = segment.replace(LEAD, "");
      const { due, cleaned: afterDue } = extractDue(withoutLead);
      const { priority, cleaned } = extractPriority(afterDue);
      const title = cleaned.replace(/[.,;]+$/, "").trim();
      return {
        title: title.charAt(0).toUpperCase() + title.slice(1),
        listId: routeList(segment, lists, defaultListId),
        due,
        priority,
      };
    })
    .filter((t) => t.title.length > 0);
}
