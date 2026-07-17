// Minimal fzf-style subsequence matcher. Scores reward contiguous runs and
// matches at word starts; null means the query is not a subsequence.
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) {
    return 0;
  }
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let textIndex = 0;
  let previousMatch = -2;
  for (const char of q) {
    const found = t.indexOf(char, textIndex);
    if (found < 0) {
      return null;
    }
    if (found === previousMatch + 1) {
      score += 5;
    }
    if (found === 0 || t[found - 1] === " " || t[found - 1] === "-" || t[found - 1] === "_") {
      score += 3;
    }
    score += 1;
    previousMatch = found;
    textIndex = found + 1;
  }
  // Light penalty for how spread out the match is.
  score -= Math.floor((previousMatch - (textIndex - q.length)) / 10);
  return score;
}

export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string): T[] {
  if (!query) {
    return items;
  }
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, text(item)) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
