export interface RandomDeckDrawResult<T> {
  picked: T;
  remainingIds: string[];
  positionInCycle: number;
  cycleTotal: number;
  startedNewCycle: boolean;
}

/**
 * Draws one item uniformly at random without replacement until every item in `items`
 * has been drawn once (completing a full round). Once the deck is empty, a fresh
 * round starts automatically; if at least 2 items exist, avoids picking `lastPickedId`
 * twice back-to-back across round boundaries while keeping it in the new round.
 */
export function drawNextFromCycle<T extends { id: string }>(
  items: T[],
  currentRemainingIds: string[] | undefined,
  lastPickedId?: string,
  rng: () => number = Math.random
): RandomDeckDrawResult<T> | null {
  if (items.length === 0) return null;

  const byId = new Map(items.map((item) => [item.id, item]));
  const filteredRemaining = (currentRemainingIds ?? []).filter((id) => byId.has(id));
  const seenValidSet = new Set(filteredRemaining);

  let workingRemaining = filteredRemaining.filter((id, idx) => filteredRemaining.indexOf(id) === idx);
  let startedNewCycle = false;

  if (workingRemaining.length === 0 || seenValidSet.size === 0) {
    workingRemaining = items.map((item) => item.id);
    startedNewCycle = true;
  }

  let candidatePool = workingRemaining;
  if (
    startedNewCycle &&
    lastPickedId &&
    workingRemaining.length > 1 &&
    workingRemaining.includes(lastPickedId)
  ) {
    candidatePool = workingRemaining.filter((id) => id !== lastPickedId);
  }

  const rawIdx = Math.floor(rng() * candidatePool.length);
  const clampedIdx = Math.max(0, Math.min(candidatePool.length - 1, rawIdx));
  const pickedId = candidatePool[clampedIdx];
  const picked = byId.get(pickedId)!;
  const remainingIds = workingRemaining.filter((id) => id !== pickedId);

  return {
    picked,
    remainingIds,
    positionInCycle: items.length - remainingIds.length,
    cycleTotal: items.length,
    startedNewCycle,
  };
}
