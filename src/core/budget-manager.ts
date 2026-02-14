// src/core/budget-manager.ts
// Token budget manager – ensures 100% token window utilization (TARGET_UTILIZATION=1.0)

/**
 * Target utilization of the token window. 1.0 means fill the window completely.
 */
export const TARGET_UTILIZATION = 1.0;

/**
 * Maximum token window size. Adjust based on the model you use (e.g., 8192 for Gemini 1.5).
 */
export const MAX_TOKENS = 8192;

/**
 * BudgetManager – applies a token budget to a list of candidate strings.
 * It performs a greedy selection based on the order of the input (typically relevance‑sorted).
 */
export class BudgetManager {
  private targetUtil: number;
  private maxTokens: number;

  constructor(targetUtil: number = TARGET_UTILIZATION, maxTokens: number = MAX_TOKENS) {
    this.targetUtil = targetUtil;
    this.maxTokens = maxTokens;
  }

  /** Naïve token counter – splits on whitespace. */
  private tokenCount(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
  }

  /**
   * Apply the token budget to an ordered list of candidate contents.
   * Returns a subset that fits within the target utilization.
   */
  applyBudget(contents: string[]): string[] {
    const limit = Math.floor(this.maxTokens * this.targetUtil);
    const result: string[] = [];
    let used = 0;
    for (const c of contents) {
      const tokens = this.tokenCount(c);
      if (used + tokens <= limit) {
        result.push(c);
        used += tokens;
      } else {
        // If nothing has been added yet, truncate this content to fill the budget.
        if (result.length === 0) {
          const words = c.split(/\s+/).filter(Boolean);
          const truncated = words.slice(0, limit).join(" ");
          result.push(truncated);
          used = limit;
        }
        break;
      }
    }
    return result;
  }
}
