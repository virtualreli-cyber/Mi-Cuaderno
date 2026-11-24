import { describe, expect, it } from 'vitest';
import { drawNextFromCycle } from '../randomPicker';

describe('randomPicker', () => {
  it('draws every student once without repeats before starting a new round', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const seenFirstRound: string[] = [];
    let remaining: string[] | undefined;
    let lastId: string | undefined;

    for (let i = 0; i < 3; i++) {
      const res = drawNextFromCycle(items, remaining, lastId, () => 0);
      expect(res).not.toBeNull();
      seenFirstRound.push(res!.picked.id);
      remaining = res!.remainingIds;
      lastId = res!.picked.id;
      expect(res!.positionInCycle).toBe(i + 1);
      expect(res!.cycleTotal).toBe(3);
    }

    expect(new Set(seenFirstRound).size).toBe(3);
    expect(remaining).toEqual([]);

    // 4th draw starts a new cycle and avoids repeating the immediate last item (`c`)
    const nextRoundFirst = drawNextFromCycle(items, remaining, lastId, () => 0);
    expect(nextRoundFirst).not.toBeNull();
    expect(nextRoundFirst!.startedNewCycle).toBe(true);
    expect(nextRoundFirst!.picked.id).not.toBe(lastId);
    expect(nextRoundFirst!.positionInCycle).toBe(1);
    expect(nextRoundFirst!.remainingIds).toHaveLength(2);
    expect(nextRoundFirst!.remainingIds).toContain(lastId);
  });

  it('returns null when empty and handles single item gracefully', () => {
    expect(drawNextFromCycle([], undefined)).toBeNull();
    const single = drawNextFromCycle([{ id: 'only' }], [], 'only');
    expect(single?.picked.id).toBe('only');
    expect(single?.remainingIds).toEqual([]);
  });

  it('prunes removed items cleanly from remaining deck', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const res = drawNextFromCycle(items, ['deleted', 'b'], 'a', () => 0);
    expect(res?.picked.id).toBe('b');
    expect(res?.remainingIds).toEqual([]);
  });
});
