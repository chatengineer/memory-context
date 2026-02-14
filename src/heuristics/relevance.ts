// src/heuristics/relevance.ts
// Advanced scoring for content selection used by the JITEngine.
// This implementation provides a deterministic relevance score based on token count
// and the presence of high‑priority keywords. It can be replaced with a more
// sophisticated model‑based scorer later.

/**
 * List of keywords that increase relevance when present.
 * The set can be extended as the plugin evolves.
 */
const HIGH_PRIORITY_KEYWORDS = [
  "decision",
  "important",
  "priority",
  "knowledge",
  "state",
  "anchor",
  "context",
  "preserve",
  "shift",
];

/**
 * Compute a relevance score for a given piece of content.
 * The score is a floating‑point number where higher means more relevant.
 *
 * Scoring strategy:
 *   1. Token count (longer content gets a baseline score).
 *   2. Bonus for each occurrence of a high‑priority keyword.
 *   3. Slight penalty for very short content (< 5 tokens) to avoid noise.
 */
export function computeRelevanceScore(content: string): number {
  if (!content) return 0;

  const tokens = content.split(/\s+/).filter(Boolean);
  const tokenCount = tokens.length;

  // Base score proportional to token count
  let score = tokenCount;

  // Keyword bonus
  const lower = content.toLowerCase();
  for (const kw of HIGH_PRIORITY_KEYWORDS) {
    const regex = new RegExp(`\\b${kw}\\b`, "gi");
    const matches = lower.match(regex);
    if (matches) {
      score += matches.length * 5; // each keyword occurrence adds 5 points
    }
  }

  // Penalty for very short snippets (likely noise)
  if (tokenCount < 5) {
    score *= 0.5;
  }

  return score;
}
