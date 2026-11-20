import type { ClassBook } from '../types/gradebook';

export type CopyElementKind = 'COLUMN' | 'FOLDER' | 'TAB';

export interface ElementDataSummary {
  hasStudentData: boolean;
  gradesCount: number;
  commentsCount: number;
  affectedStudents: number;
}

export interface CopyConflictMatch {
  id: string;
  title: string;
  matchType: 'EXACT' | 'SIMILAR';
  score: number;
  dataSummary: ElementDataSummary;
}

/**
 * Normalizes Spanish/Latin names for comparison:
 * lowercase, strips accents/diacritics, removes ordinal symbols & punctuation,
 * collapses whitespace.
 */
export function normalizeComparableName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ºª°.,\-_:;()[\]/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Detects whether two element names are equal or similar.
 * Guards against false positives between numbered series (e.g. "Actividad 1" vs "Actividad 2",
 * "1.ª Evaluación" vs "2.ª Evaluación") while catching exact matches, accent/punctuation variants,
 * typos, and substring/prefix matches.
 */
export function matchNames(
  a: string,
  b: string
): { matched: boolean; matchType: 'EXACT' | 'SIMILAR' | null; score: number } {
  const na = normalizeComparableName(a);
  const nb = normalizeComparableName(b);

  if (!na || !nb) return { matched: false, matchType: null, score: 0 };

  if (na === nb) {
    return { matched: true, matchType: 'EXACT', score: 1 };
  }

  // Distinct numbered items (e.g. "Actividad 1" vs "Actividad 2", "1.ª Ev" vs "2.ª Ev")
  const numsA = na.match(/\d+/g) ?? [];
  const numsB = nb.match(/\d+/g) ?? [];
  if (numsA.length > 0 && numsB.length > 0 && numsA.join(',') !== numsB.join(',')) {
    return { matched: false, matchType: null, score: 0 };
  }

  // Substring containment (e.g. "Cuaderno" vs "Cuaderno y Tareas", "Examen" vs "Examen Global")
  const minLen = Math.min(na.length, nb.length);
  if (minLen >= 4 && (na.includes(nb) || nb.includes(na))) {
    const ratio = minLen / Math.max(na.length, nb.length);
    return { matched: true, matchType: 'SIMILAR', score: Math.max(0.82, ratio) };
  }

  // Edit distance similarity for typos / slight phrasing variants
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen >= 4) {
    const dist = levenshtein(na, nb);
    const sim = 1 - dist / maxLen;
    if (sim >= 0.78) {
      return { matched: true, matchType: 'SIMILAR', score: sim };
    }
  }

  // Significant token overlap (words >= 3 chars)
  const stopWords = new Set(['los', 'las', 'del', 'con', 'por', 'para', 'una', 'uno', 'que']);
  const tokensA = new Set(na.split(' ').filter((w) => w.length >= 3 && !stopWords.has(w)));
  const tokensB = new Set(nb.split(' ').filter((w) => w.length >= 3 && !stopWords.has(w)));
  if (tokensA.size > 0 && tokensB.size > 0) {
    let inter = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) inter++;
    }
    const union = new Set([...tokensA, ...tokensB]).size;
    const jaccard = union > 0 ? inter / union : 0;
    if (jaccard >= 0.6) {
      return { matched: true, matchType: 'SIMILAR', score: jaccard };
    }
  }

  return { matched: false, matchType: null, score: 0 };
}

/**
 * Inspects whether an existing column, folder, or tab in `targetClass`
 * contains any student grades, rubric evaluations, or comments.
 */
export function inspectTargetElementData(
  targetClass: ClassBook,
  kind: CopyElementKind,
  existingId: string,
  targetTabId?: string
): ElementDataSummary {
  const colIds = new Set<string>();

  if (kind === 'COLUMN') {
    colIds.add(existingId);
  } else if (kind === 'FOLDER') {
    const tab = targetClass.tabs.find((t) =>
      targetTabId ? t.id === targetTabId : t.folders.some((f) => f.id === existingId)
    );
    if (tab) {
      for (const c of tab.columns) {
        if (c.folderId === existingId) colIds.add(c.id);
      }
    }
  } else if (kind === 'TAB') {
    const tab = targetClass.tabs.find((t) => t.id === existingId);
    if (tab) {
      for (const c of tab.columns) colIds.add(c.id);
    }
  }

  if (colIds.size === 0) {
    return { hasStudentData: false, gradesCount: 0, commentsCount: 0, affectedStudents: 0 };
  }

  let gradesCount = 0;
  let commentsCount = 0;
  const studentsWithData = new Set<string>();
  const validStudentIds = new Set(targetClass.students.map((s) => s.id));

  for (const [key, cell] of Object.entries(targetClass.cells)) {
    const sepIdx = key.indexOf('::');
    if (sepIdx < 0) continue;
    const studentId = key.slice(0, sepIdx);
    const colId = key.slice(sepIdx + 2);
    if (!colIds.has(colId)) continue;
    if (validStudentIds.size > 0 && !validStudentIds.has(studentId)) continue;

    const hasGrade = cell.grade !== null && cell.grade !== undefined;
    const hasRubric = Boolean(
      cell.rubricEval && Object.keys(cell.rubricEval.selections ?? {}).length > 0
    );
    const hasComment = Boolean(cell.comment && cell.comment.trim().length > 0);

    if (hasGrade || hasRubric) gradesCount++;
    if (hasComment) commentsCount++;
    if (hasGrade || hasRubric || hasComment) {
      studentsWithData.add(studentId);
    }
  }

  return {
    hasStudentData: gradesCount > 0 || commentsCount > 0,
    gradesCount,
    commentsCount,
    affectedStudents: studentsWithData.size,
  };
}

/**
 * Searches `targetClass` (and `targetTabId` when copying a column or folder)
 * for any existing element with an equal or similar name.
 */
export function findCopyConflicts(
  targetClass: ClassBook,
  kind: CopyElementKind,
  sourceTitle: string,
  targetTabId?: string
): CopyConflictMatch[] {
  const candidates: Array<{ id: string; title: string }> = [];

  if (kind === 'TAB') {
    for (const tab of targetClass.tabs) {
      candidates.push({ id: tab.id, title: tab.title });
    }
  } else {
    const tab = targetClass.tabs.find((t) => t.id === targetTabId);
    if (!tab) return [];
    if (kind === 'COLUMN') {
      for (const col of tab.columns) {
        candidates.push({ id: col.id, title: col.title });
      }
    } else if (kind === 'FOLDER') {
      for (const fld of tab.folders) {
        candidates.push({ id: fld.id, title: fld.title });
      }
    }
  }

  const matches: CopyConflictMatch[] = [];
  for (const item of candidates) {
    const res = matchNames(sourceTitle, item.title);
    if (res.matched && res.matchType) {
      matches.push({
        id: item.id,
        title: item.title,
        matchType: res.matchType,
        score: res.score,
        dataSummary: inspectTargetElementData(targetClass, kind, item.id, targetTabId),
      });
    }
  }

  return matches.sort((a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === 'EXACT' ? -1 : 1;
    return b.score - a.score;
  });
}
