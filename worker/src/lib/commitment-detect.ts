// Detects a customer saying when they're coming in, e.g. "I'll be there
// tomorrow at 12", so it can be surfaced as a real alert instead of
// sitting unread in a chat thread. Real ask, Ivan 2026-10-05: "when
// someone says ill be there tomorrow at 12, it needs to be shown as an
// alert." Works on whatever thread text already exists -- surface-
// agnostic on purpose, so it applies to WhatsApp today and to
// Facebook/Instagram/TikTok/etc the moment any of those are actually
// connected (see main.ts's /api/meta/status -- none are live yet as of
// this writing).
//
// Deliberately a cheap heuristic, not an LLM call: this runs over every
// thread on every /api/alerts poll, needs to be fast/free, and a false
// positive here just means a harmless extra alert a person glances at
// and dismisses -- not a real cost. A missed one is worse than a false
// one, so the day/time patterns below are intentionally broad.

const DAY_WORDS =
  /\b(today|tonight|tomorrow|tmrw|this (morning|afternoon|evening)|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?)\b/i;

const TIME_PATTERN = /\b(\d{1,2})(:\d{2})?\s*(am|pm)\b|\bnoon\b|\bmidnight\b/i;

// Commitment-ish verbs -- "I'll be there", "I'm coming", "I can come in",
// "on my way", "see you at", "I'll come by", "I'll stop by", "heading
// over". Broad on purpose (see comment above).
const COMMITMENT_PHRASE =
  /\b(i'?ll be there|i'?m coming|i can come|i'?ll come|on my way|see you|i'?ll stop by|heading over|i'?ll swing by|i'?ll pick.*up|coming (in|by|over))\b/i;

export interface DetectedCommitment {
  raw: string;
  day_phrase: string | null;
  time_phrase: string | null;
}

// Returns a match only when there's BOTH a day/time reference AND a
// commitment-shaped phrase -- "tomorrow at 12" alone could be a question
// ("are you open tomorrow at 12?"), so requiring the phrase too keeps the
// false-positive rate sane without needing real NLP.
export function detectCommitment(text: string): DetectedCommitment | null {
  if (!text) return null;
  const dayMatch = text.match(DAY_WORDS);
  const timeMatch = text.match(TIME_PATTERN);
  const phraseMatch = text.match(COMMITMENT_PHRASE);
  if (!(dayMatch || timeMatch) || !phraseMatch) return null;
  return {
    raw: text,
    day_phrase: dayMatch ? dayMatch[0] : null,
    time_phrase: timeMatch ? timeMatch[0] : null,
  };
}
