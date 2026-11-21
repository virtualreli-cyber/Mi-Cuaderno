import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from '../../data/seedData';
import { cellKey } from '../../types/gradebook';
import {
  applyAspectSnapshot,
  captureAspectSnapshot,
  findFirstChangedCellTarget,
  isAspectBookPatch,
  isAspectSettingsPatch,
  preserveCurrentAspectOnDataUndo,
  resolveBookIdAndTabIdForColumn,
} from '../undoHelpers';

describe('undoHelpers — Data Undo vs Aspect Undo separation & undone cell targeting', () => {
  it('classifies aspect settings and aspect book patches without capturing navigation or data patches', () => {
    expect(isAspectSettingsPatch({ gridZoom: 1.3 })).toBe(true);
    expect(isAspectSettingsPatch({ rowHeight: 54, textFontSize: 15 })).toBe(true);
    expect(isAspectSettingsPatch({ sidebarVisible: false })).toBe(false);
    expect(isAspectSettingsPatch({ collapsedSchools: { Ribarroja: true } })).toBe(false);

    expect(isAspectBookPatch({ groupSpacerRows: 2 })).toBe(true);
    expect(isAspectBookPatch({ showLomloeRow: false })).toBe(true);
    expect(isAspectBookPatch({ name: '3 ESO B' })).toBe(false);
    expect(isAspectBookPatch({})).toBe(false);
  });

  it('preserves current aspect settings & column/folder widths when executing Data Undo', () => {
    const wsAtEdit = createSeedWorkspace();
    const cls0 = wsAtEdit.classes[0];
    const tab0 = cls0.tabs[0];
    const st0 = cls0.students[0];
    const col0 = tab0.columns[0];
    const fld0 = tab0.folders[0];
    const originalGrade = cls0.cells[cellKey(st0.id, col0.id)]?.grade ?? null;

    // Simulate user making a grade edit, THEN changing zoom, rowHeight, col width, and folder width
    const currentWs = structuredClone(wsAtEdit);
    currentWs.classes[0].cells[cellKey(st0.id, col0.id)] = {
      grade: 9.25,
      comment: 'Excelente',
    };
    currentWs.settings.gridZoom = 1.4;
    currentWs.settings.rowHeight = 64;
    currentWs.settings.headerHeight = 112;
    currentWs.settings.sidebarVisible = false;
    currentWs.classes[0].tabs[0].columns[0].width = 165;
    if (fld0) {
      currentWs.classes[0].tabs[0].folders[0].width = 104;
    }
    currentWs.classes[0].groupSpacerRows = 3;

    // Data Undo restores wsAtEdit data while keeping ALL current aspect settings & widths
    const undone = preserveCurrentAspectOnDataUndo(wsAtEdit, currentWs);

    expect(undone.classes[0].cells[cellKey(st0.id, col0.id)]?.grade ?? null).toBe(originalGrade);
    expect(undone.settings.gridZoom).toBe(1.4);
    expect(undone.settings.rowHeight).toBe(64);
    expect(undone.settings.headerHeight).toBe(112);
    expect(undone.settings.sidebarVisible).toBe(false);
    expect(undone.classes[0].tabs[0].columns[0].width).toBe(165);
    if (fld0) {
      expect(undone.classes[0].tabs[0].folders[0].width).toBe(104);
    }
    expect(undone.classes[0].groupSpacerRows).toBe(3);

    // Separate Aspect Undo restores aspect back without altering current cell data
    const aspectBefore = captureAspectSnapshot(wsAtEdit);
    const aspectReverted = applyAspectSnapshot(currentWs, aspectBefore);
    expect(aspectReverted.settings.gridZoom).toBe(wsAtEdit.settings.gridZoom);
    expect(aspectReverted.settings.rowHeight).toBe(wsAtEdit.settings.rowHeight);
    expect(aspectReverted.classes[0].tabs[0].columns[0].width).toBe(col0.width);
    expect(aspectReverted.classes[0].cells[cellKey(st0.id, col0.id)]?.grade).toBe(9.25);
  });

  it('locates the exact undone cell and resolves its bookId/tabId', () => {
    const base = createSeedWorkspace();
    const cls = base.classes[0];
    const tab = cls.tabs[0];
    const st = cls.students[1] ?? cls.students[0];
    const col = tab.columns[1] ?? tab.columns[0];

    const modified = structuredClone(base);
    modified.classes[0].cells[cellKey(st.id, col.id)] = {
      grade: 8.5,
      comment: 'Muy buen trabajo',
    };

    const resolved = resolveBookIdAndTabIdForColumn(modified, col.id);
    expect(resolved).toEqual({ bookId: cls.id, tabId: tab.id });

    const diffTarget = findFirstChangedCellTarget(modified, base);
    expect(diffTarget).toEqual({
      bookId: cls.id,
      tabId: tab.id,
      studentId: st.id,
      columnId: col.id,
    });
  });
});
