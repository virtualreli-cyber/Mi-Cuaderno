import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from '../../data/seedData';
import { hydrateWorkspace, sanitizeForRtdb } from '../../services/storage';
import type { ColumnEntity, TabEntity } from '../../types/gradebook';
import { cloneColumnBatch } from '../cloneHelpers';
import {
  findCopyConflicts,
  inspectTargetElementData,
  matchNames,
} from '../copyConflictEngine';
import {
  getCanonicalItemOrder,
  getTabDisplayOrder,
  moveItemInTab,
  stepColumnHorizontally,
  stepFolderHorizontally,
} from '../tabLayout';

function makeSampleTab(): TabEntity {
  return {
    id: 'tab-1',
    title: '1.ª Evaluación',
    color: '#DBEAFE',
    orderIndex: 0,
    folders: [
      {
        id: 'fld-a',
        title: 'Carpeta A',
        color: '#DCFCE7',
        orderIndex: 0,
        isCollapsed: false,
        summaryMode: 'ARITHMETIC_MEAN',
      },
      {
        id: 'fld-empty',
        title: 'Carpeta Vacía',
        color: '#EDE9FE',
        orderIndex: 1,
        isCollapsed: false,
        summaryMode: 'ARITHMETIC_MEAN',
      },
    ],
    columns: [
      {
        id: 'col-1',
        folderId: 'fld-a',
        title: 'Col 1',
        color: '#DCFCE7',
        width: 110,
        orderIndex: 0,
        type: 'NUMERIC',
        minValue: 0,
        maxValue: 10,
        decimals: 2,
        passThreshold: 5,
        colorMode: 'NONE',
      },
      {
        id: 'col-2',
        folderId: 'fld-a',
        title: 'Col 2',
        color: '#DCFCE7',
        width: 110,
        orderIndex: 1,
        type: 'NUMERIC',
        minValue: 0,
        maxValue: 10,
        decimals: 2,
        passThreshold: 5,
        colorMode: 'NONE',
      },
      {
        id: 'col-loose',
        folderId: null,
        title: 'Suelta',
        color: '#FEF9C3',
        width: 110,
        orderIndex: 2,
        type: 'NUMERIC',
        minValue: 0,
        maxValue: 10,
        decimals: 2,
        passThreshold: 5,
        colorMode: 'NONE',
      },
    ],
  };
}

describe('tabLayout engine', () => {
  it('renders empty expanded folders in getTabDisplayOrder', () => {
    const tab = makeSampleTab();
    const display = getTabDisplayOrder(tab);
    expect(display.map((i) => (i.kind === 'FOLDER' ? i.folder.id : i.col.id))).toEqual([
      'fld-a',
      'col-loose',
      'fld-empty',
    ]);
    const emptyEntry = display.find((i) => i.kind === 'FOLDER' && i.folder.id === 'fld-empty');
    expect(emptyEntry).toBeDefined();
    if (emptyEntry?.kind === 'FOLDER') {
      expect(emptyEntry.childCols).toHaveLength(0);
    }
  });

  it('moves an entire folder past standalone columns and other folders', () => {
    let tab = makeSampleTab();
    tab = moveItemInTab(
      tab,
      { kind: 'FOLDER', id: 'fld-a' },
      { kind: 'COL', id: 'col-loose', position: 'AFTER' }
    );
    expect(getCanonicalItemOrder(tab)).toEqual(['col-loose', 'fld-a', 'fld-empty']);

    tab = stepFolderHorizontally(tab, 'fld-empty', 'LEFT');
    expect(getCanonicalItemOrder(tab)).toEqual(['col-loose', 'fld-empty', 'fld-a']);
  });

  it('moves a column OUT of a folder onto a standalone column or END_OUTSIDE', () => {
    let tab = makeSampleTab();
    // Drag col-1 from fld-a onto col-loose (BEFORE) -> pulls col-1 out of fld-a
    tab = moveItemInTab(
      tab,
      { kind: 'COL', id: 'col-1' },
      { kind: 'COL', id: 'col-loose', position: 'BEFORE' }
    );
    expect(tab.columns.find((c) => c.id === 'col-1')?.folderId).toBeNull();
    expect(getCanonicalItemOrder(tab)).toEqual(['fld-a', 'col-1', 'col-loose', 'fld-empty']);

    // Drag col-2 (the last remaining col in fld-a) to END_OUTSIDE -> pulls it out even with no other targets
    tab = moveItemInTab(tab, { kind: 'COL', id: 'col-2' }, { kind: 'END_OUTSIDE' });
    expect(tab.columns.find((c) => c.id === 'col-2')?.folderId).toBeNull();
    expect(getCanonicalItemOrder(tab)).toEqual([
      'fld-a',
      'col-1',
      'col-loose',
      'fld-empty',
      'col-2',
    ]);
  });

  it('steps a column out of a folder when moving past the folder edge', () => {
    let tab = makeSampleTab();
    // col-1 is first in fld-a; stepping LEFT pulls it out before fld-a
    tab = stepColumnHorizontally(tab, 'col-1', 'LEFT');
    expect(tab.columns.find((c) => c.id === 'col-1')?.folderId).toBeNull();
    expect(getCanonicalItemOrder(tab)).toEqual(['col-1', 'fld-a', 'col-loose', 'fld-empty']);
  });

  it('moves a standalone column INTO an empty folder', () => {
    let tab = makeSampleTab();
    tab = moveItemInTab(
      tab,
      { kind: 'COL', id: 'col-loose' },
      { kind: 'FOLDER', id: 'fld-empty', position: 'INSIDE' }
    );
    expect(tab.columns.find((c) => c.id === 'col-loose')?.folderId).toBe('fld-empty');
    expect(getCanonicalItemOrder(tab)).toEqual(['fld-a', 'fld-empty']);
  });
});

describe('copyConflictEngine', () => {
  it('matches exact and similar names while avoiding false positives on numbered items', () => {
    expect(matchNames('1.ª Evaluación', '1ª Evaluacion').matchType).toBe('EXACT');
    expect(matchNames('1.ª Evaluación', '2.ª Evaluación').matched).toBe(false);
    expect(matchNames('Actividad 1', 'Actividad 2').matched).toBe(false);
    expect(matchNames('Cuaderno', 'Cuaderno y Tareas').matchType).toBe('SIMILAR');
    expect(matchNames('Comentario Texto', 'Comentario de Texto').matchType).toBe('SIMILAR');
    expect(matchNames('Trabajo Diario', 'Pruebas y Oral').matched).toBe(false);
  });

  it('detects conflicts and student grade counts for columns, folders, and tabs', () => {
    const ws = createSeedWorkspace();
    const cls = ws.classes[0]; // 3.º ESO A
    const tab1 = cls.tabs[0];

    // Column conflict with grades
    const colMatches = findCopyConflicts(cls, 'COLUMN', 'Cuaderno y Tareas', tab1.id);
    expect(colMatches.length).toBeGreaterThan(0);
    expect(colMatches[0].matchType).toBe('EXACT');
    expect(colMatches[0].dataSummary.hasStudentData).toBe(true);
    expect(colMatches[0].dataSummary.gradesCount).toBeGreaterThan(0);

    // Folder conflict aggregating child columns
    const fldMatches = findCopyConflicts(cls, 'FOLDER', 'Trabajo Diario', tab1.id);
    expect(fldMatches.length).toBe(1);
    expect(fldMatches[0].dataSummary.hasStudentData).toBe(true);
    expect(fldMatches[0].dataSummary.affectedStudents).toBeGreaterThan(0);

    // Tab conflict aggregating all columns in tab
    const tabMatches = findCopyConflicts(cls, 'TAB', '1ª Evaluacion');
    expect(tabMatches.length).toBe(1);
    expect(tabMatches[0].dataSummary.hasStudentData).toBe(true);

    // Non-existent tab -> 0 conflicts
    expect(findCopyConflicts(cls, 'TAB', '3.ª Evaluación')).toHaveLength(0);

    // Empty column data inspection
    const emptyCheck = inspectTargetElementData(cls, 'COLUMN', 'non-existent-col', tab1.id);
    expect(emptyCheck.hasStudentData).toBe(false);

    // Same-tab copy skips self-conflict when excludeId is provided
    const firstCol = tab1.columns[0];
    const withoutExclude = findCopyConflicts(cls, 'COLUMN', firstCol.title, tab1.id);
    expect(withoutExclude.some((m) => m.id === firstCol.id)).toBe(true);
    const withExclude = findCopyConflicts(cls, 'COLUMN', firstCol.title, tab1.id, firstCol.id);
    expect(withExclude.some((m) => m.id === firstCol.id)).toBe(false);
  });
});

describe('RTDB serialization & hydration', () => {
  it('reconstructs arrays and nested structures stripped by Firebase RTDB', () => {
    const ws = createSeedWorkspace();
    const sanitized = sanitizeForRtdb(ws);
    // Simulate RTDB dropping empty arrays/objects (e.g., folders: [], tags: [], cells: {})
    const simulatedRtdb = JSON.parse(JSON.stringify(sanitized));
    delete simulatedRtdb.classes[1].tabs[0].folders;
    delete simulatedRtdb.classes[0].students[1].tags;
    delete simulatedRtdb.templates[1].cells;

    const hydrated = hydrateWorkspace(simulatedRtdb);
    expect(hydrated).not.toBeNull();
    expect(hydrated!.classes[1].tabs[0].folders).toEqual([]);
    expect(hydrated!.classes[0].students[1].tags).toEqual([]);
    expect(hydrated!.templates[1].cells).toEqual({});
    expect(hydrated!.classes[0].tabs[0].columns.length).toBeGreaterThan(0);
  });

  it('preserves student row fill color through RTDB sanitize and hydrate roundtrip', () => {
    const ws = createSeedWorkspace();
    ws.classes[0].students[0].color = '#FEF08A';
    const sanitized = sanitizeForRtdb(ws);
    const hydrated = hydrateWorkspace(JSON.parse(JSON.stringify(sanitized)));
    expect(hydrated).not.toBeNull();
    expect(hydrated!.classes[0].students[0].color).toBe('#FEF08A');
  });
});

describe('cloneColumnBatch', () => {
  it('clones multiple columns, clears educamos tracking, and remaps internal AVERAGE references', () => {
    const srcCols: ColumnEntity[] = [
      {
        id: 'c-1',
        folderId: 'fld-old',
        title: 'Examen 1',
        color: '#DBEAFE',
        width: 100,
        orderIndex: 0,
        type: 'NUMERIC',
        minValue: 0,
        maxValue: 10,
        decimals: 2,
        passThreshold: 5,
        colorMode: 'CELL_BG',
        educamos: { status: 'DONE', snapshot: { st1: 8 } },
      },
      {
        id: 'c-2',
        folderId: null,
        title: 'Trabajo 1',
        color: '#D1FAE5',
        width: 100,
        orderIndex: 1,
        type: 'NUMERIC',
        minValue: 0,
        maxValue: 10,
        decimals: 2,
        passThreshold: 5,
        colorMode: 'CELL_BG',
      },
      {
        id: 'c-avg',
        folderId: null,
        title: 'Media Bloque',
        color: '#FEF9C3',
        width: 100,
        orderIndex: 2,
        type: 'AVERAGE',
        minValue: 0,
        maxValue: 10,
        decimals: 2,
        passThreshold: 5,
        colorMode: 'CELL_BG',
        averageConfig: {
          sourceColumnIds: ['c-1', 'c-2', 'external-col'],
          weights: { 'c-1': 50, 'c-2': 30, 'external-col': 20 },
          ignoreEmpty: true,
        },
      },
    ];

    const cloned = cloneColumnBatch(srcCols, 5, 'fld-target');
    expect(cloned).toHaveLength(3);
    expect(cloned[0].id).not.toBe('c-1');
    expect(cloned[1].id).not.toBe('c-2');
    expect(cloned[2].id).not.toBe('c-avg');
    expect(cloned.map((c) => c.folderId)).toEqual(['fld-target', 'fld-target', 'fld-target']);
    expect(cloned.map((c) => c.orderIndex)).toEqual([5, 6, 7]);
    expect(cloned[0].educamos).toBeUndefined();

    // Internal references remapped to new cloned IDs; external ref kept as-is
    expect(cloned[2].averageConfig?.sourceColumnIds).toEqual([
      cloned[0].id,
      cloned[1].id,
      'external-col',
    ]);
    expect(cloned[2].averageConfig?.weights).toEqual({
      [cloned[0].id]: 50,
      [cloned[1].id]: 30,
      'external-col': 20,
    });
  });
});

