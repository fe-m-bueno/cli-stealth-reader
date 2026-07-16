import { renderBlocks } from "./renderers.js";
import type { AppState } from "./types.js";

function getCurrentChapter(state: AppState) {
  if (!state.currentBook) {
    return null;
  }
  return state.currentBook.chapters[state.chapterIndex] ?? null;
}

export function getChapterBlockCount(state: AppState): number {
  return getCurrentChapter(state)?.blocks.length ?? 0;
}

export function getFocusBlockLineCounts(state: AppState, contentWidth: number): number[] {
  const chapter = getCurrentChapter(state);
  if (!chapter) {
    return [];
  }
  return chapter.blocks.map((block, blockIndex) => (
    renderBlocks(
      [block],
      state.renderMode,
      contentWidth,
      state.theme,
      state.codeLanguage,
      state.codeDensity,
      undefined,
      state.plainHighlight,
      blockIndex,
      true,
      state.lineSpacing
    ).length
  ));
}

export function clampFocusBlockIndex(state: AppState, index: number): number {
  const blockCount = getChapterBlockCount(state);
  if (blockCount <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(index, blockCount - 1));
}

export function mapFocusIndexToBlockOffset(state: AppState, contentWidth: number, focusBlockIndex: number): number {
  const counts = getFocusBlockLineCounts(state, contentWidth);
  if (counts.length === 0) {
    return 0;
  }
  const clampedIndex = Math.max(0, Math.min(focusBlockIndex, counts.length - 1));
  return counts.slice(0, clampedIndex).reduce((sum, count) => sum + count, 0);
}

export function mapBlockOffsetToFocusIndex(state: AppState, contentWidth: number, blockOffset: number): number {
  const counts = getFocusBlockLineCounts(state, contentWidth);
  if (counts.length === 0) {
    return 0;
  }
  const target = Math.max(0, blockOffset);
  let offsetCursor = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const next = offsetCursor + counts[index]!;
    if (target < next) {
      return index;
    }
    offsetCursor = next;
  }
  return counts.length - 1;
}

export function renderFocusBlock(state: AppState, contentWidth: number): string[] {
  const chapter = getCurrentChapter(state);
  if (!chapter || chapter.blocks.length === 0) {
    return [];
  }
  const index = clampFocusBlockIndex(state, state.focusBlockIndex);
  return renderBlocks(
    [chapter.blocks[index]!],
    state.renderMode,
    contentWidth,
    state.theme,
    state.codeLanguage,
    state.codeDensity,
    state.searchState?.query,
    state.plainHighlight,
    index,
    false,
    state.lineSpacing
  );
}
