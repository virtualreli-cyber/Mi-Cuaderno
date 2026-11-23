import { describe, expect, it } from 'vitest';
import { cellKey, type CellEntity, type ColumnEntity, type StudentEntity } from '../../types/gradebook';
import {
  createEducamosDoneTracking,
  getColumnEducamosSummary,
  getEducamosSnappedGrade,
  isCellOutdatedForEducamos,
  markEducamosCellSynced,
} from '../educamos';

const makeStudent = (id: string, lastName: string, firstName: string, isHidden = false): StudentEntity => ({
  id,
  firstName,
  lastName,
  tags: [],
  orderIndex: 0,
  isHidden,
});

const makeColumn = (overrides: Partial<ColumnEntity> = {}): ColumnEntity => ({
  id: 'col-1',
  folderId: null,
  title: 'Examen T1',
  color: '#ffffff',
  orderIndex: 0,
  type: 'NUMERIC',
  minValue: 0,
  maxValue: 10,
  passThreshold: 5,
  colorMode: 'NONE',
  decimals: 2,
  width: 80,
  ...overrides,
});

const makeCell = (grade: number | null, comment = ''): CellEntity => ({
  grade,
  comment,
});

describe('educamos tracking engine', () => {
  it('starts PENDING when educamos is undefined and never marks cells outdated', () => {
    const students = [makeStudent('s1', 'García', 'Ana'), makeStudent('s2', 'López', 'Luis')];
    const col = makeColumn();
    const cells: Record<string, CellEntity> = {
      [cellKey('s1', col.id)]: makeCell(8),
    };

    const summary = getColumnEducamosSummary(col, students, cells);
    expect(summary.state).toBe('PENDING');
    expect(summary.dirtyCount).toBe(0);
    expect(isCellOutdatedForEducamos(col, 's1', cells[cellKey('s1', col.id)])).toBe(false);
  });

  it('snapshots non-null rounded grades on DONE and omits null/hidden students for Firebase compatibility', () => {
    const students = [
      makeStudent('s1', 'García', 'Ana'),
      makeStudent('s2', 'López', 'Luis'),
      makeStudent('s3', 'Oculto', 'Pedro', true),
    ];
    const col = makeColumn({ decimals: 1 });
    const cells: Record<string, CellEntity> = {
      [cellKey('s1', col.id)]: makeCell(7.46),
      [cellKey('s2', col.id)]: makeCell(null),
      [cellKey('s3', col.id)]: makeCell(9),
    };

    const tracking = createEducamosDoneTracking(col, students, cells);
    expect(tracking.status).toBe('DONE');
    expect(tracking.snapshot).toEqual({ s1: 7.5 });

    const doneCol = makeColumn({ decimals: 1, educamos: tracking });
    const summary = getColumnEducamosSummary(doneCol, students, cells);
    expect(summary.state).toBe('SYNCED');
    expect(summary.dirtyCount).toBe(0);
    expect(getEducamosSnappedGrade(doneCol, 's2')).toBeNull();
  });

  it('detects outdated cells on modify/clear/insert and clears flag automatically if reverted', () => {
    const students = [makeStudent('s1', 'García', 'Ana'), makeStudent('s2', 'López', 'Luis')];
    const baseCol = makeColumn();
    const cells: Record<string, CellEntity> = {
      [cellKey('s1', baseCol.id)]: makeCell(7),
    };
    const doneCol = makeColumn({
      educamos: createEducamosDoneTracking(baseCol, students, cells),
    });

    // Edit s1 (7 -> 8.5) and fill previously empty s2 (null -> 6)
    cells[cellKey('s1', baseCol.id)] = makeCell(8.5);
    cells[cellKey('s2', baseCol.id)] = makeCell(6);

    const outdatedSummary = getColumnEducamosSummary(doneCol, students, cells);
    expect(outdatedSummary.state).toBe('OUTDATED');
    expect(outdatedSummary.dirtyCount).toBe(2);
    expect(outdatedSummary.dirtyStudents[0]).toMatchObject({
      previousGrade: 7,
      currentGrade: 8.5,
    });
    expect(outdatedSummary.dirtyStudents[1]).toMatchObject({
      previousGrade: null,
      currentGrade: 6,
    });

    // Reverting both back to snapshot clears outdated state automatically
    cells[cellKey('s1', baseCol.id)] = makeCell(7);
    delete cells[cellKey('s2', baseCol.id)];
    const revertedSummary = getColumnEducamosSummary(doneCol, students, cells);
    expect(revertedSummary.state).toBe('SYNCED');
    expect(revertedSummary.dirtyCount).toBe(0);
  });

  it('updates a single student cell individually without clearing other outdated cells', () => {
    const students = [makeStudent('s1', 'García', 'Ana'), makeStudent('s2', 'López', 'Luis')];
    const baseCol = makeColumn();
    const initialCells: Record<string, CellEntity> = {
      [cellKey('s1', baseCol.id)]: makeCell(6),
      [cellKey('s2', baseCol.id)]: makeCell(8),
    };
    const doneCol = makeColumn({
      educamos: createEducamosDoneTracking(baseCol, students, initialCells),
    });

    const editedCells: Record<string, CellEntity> = {
      [cellKey('s1', baseCol.id)]: makeCell(7.5),
      [cellKey('s2', baseCol.id)]: makeCell(null),
    };

    // Individually update only s1
    const afterS1 = makeColumn({
      educamos: markEducamosCellSynced(doneCol, 's1', editedCells[cellKey('s1', baseCol.id)]),
    });
    expect(isCellOutdatedForEducamos(afterS1, 's1', editedCells[cellKey('s1', baseCol.id)])).toBe(false);
    expect(isCellOutdatedForEducamos(afterS1, 's2', editedCells[cellKey('s2', baseCol.id)])).toBe(true);
    expect(getColumnEducamosSummary(afterS1, students, editedCells).state).toBe('OUTDATED');

    // Individually update cleared cell s2 -> snapshot key removed cleanly & column becomes SYNCED
    const afterS2 = makeColumn({
      educamos: markEducamosCellSynced(afterS1, 's2', editedCells[cellKey('s2', afterS1.id)]),
    });
    expect(afterS2.educamos?.snapshot).toEqual({ s1: 7.5 });
    expect(getColumnEducamosSummary(afterS2, students, editedCells).state).toBe('SYNCED');
  });

  it('respects decimal rounding tolerance and supports AVERAGE calculated columns', () => {
    const students = [makeStudent('s1', 'García', 'Ana')];
    const avgCol = makeColumn({ id: 'avg-1', type: 'AVERAGE', decimals: 2 });
    const cells: Record<string, CellEntity> = {
      [cellKey('s1', avgCol.id)]: makeCell(7.334),
    };
    const doneAvg = makeColumn({
      id: 'avg-1',
      type: 'AVERAGE',
      decimals: 2,
      educamos: createEducamosDoneTracking(avgCol, students, cells),
    });

    // Floating noise within 2 decimals stays synced
    expect(isCellOutdatedForEducamos(doneAvg, 's1', makeCell(7.331))).toBe(false);
    // Real change in recalculated average marks cell outdated
    expect(isCellOutdatedForEducamos(doneAvg, 's1', makeCell(7.5))).toBe(true);
  });
});
