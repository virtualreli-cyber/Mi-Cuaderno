import {
  DEFAULT_LOMLOE_KEY_COMPETENCES,
  DEFAULT_LOMLOE_RELIGION_CURRICULA,
} from '../data/lomloeReligion';
import {
  cellKey,
  type CellEntity,
  type ClassBook,
  type ColumnEntity,
  type LomloeCriterion,
  type LomloeCurriculum,
  type LomloeKeyCompetenceDef,
  type LomloeSpecificCompetence,
  type TabEntity,
  type ViewSettings,
} from '../types/gradebook';

/**
 * Infiere automáticamente el currículo oficial LOMLOE de Religión Católica
 * según el curso detectado en el nombre de la clase (1º/2º ESO, 3º/4º ESO, 1º BAC).
 */
export function inferReligionCurriculumId(
  bookName?: string | null,
  subject?: string | null
): string | null {
  const source = `${bookName ?? ''} ${subject ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (!source.trim()) return null;

  if (/\b(?:[12](?:\.?[ºoa°])?|primero|segundo)\s*(?:de\s*)?eso\b/i.test(source)) {
    return 'lomloe-rel-eso-1-2';
  }
  if (/\b(?:[34](?:\.?[ºoa°])?|tercero|cuarto)\s*(?:de\s*)?eso\b/i.test(source)) {
    return 'lomloe-rel-eso-3-4';
  }
  if (/\b(?:[12](?:\.?[ºoa°])?\s*(?:de\s*)?)?(?:bac|bach|bto|bachillerato)\b/i.test(source)) {
    return 'lomloe-rel-bac-1';
  }
  return null;
}

export function resolveBookCurriculum(
  book: Pick<ClassBook, 'name' | 'subject' | 'lomloeCurriculumId'> | null | undefined,
  curricula: LomloeCurriculum[] | undefined
): LomloeCurriculum | null {
  if (!book) return null;
  const catalog =
    curricula && curricula.length > 0 ? curricula : DEFAULT_LOMLOE_RELIGION_CURRICULA;

  if (book.lomloeCurriculumId === 'NONE') return null;

  if (book.lomloeCurriculumId) {
    const explicit = catalog.find((c) => c.id === book.lomloeCurriculumId);
    if (explicit) return explicit;
  }

  const inferredId = inferReligionCurriculumId(book.name, book.subject);
  if (!inferredId) return null;
  return catalog.find((c) => c.id === inferredId) ?? null;
}

export function isLomloeRowVisible(
  book: Pick<ClassBook, 'showLomloeRow'> | null | undefined,
  settings: Pick<ViewSettings, 'showLomloeRow'> | null | undefined
): boolean {
  if (book?.showLomloeRow !== undefined) return book.showLomloeRow;
  if (settings?.showLomloeRow !== undefined) return settings.showLomloeRow;
  return true;
}

export function compareLomloeCodes(a: string, b: string): number {
  const partsA = a.split('.').map((p) => Number(p));
  const partsB = b.split('.').map((p) => Number(p));
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i += 1) {
    const na = Number.isFinite(partsA[i]) ? partsA[i] : Number.MAX_SAFE_INTEGER;
    const nb = Number.isFinite(partsB[i]) ? partsB[i] : Number.MAX_SAFE_INTEGER;
    if (na !== nb) return na - nb;
  }
  return a.localeCompare(b, 'es');
}

export interface ColumnLomloeSummary {
  criteria: LomloeCriterion[];
  criteriaCodes: string[];
  specificCompetences: LomloeSpecificCompetence[];
  specificNumbers: number[];
  keyCompetences: LomloeKeyCompetenceDef[];
}

export function resolveColumnLomloeSummary(
  column: Pick<ColumnEntity, 'lomloeCriteriaIds'> | null | undefined,
  curriculum: LomloeCurriculum | null | undefined,
  keyCompetencesCatalog?: LomloeKeyCompetenceDef[]
): ColumnLomloeSummary {
  const empty: ColumnLomloeSummary = {
    criteria: [],
    criteriaCodes: [],
    specificCompetences: [],
    specificNumbers: [],
    keyCompetences: [],
  };
  if (!column?.lomloeCriteriaIds?.length || !curriculum) return empty;

  const kcCatalog =
    keyCompetencesCatalog && keyCompetencesCatalog.length > 0
      ? keyCompetencesCatalog
      : DEFAULT_LOMLOE_KEY_COMPETENCES;
  const kcById = new Map(kcCatalog.map((kc) => [kc.id, kc]));
  const ceById = new Map(curriculum.specificCompetences.map((ce) => [ce.id, ce]));
  const criterionById = new Map(curriculum.criteria.map((cr) => [cr.id, cr]));

  const seenCriteria = new Set<string>();
  const criteria: LomloeCriterion[] = [];
  for (const id of column.lomloeCriteriaIds) {
    if (seenCriteria.has(id)) continue;
    const found =
      criterionById.get(id) ?? curriculum.criteria.find((cr) => cr.code === id);
    if (found) {
      seenCriteria.add(found.id);
      criteria.push(found);
    }
  }
  criteria.sort((a, b) => compareLomloeCodes(a.code, b.code));

  const seenCe = new Set<string>();
  const specificCompetences: LomloeSpecificCompetence[] = [];
  const seenKc = new Set<string>();
  const keyCompetences: LomloeKeyCompetenceDef[] = [];

  for (const cr of criteria) {
    const ce = ceById.get(cr.specificCompetenceId);
    if (ce && !seenCe.has(ce.id)) {
      seenCe.add(ce.id);
      specificCompetences.push(ce);
    }
    const kcIds =
      cr.keyCompetenceIds && cr.keyCompetenceIds.length > 0
        ? cr.keyCompetenceIds
        : ce?.keyCompetenceIds ?? [];
    for (const kcId of kcIds) {
      if (seenKc.has(kcId)) continue;
      const kc = kcById.get(kcId);
      if (kc) {
        seenKc.add(kcId);
        keyCompetences.push(kc);
      }
    }
  }

  specificCompetences.sort((a, b) => a.number - b.number);
  keyCompetences.sort((a, b) => a.number - b.number);

  return {
    criteria,
    criteriaCodes: criteria.map((c) => c.code),
    specificCompetences,
    specificNumbers: specificCompetences.map((ce) => ce.number),
    keyCompetences,
  };
}

export function normalizeGradeTo10(
  grade: number | null | undefined,
  col: Pick<ColumnEntity, 'minValue' | 'maxValue'>
): number | null {
  if (grade === null || grade === undefined || Number.isNaN(grade)) return null;
  const span = col.maxValue - col.minValue;
  if (span <= 0) return grade;
  return ((grade - col.minValue) / span) * 10;
}

export interface StudentLomloeStats {
  byCriterion: Record<string, { avg: number | null; count: number }>;
  bySpecificCompetence: Record<string, { avg: number | null; count: number }>;
  byKeyCompetence: Record<string, { avg: number | null; count: number }>;
}

/**
 * Calcula las medias (escala 0–10) por Criterio, Competencia Específica y Competencia Clave
 * para un alumno dado, usando todas las columnas con criterios LOMLOE en las pestañas indicadas.
 */
export function computeStudentLomloeStats(
  studentId: string,
  tabs: TabEntity[],
  cells: Record<string, CellEntity>,
  curriculum: LomloeCurriculum | null,
  keyCompetencesCatalog?: LomloeKeyCompetenceDef[]
): StudentLomloeStats {
  const byCriterionAcc: Record<string, number[]> = {};
  const byCeAcc: Record<string, number[]> = {};
  const byKcAcc: Record<string, number[]> = {};

  if (!curriculum) {
    return { byCriterion: {}, bySpecificCompetence: {}, byKeyCompetence: {} };
  }

  for (const tab of tabs) {
    for (const col of tab.columns) {
      if (!col.lomloeCriteriaIds?.length) continue;
      const rawCell = cells[cellKey(studentId, col.id)];
      const normalized = normalizeGradeTo10(rawCell?.grade, col);
      if (normalized === null) continue;

      const summary = resolveColumnLomloeSummary(
        col,
        curriculum,
        keyCompetencesCatalog
      );
      for (const cr of summary.criteria) {
        (byCriterionAcc[cr.id] ??= []).push(normalized);
      }
      for (const ce of summary.specificCompetences) {
        (byCeAcc[ce.id] ??= []).push(normalized);
      }
      for (const kc of summary.keyCompetences) {
        (byKcAcc[kc.id] ??= []).push(normalized);
      }
    }
  }

  const reduceAcc = (acc: Record<string, number[]>) => {
    const out: Record<string, { avg: number | null; count: number }> = {};
    for (const [key, vals] of Object.entries(acc)) {
      const avg =
        vals.length > 0
          ? vals.reduce((s, v) => s + v, 0) / vals.length
          : null;
      out[key] = { avg, count: vals.length };
    }
    return out;
  };

  return {
    byCriterion: reduceAcc(byCriterionAcc),
    bySpecificCompetence: reduceAcc(byCeAcc),
    byKeyCompetence: reduceAcc(byKcAcc),
  };
}
