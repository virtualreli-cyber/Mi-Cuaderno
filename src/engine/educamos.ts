import { roundTo } from './gradeMath';
import {
  cellKey,
  type CellEntity,
  type ColumnEntity,
  type EducamosColumnTracking,
  type StudentEntity,
} from '../types/gradebook';

export type EducamosColumnState = 'PENDING' | 'SYNCED' | 'OUTDATED';

export interface EducamosDirtyStudent {
  student: StudentEntity;
  previousGrade: number | null;
  currentGrade: number | null;
}

export interface EducamosColumnSummary {
  state: EducamosColumnState;
  dirtyStudents: EducamosDirtyStudent[];
  dirtyCount: number;
}

export function normalizeEducamosGrade(
  grade: number | null | undefined,
  decimals: number
): number | null {
  if (grade === null || grade === undefined || Number.isNaN(grade)) {
    return null;
  }
  return roundTo(grade, decimals);
}

export function getEducamosSnappedGrade(
  col: ColumnEntity,
  studentId: string
): number | null {
  if (col.educamos?.status !== 'DONE') return null;
  const raw = col.educamos.snapshot?.[studentId];
  return typeof raw === 'number' && Number.isFinite(raw)
    ? normalizeEducamosGrade(raw, col.decimals)
    : null;
}

export function isCellOutdatedForEducamos(
  col: ColumnEntity,
  studentId: string,
  cell: CellEntity | undefined
): boolean {
  if (col.educamos?.status !== 'DONE') return false;
  const snapped = getEducamosSnappedGrade(col, studentId);
  const current = normalizeEducamosGrade(cell?.grade ?? null, col.decimals);
  return snapped !== current;
}

export function getColumnEducamosSummary(
  col: ColumnEntity,
  students: StudentEntity[],
  cells: Record<string, CellEntity>
): EducamosColumnSummary {
  if (col.educamos?.status !== 'DONE') {
    return { state: 'PENDING', dirtyStudents: [], dirtyCount: 0 };
  }

  const dirtyStudents: EducamosDirtyStudent[] = [];
  for (const student of students) {
    if (student.isHidden) continue;
    const cell = cells[cellKey(student.id, col.id)];
    const previousGrade = getEducamosSnappedGrade(col, student.id);
    const currentGrade = normalizeEducamosGrade(cell?.grade ?? null, col.decimals);
    if (previousGrade !== currentGrade) {
      dirtyStudents.push({ student, previousGrade, currentGrade });
    }
  }

  return {
    state: dirtyStudents.length > 0 ? 'OUTDATED' : 'SYNCED',
    dirtyStudents,
    dirtyCount: dirtyStudents.length,
  };
}

export function buildEducamosSnapshot(
  col: ColumnEntity,
  students: StudentEntity[],
  cells: Record<string, CellEntity>
): Record<string, number> {
  const snapshot: Record<string, number> = {};
  for (const student of students) {
    if (student.isHidden) continue;
    const cell = cells[cellKey(student.id, col.id)];
    const normalized = normalizeEducamosGrade(cell?.grade ?? null, col.decimals);
    if (normalized !== null) {
      snapshot[student.id] = normalized;
    }
  }
  return snapshot;
}

export function createEducamosDoneTracking(
  col: ColumnEntity,
  students: StudentEntity[],
  cells: Record<string, CellEntity>
): EducamosColumnTracking {
  return {
    status: 'DONE',
    snapshot: buildEducamosSnapshot(col, students, cells),
    updatedAt: new Date().toISOString(),
  };
}

export function markEducamosCellSynced(
  col: ColumnEntity,
  studentId: string,
  cell: CellEntity | undefined
): EducamosColumnTracking {
  const nextSnap: Record<string, number> = { ...(col.educamos?.snapshot ?? {}) };
  const normalized = normalizeEducamosGrade(cell?.grade ?? null, col.decimals);
  if (normalized !== null) {
    nextSnap[studentId] = normalized;
  } else {
    delete nextSnap[studentId];
  }
  return {
    status: 'DONE',
    snapshot: nextSnap,
    updatedAt: new Date().toISOString(),
  };
}
