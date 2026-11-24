import {
  getGradeAlertColors,
  getGroupDefaultColor,
  getRubricLevelPastelColor,
} from '../constants/colors';
import {
  cellKey,
  type CellEntity,
  type ClassBook,
  type ColumnEntity,
  type ColumnSummaryMetric,
  type FolderEntity,
  type GroupCategoryDef,
  type RubricCellEval,
  type RubricEntity,
  type RubricLevel,
  type StudentEntity,
  type StudentGroupDef,
  type StudentSortMode,
  type TabEntity,
} from '../types/gradebook';

export function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Parses mixed keyboard input containing a grade and/or free-text comment.
 * Examples:
 * - "8.5" -> { grade: 8.5, comment: "" }
 * - "8,25 buen trabajo" -> { grade: 8.25, comment: "buen trabajo" }
 * - "8.5 falta ejercicio 2" -> { grade: 8.5, comment: "falta ejercicio 2" }
 * - "participación activa 9.5" -> { grade: 9.5, comment: "participación activa" }
 * - "entregado tarde" -> { grade: null, comment: "entregado tarde" }
 */
export function parseMixedInput(raw: string): { grade: number | null; comment: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { grade: null, comment: '' };
  }

  const toNumber = (token: string): number | null => {
    const n = Number(token.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  // 0. Standalone "NP" (No Presentado) defaults to grade 0 with comment "NP"
  if (/^np$/i.test(trimmed)) {
    return { grade: 0, comment: 'NP' };
  }

  // 1. Standalone numeric grade
  const exactNum = /^([+-]?\d+(?:[.,]\d+)?)$/.exec(trimmed);
  if (exactNum) {
    return { grade: toNumber(exactNum[1]), comment: '' };
  }

  // 2. Leading numeric grade followed by text comment
  const leadingNum = /^([+-]?\d+(?:[.,]\d+)?)\s*[:;\-|]?\s*(.+)$/.exec(trimmed);
  if (leadingNum && /\s|[:;\-|]/.test(trimmed.slice(leadingNum[1].length, leadingNum[1].length + 2))) {
    const num = toNumber(leadingNum[1]);
    if (num !== null) {
      return { grade: num, comment: leadingNum[2].trim() };
    }
  }

  // 3. Text comment followed by trailing numeric grade
  const trailingNum = /^(.+?)(?:\s*[:;\-|]\s*|\s+)([+-]?\d+(?:[.,]\d+)?)$/.exec(trimmed);
  if (trailingNum) {
    const num = toNumber(trailingNum[2]);
    if (num !== null) {
      return { grade: num, comment: trailingNum[1].trim() };
    }
  }

  // 4. Pure comment text (no numeric grade)
  return { grade: null, comment: trimmed };
}

/**
 * Live split parser used while actively typing inside a grid cell so numbers
 * appear immediately on the top line and text comments appear on the bottom line.
 * Preserves in-progress decimal tokens like "8." or "-0," without flickering.
 */
export function parseLiveMixedInput(raw: string): {
  gradeText: string;
  commentText: string;
  activePart: 'GRADE' | 'COMMENT';
} {
  const trimmedStart = raw.trimStart();
  if (!trimmedStart) {
    return { gradeText: '', commentText: '', activePart: 'GRADE' };
  }

  if (/^np$/i.test(trimmedStart.trim())) {
    return { gradeText: '0', commentText: 'NP', activePart: 'COMMENT' };
  }

  // Partial or complete standalone number (including "-", "+", "8.", "8,50")
  const standaloneNum = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))(\s*)$/.exec(trimmedStart);
  if (standaloneNum) {
    const hasTrailingSpace = standaloneNum[2].length > 0;
    return {
      gradeText: standaloneNum[1],
      commentText: '',
      activePart: hasTrailingSpace ? 'COMMENT' : 'GRADE',
    };
  }
  if (/^[+-]$/.test(trimmedStart.trim())) {
    return { gradeText: trimmedStart.trim(), commentText: '', activePart: 'GRADE' };
  }

  // Leading number followed by comment text
  const leadingNum = /^([+-]?\d+(?:[.,]\d+)?)\s*[:;\-|]?\s*(.+)$/.exec(trimmedStart);
  if (
    leadingNum &&
    /\s|[:;\-|]/.test(trimmedStart.slice(leadingNum[1].length, leadingNum[1].length + 2))
  ) {
    return {
      gradeText: leadingNum[1],
      commentText: leadingNum[2].trimEnd(),
      activePart: 'COMMENT',
    };
  }

  // Leading comment text followed by trailing number (complete or in-progress decimal)
  const trailingNum = /^(.+?)(?:\s*[:;\-|]\s*|\s+)([+-]?\d+(?:[.,]\d*)?)(\s*)$/.exec(trimmedStart);
  if (trailingNum) {
    return {
      gradeText: trailingNum[2],
      commentText: trailingNum[1].trim(),
      activePart: trailingNum[3].length > 0 ? 'COMMENT' : 'GRADE',
    };
  }

  return {
    gradeText: '',
    commentText: trimmedStart.trimEnd(),
    activePart: 'COMMENT',
  };
}

/**
 * Returns rubric levels ordered from HIGHEST achievement (left) to LOWEST achievement (right),
 * with automatic pastel colors graduating smoothly from pastel GREEN (left) to pastel RED (right).
 */
export function normalizeRubricLevels(levels: RubricLevel[]): RubricLevel[] {
  const sorted = [...levels].sort((a, b) => b.percentage - a.percentage);
  return sorted.map((lvl, idx) => ({
    ...lvl,
    color: getRubricLevelPastelColor(idx, sorted.length),
  }));
}

export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, Math.max(0, decimals));
  const eps = 1e-9;
  const scaled = value * factor;
  const rounded =
    scaled >= 0 ? Math.floor(scaled + 0.5 + eps) : Math.ceil(scaled - 0.5 - eps);
  return rounded / factor;
}

export function formatGrade(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return roundTo(value, decimals).toFixed(Math.max(0, decimals));
}

export function clampGradeForColumn(value: number | null, col: ColumnEntity): number | null {
  if (value === null || Number.isNaN(value)) return null;
  const clamped = Math.max(col.minValue, Math.min(col.maxValue, value));
  return roundTo(clamped, col.decimals);
}

/**
 * Increments or decrements a grade cell by `delta` (e.g. +1, -0.5) respecting the
 * column bounds and decimal precision. Empty cells start from 0 (or minValue if > 0).
 */
export function applyCounterDelta(
  currentGrade: number | null | undefined,
  delta: number,
  col: ColumnEntity
): number {
  const base =
    currentGrade !== null && currentGrade !== undefined && !Number.isNaN(currentGrade)
      ? currentGrade
      : col.minValue > 0
        ? col.minValue
        : 0;
  const stepDecimals = (() => {
    const str = String(Math.abs(delta));
    const dot = str.indexOf('.');
    return dot >= 0 ? Math.min(3, str.length - dot - 1) : 0;
  })();
  const nextRaw = roundTo(base + delta, Math.max(col.decimals, stepDecimals));
  const clamped = Math.max(col.minValue, Math.min(col.maxValue, nextRaw));
  return roundTo(clamped, Math.max(col.decimals, stepDecimals));
}

export type CommentAppendSeparator = 'SPACE' | 'NEWLINE';

/**
 * Appends `addition` to an existing cell comment after sentence-ending punctuation
 * (".", "!", "?", "…", ":", ";") using either a space ("punto y seguido") or a
 * newline ("punto y aparte").
 */
export function appendCellComment(
  existingComment: string | undefined,
  addition: string,
  separator: CommentAppendSeparator = 'NEWLINE'
): string {
  const cleanAdd = addition.trim();
  const cleanPrev = (existingComment ?? '').trim();
  if (!cleanAdd) return cleanPrev;
  if (!cleanPrev) return cleanAdd;

  const base = /[.!?…:;]$/.test(cleanPrev) ? cleanPrev : `${cleanPrev}.`;
  return separator === 'NEWLINE' ? `${base}\n${cleanAdd}` : `${base} ${cleanAdd}`;
}

export interface GradeAdjustmentEntry {
  studentId: string;
  columnId: string;
  grade: number | null;
  comment: string;
  pendingAdjustment?: number;
  appliedAdjustment?: number;
  preAdjustmentGrade?: number;
  keepRubricAuto?: boolean;
}

export function canCellRestoreOriginalGrade(cell: CellEntity | undefined): boolean {
  if (!cell) return false;
  if (
    typeof cell.pendingAdjustment === 'number' &&
    Number.isFinite(cell.pendingAdjustment) &&
    cell.pendingAdjustment !== 0
  ) {
    return true;
  }
  if (
    typeof cell.appliedAdjustment === 'number' &&
    Number.isFinite(cell.appliedAdjustment) &&
    cell.appliedAdjustment !== 0
  ) {
    return true;
  }
  return typeof cell.preAdjustmentGrade === 'number' && Number.isFinite(cell.preAdjustmentGrade);
}

export function buildGradeAdjustmentBatch(options: {
  book: ClassBook;
  targets: Array<{ studentId: string; columnId: string }>;
  colMap: Map<string, ColumnEntity>;
  delta: number;
  comment: string;
  separator?: CommentAppendSeparator;
}): {
  entries: GradeAdjustmentEntry[];
  adjustedCount: number;
  immediateCount: number;
  queuedPendingCount: number;
} {
  const { book, targets, colMap, delta, comment, separator = 'NEWLINE' } = options;
  const entries: GradeAdjustmentEntry[] = [];
  let immediateCount = 0;
  let queuedPendingCount = 0;

  for (const { studentId, columnId } of targets) {
    const col = colMap.get(columnId);
    if (!col || col.isLocked || col.type === 'AVERAGE') continue;

    const existing = book.cells[cellKey(studentId, col.id)];
    const hasGrade =
      existing?.grade !== null &&
      existing?.grade !== undefined &&
      !Number.isNaN(existing.grade);

    const nextComment = appendCellComment(existing?.comment, comment, separator);

    if (col.type === 'RUBRIC' && existing?.rubricEval && !existing?.manualOverride && hasGrade) {
      const nextPending = roundTo((existing.pendingAdjustment ?? 0) + delta, 3);
      const nextGrade =
        delta !== 0 ? applyCounterDelta(existing.grade, delta, col) : existing.grade!;
      immediateCount += 1;
      entries.push({
        studentId,
        columnId: col.id,
        grade: nextGrade,
        comment: nextComment,
        pendingAdjustment: nextPending !== 0 ? nextPending : undefined,
        appliedAdjustment: undefined,
        preAdjustmentGrade: undefined,
        keepRubricAuto: true,
      });
    } else if (hasGrade) {
      const origGrade =
        typeof existing?.preAdjustmentGrade === 'number' &&
        Number.isFinite(existing.preAdjustmentGrade)
          ? existing.preAdjustmentGrade
          : existing!.grade!;
      const nextApplied = roundTo((existing?.appliedAdjustment ?? 0) + delta, 3);
      const nextGrade =
        nextApplied === 0
          ? origGrade
          : delta !== 0
            ? applyCounterDelta(existing!.grade, delta, col)
            : existing!.grade!;
      immediateCount += 1;
      entries.push({
        studentId,
        columnId: col.id,
        grade: nextGrade,
        comment: nextComment,
        pendingAdjustment: undefined,
        appliedAdjustment: nextApplied !== 0 ? nextApplied : undefined,
        preAdjustmentGrade: nextApplied !== 0 ? origGrade : undefined,
      });
    } else {
      const nextPending = roundTo((existing?.pendingAdjustment ?? 0) + delta, 3);
      queuedPendingCount += 1;
      entries.push({
        studentId,
        columnId: col.id,
        grade: null,
        comment: nextComment,
        pendingAdjustment: nextPending !== 0 ? nextPending : undefined,
        appliedAdjustment: undefined,
        preAdjustmentGrade: undefined,
      });
    }
  }

  return {
    entries,
    adjustedCount: entries.length,
    immediateCount,
    queuedPendingCount,
  };
}

export function buildRestoreOriginalGradeTargets(
  book: ClassBook,
  targets: Array<{ studentId: string; columnId: string }>,
  colMap: Map<string, ColumnEntity>
): Array<{ studentId: string; columnId: string }> {
  return targets.filter(({ studentId, columnId }) => {
    const col = colMap.get(columnId);
    if (!col || col.isLocked || col.type === 'AVERAGE') return false;
    return canCellRestoreOriginalGrade(book.cells[cellKey(studentId, col.id)]);
  });
}

export function computeRubricPercentage(
  rubric: RubricEntity,
  evalData: RubricCellEval | undefined
): number | null {
  if (!evalData || rubric.criteria.length === 0 || rubric.levels.length === 0) {
    return null;
  }

  let totalWeight = 0;
  let weightedPct = 0;
  let hasAnySelection = false;

  for (const crit of rubric.criteria) {
    const sel = evalData.selections?.[crit.id];
    if (!sel?.levelId) continue;
    const lvl = rubric.levels.find((l) => l.id === sel.levelId);
    if (!lvl) continue;
    hasAnySelection = true;
    const w = Math.max(0, crit.weight);
    totalWeight += w;
    weightedPct += lvl.percentage * w;
  }

  if (!hasAnySelection || totalWeight <= 0) return null;

  return roundTo(weightedPct / totalWeight, rubric.decimals);
}

export function computeRubricScore(
  rubric: RubricEntity,
  evalData: RubricCellEval | undefined
): number | null {
  const pct = computeRubricPercentage(rubric, evalData);
  if (pct === null) return null;

  const norm = pct / 100;
  const raw = rubric.minScore + norm * (rubric.maxScore - rubric.minScore);
  return roundTo(raw, rubric.decimals);
}

/**
 * Resolves the selected level and converted numeric score for a single criterion
 * inside a student's rubric evaluation.
 */
export function computeRubricCriterionResult(
  rubric: RubricEntity,
  criterionId: string,
  evalData: RubricCellEval | undefined
): { level: RubricEntity['levels'][number]; grade: number; percentage: number } | null {
  if (!evalData || rubric.levels.length === 0) return null;
  const sel = evalData.selections?.[criterionId];
  if (!sel?.levelId) return null;
  const lvl = rubric.levels.find((l) => l.id === sel.levelId);
  if (!lvl) return null;
  const norm = lvl.percentage / 100;
  const raw = rubric.minScore + norm * (rubric.maxScore - rubric.minScore);
  return {
    level: lvl,
    grade: roundTo(raw, rubric.decimals),
    percentage: lvl.percentage,
  };
}

/**
 * Formats a grade for display in the gradebook grid.
 * For RUBRIC columns:
 * - By default (`showPercent = false`), displays the 0–10 converted grade (e.g. "8.40").
 * - If "No convertir" is active (`showPercent = true`), displays the raw percentage (e.g. "84%").
 */
export function formatCellDisplayGrade(
  grade: number | null | undefined,
  col: ColumnEntity,
  showRubricPercent = false
): string {
  if (grade === null || grade === undefined || Number.isNaN(grade)) return '';
  if (col.type === 'RUBRIC' && showRubricPercent) {
    const span = col.maxValue - col.minValue;
    const pct = span > 0 ? ((grade - col.minValue) / span) * 100 : grade * 10;
    const rounded = roundTo(pct, 2);
    const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(Math.min(2, col.decimals)).replace(/\.?0+$/, '');
    return `${label}%`;
  }
  return formatGrade(grade, col.decimals);
}

/**
 * Always returns the 0–10 numeric grade string when copying cells (never "%"),
 * even when a RUBRIC column is currently displayed with "No convertir (%)".
 */
export function formatCellCopyValue(
  grade: number | null | undefined,
  col: ColumnEntity
): string {
  if (grade === null || grade === undefined || Number.isNaN(grade)) return '';
  return formatGrade(grade, col.decimals);
}

/**
 * Recomputes all RUBRIC and AVERAGE columns across every tab of a ClassBook
 * in dependency-safe topological order, preserving all existing comments.
 */
export function recalculateBook(book: ClassBook, rubrics: RubricEntity[]): ClassBook {
  const allCols = (book.tabs ?? []).flatMap((t) => t.columns ?? []);
  const colMap = new Map(allCols.map((c) => [c.id, c]));
  const rubricMap = new Map(rubrics.map((r) => [r.id, r]));

  // Map every folder ID to its folder entity & ordered child columns so AVERAGE columns
  // can reference folders directly (just like iDoceo, without needing redundant folder-mean columns).
  const folderMap = new Map<string, { folder: FolderEntity; childCols: ColumnEntity[] }>();
  for (const tab of book.tabs ?? []) {
    const tabCols = tab.columns ?? [];
    for (const folder of tab.folders ?? []) {
      const childCols = tabCols
        .filter((c) => c.folderId === folder.id)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      folderMap.set(folder.id, { folder, childCols });
    }
  }

  const nextCells: Record<string, CellEntity> = { ...book.cells };

  // 1. Recompute RUBRIC cells (preserve manually overridden rubric grades!)
  for (const col of allCols) {
    if (col.type !== 'RUBRIC') continue;
    const rubric = col.rubricId ? rubricMap.get(col.rubricId) : undefined;
    if (!rubric) continue;
    for (const st of book.students) {
      const k = cellKey(st.id, col.id);
      const cell = nextCells[k];
      if (!cell || cell.manualOverride || !cell.rubricEval) continue;
      const computed = computeRubricScore(rubric, cell.rubricEval);
      const pending =
        typeof cell.pendingAdjustment === 'number' && Number.isFinite(cell.pendingAdjustment)
          ? cell.pendingAdjustment
          : 0;
      const finalRubricGrade =
        computed !== null && pending !== 0
          ? applyCounterDelta(computed, pending, col)
          : computed;
      nextCells[k] = {
        ...cell,
        grade: finalRubricGrade,
      };
    }
  }

  // 1b. Reconcile manual overrides on folder summary cells:
  // If any upstream grade/formula changed AFTER a manual override, restore the calculated grade
  // automatically and flag `autoRecalcNotice: true` so the cell visually notifies the teacher.
  const liveAfterRubrics: ClassBook = { ...book, cells: nextCells };
  for (const tab of book.tabs ?? []) {
    const tabCols = tab.columns ?? [];
    for (const folder of tab.folders ?? []) {
      const childCols = tabCols
        .filter((c) => c.folderId === folder.id)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      for (const st of book.students) {
        const fk = cellKey(st.id, folder.id);
        const fCell = nextCells[fk];
        if (!fCell?.manualOverride) continue;
        const currentSig = computeFolderSourceSignature(folder, childCols, st.id, liveAfterRubrics);
        if (fCell.manualSourceSignature === undefined) {
          nextCells[fk] = {
            ...fCell,
            manualSourceSignature: currentSig,
          };
        } else if (fCell.manualSourceSignature !== currentSig) {
          nextCells[fk] = {
            grade: null,
            comment: fCell.comment ?? '',
            autoRecalcNotice: true,
          };
        }
      }
    }
  }

  // 2. Topological order for AVERAGE columns (supports both column IDs & folder IDs, with cycle protection)
  const avgCols = allCols.filter((c) => c.type === 'AVERAGE');
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const orderedAvgCols: ColumnEntity[] = [];

  const visit = (colId: string) => {
    if (visited.has(colId) || visiting.has(colId)) return;
    visiting.add(colId);
    const col = colMap.get(colId);
    if (col?.type === 'AVERAGE' && col.averageConfig) {
      for (const depId of col.averageConfig.sourceColumnIds) {
        if (colMap.get(depId)?.type === 'AVERAGE') {
          visit(depId);
        } else {
          const depFolder = folderMap.get(depId);
          if (depFolder) {
            for (const child of depFolder.childCols) {
              if (child.type === 'AVERAGE') {
                visit(child.id);
              }
            }
          }
        }
      }
    }
    visiting.delete(colId);
    visited.add(colId);
    if (col?.type === 'AVERAGE') orderedAvgCols.push(col);
  };

  for (const c of avgCols) visit(c.id);

  // 3. Evaluate AVERAGE columns for every student
  const liveBookView: ClassBook = { ...book, cells: nextCells };

  for (const col of orderedAvgCols) {
    const cfg = col.averageConfig;
    const srcIds = cfg?.sourceColumnIds ?? [];
    const ignoreEmpty = cfg?.ignoreEmpty ?? true;
    const tgtSpan = col.maxValue - col.minValue;

    for (const st of book.students) {
      const k = cellKey(st.id, col.id);
      const prevCell = nextCells[k];
      const prevComment = prevCell?.comment ?? '';

      if (srcIds.length === 0) {
        if (prevCell) {
          nextCells[k] = { ...prevCell, grade: null };
        }
        continue;
      }

      let weightedSum = 0;
      let weightSum = 0;
      let validCount = 0;

      for (const srcId of srcIds) {
        const w = cfg?.weights?.[srcId] ?? 100 / srcIds.length;
        if (w <= 0) continue;

        const srcCol = colMap.get(srcId);
        if (srcCol) {
          const srcCell = nextCells[cellKey(st.id, srcId)];
          const srcGrade = srcCell?.grade ?? null;

          if (srcGrade === null || Number.isNaN(srcGrade)) {
            if (!ignoreEmpty) {
              weightSum += w;
              validCount++;
            }
            continue;
          }

          const srcSpan = srcCol.maxValue - srcCol.minValue;
          const norm = srcSpan > 0 ? (srcGrade - srcCol.minValue) / srcSpan : 0;
          weightedSum += norm * w;
          weightSum += w;
          validCount++;
          continue;
        }

        // Folder reference directly in AVERAGE formula
        const srcFolder = folderMap.get(srcId);
        if (srcFolder) {
          const folderVal = computeFolderSummary(
            srcFolder.folder,
            srcFolder.childCols,
            st.id,
            liveBookView
          );
          if (folderVal === null || Number.isNaN(folderVal)) {
            if (!ignoreEmpty) {
              weightSum += w;
              validCount++;
            }
            continue;
          }
          const baseChild = srcFolder.childCols[0];
          const fMin = baseChild ? baseChild.minValue : 0;
          const fMax = baseChild ? baseChild.maxValue : 10;
          const fSpan = fMax - fMin;
          const norm = fSpan > 0 ? (folderVal - fMin) / fSpan : folderVal / 10;
          weightedSum += norm * w;
          weightSum += w;
          validCount++;
        }
      }

      const outGrade =
        validCount > 0 && weightSum > 0
          ? roundTo(col.minValue + (weightedSum / weightSum) * (tgtSpan > 0 ? tgtSpan : 10), col.decimals)
          : null;

      if (outGrade !== null || prevComment) {
        nextCells[k] = {
          grade: outGrade,
          comment: prevComment,
        };
      } else {
        delete nextCells[k];
      }
    }
  }

  return {
    ...book,
    cells: nextCells,
  };
}

/**
 * Removes redundant in-folder "Media <folder>" AVERAGE columns (now displayed directly
 * on the folder's own continuous column) and cleanly re-points any downstream AVERAGE columns
 * (such as "Nota Ev.") to reference the folder ID directly with identical weights.
 * Idempotent: safe to run on already-migrated books.
 */
export function migrateRedundantFolderAverageColumns(book: ClassBook): {
  book: ClassBook;
  removedCount: number;
} {
  const redundantColToFolder = new Map<string, string>();
  const folderConfigFromCol = new Map<string, ColumnEntity>();

  for (const tab of book.tabs ?? []) {
    const tabFolders = tab.folders ?? [];
    const tabCols = tab.columns ?? [];
    const folderIds = new Set(tabFolders.map((f) => f.id));
    for (const col of tabCols) {
      if (col.type !== 'AVERAGE' || !col.folderId || !folderIds.has(col.folderId)) continue;
      const siblingIds = new Set(
        tabCols.filter((c) => c.folderId === col.folderId && c.id !== col.id).map((c) => c.id)
      );
      const srcIds = col.averageConfig?.sourceColumnIds ?? [];
      const titleIsMedia = /^media\b/i.test(col.title.trim());
      const sourcesAreOnlySiblings =
        srcIds.length > 0 && srcIds.every((sid) => siblingIds.has(sid));

      if (titleIsMedia || sourcesAreOnlySiblings) {
        redundantColToFolder.set(col.id, col.folderId);
        folderConfigFromCol.set(col.folderId, col);
      }
    }
  }

  if (redundantColToFolder.size === 0) {
    return { book, removedCount: 0 };
  }

  const nextCells: Record<string, CellEntity> = {};
  for (const [k, cell] of Object.entries(book.cells ?? {})) {
    const colId = k.split('::')[1];
    if (colId && redundantColToFolder.has(colId)) continue;
    nextCells[k] = cell;
  }

  const nextTabs = (book.tabs ?? []).map((tab) => {
    const nextFolders = (tab.folders ?? []).map((f) => {
      const removedCol = folderConfigFromCol.get(f.id);
      if (!removedCol) return f;
      const cfg = removedCol.averageConfig;
      const nextFolder: FolderEntity = {
        ...f,
        ignoreEmpty: cfg?.ignoreEmpty ?? f.ignoreEmpty ?? true,
      };
      if (cfg && cfg.sourceColumnIds.length > 1) {
        const wVals = cfg.sourceColumnIds.map((id) => cfg.weights[id] ?? 0);
        const allEqual = wVals.every((w) => Math.abs(w - wVals[0]) < 0.05);
        if (!allEqual && wVals.some((w) => w > 0)) {
          nextFolder.summaryMode = 'WEIGHTED_MEAN';
          nextFolder.columnWeights = { ...cfg.weights };
        }
      }
      return nextFolder;
    });

    const nextColumns = (tab.columns ?? [])
      .filter((c) => !redundantColToFolder.has(c.id))
      .map((c) => {
        if (c.type !== 'AVERAGE' || !c.averageConfig) return c;
        let changed = false;
        const nextWeights: Record<string, number> = { ...c.averageConfig.weights };
        const nextSrcIds: string[] = [];
        for (const sid of c.averageConfig.sourceColumnIds) {
          const mappedFolderId = redundantColToFolder.get(sid);
          if (mappedFolderId) {
            changed = true;
            const prevWeight = nextWeights[sid];
            delete nextWeights[sid];
            if (!nextSrcIds.includes(mappedFolderId)) {
              nextSrcIds.push(mappedFolderId);
              if (prevWeight !== undefined) {
                nextWeights[mappedFolderId] = (nextWeights[mappedFolderId] ?? 0) + prevWeight;
              }
            } else if (prevWeight !== undefined) {
              nextWeights[mappedFolderId] = (nextWeights[mappedFolderId] ?? 0) + prevWeight;
            }
          } else {
            nextSrcIds.push(sid);
          }
        }
        if (!changed) return c;
        return {
          ...c,
          averageConfig: {
            ...c.averageConfig,
            sourceColumnIds: nextSrcIds,
            weights: nextWeights,
          },
        };
      });

    const nextItemOrder = tab.itemOrder?.filter((id) => !redundantColToFolder.has(id));

    return {
      ...tab,
      folders: nextFolders,
      columns: nextColumns,
      itemOrder: nextItemOrder,
    };
  });

  return {
    book: {
      ...book,
      tabs: nextTabs,
      cells: nextCells,
    },
    removedCount: redundantColToFolder.size,
  };
}

/**
 * Deterministic fingerprint of every child-column grade & folder configuration affecting
 * a student's calculated folder summary. Used to detect upstream changes after a manual override.
 */
export function computeFolderSourceSignature(
  folder: FolderEntity,
  childCols: ColumnEntity[],
  studentId: string,
  book: ClassBook
): string {
  const mode = folder.summaryMode ?? 'ARITHMETIC_MEAN';
  const ignoreEmpty = folder.ignoreEmpty ?? true;
  const colParts = childCols.map((c) => {
    const cell = book.cells[cellKey(studentId, c.id)];
    const g = hasCellNumericGrade(cell) ? cell!.grade : '';
    const w = folder.columnWeights?.[c.id] ?? '';
    return `${c.id}:${c.minValue}-${c.maxValue}:${w}:${g}`;
  });
  return `${mode}|${ignoreEmpty ? 1 : 0}|${colParts.join('|')}`;
}

/**
 * Pure formula calculation for a folder summary column (ignoring any manual override).
 */
export function computeFolderFormulaValue(
  folder: FolderEntity,
  childCols: ColumnEntity[],
  studentId: string,
  book: ClassBook
): number | null {
  const ignoreEmpty = folder.ignoreEmpty ?? true;
  const entries: { val: number; norm: number; weight: number }[] = [];

  for (const col of childCols) {
    const cell = book.cells[cellKey(studentId, col.id)];
    const w = folder.columnWeights?.[col.id] ?? (childCols.length > 0 ? 100 / childCols.length : 1);
    const span = col.maxValue - col.minValue;

    if (cell?.grade === null || cell?.grade === undefined || Number.isNaN(cell.grade)) {
      if (!ignoreEmpty) {
        entries.push({ val: col.minValue, norm: 0, weight: Math.max(0, w) });
      }
      continue;
    }

    const norm = span > 0 ? (cell.grade - col.minValue) / span : 0;
    entries.push({ val: cell.grade, norm, weight: Math.max(0, w) });
  }

  if (entries.length === 0) return null;

  switch (folder.summaryMode) {
    case 'SUM':
      return roundTo(
        entries.reduce((acc, e) => acc + e.val, 0),
        2
      );
    case 'MAX':
      return roundTo(Math.max(...entries.map((e) => e.val)), 2);
    case 'MIN':
      return roundTo(Math.min(...entries.map((e) => e.val)), 2);
    case 'WEIGHTED_MEAN': {
      const totalW = entries.reduce((acc, e) => acc + e.weight, 0);
      if (totalW <= 0) {
        return roundTo(entries.reduce((acc, e) => acc + e.val, 0) / entries.length, 2);
      }
      const normAvg = entries.reduce((acc, e) => acc + e.norm * e.weight, 0) / totalW;
      const baseCol = childCols[0];
      const out = baseCol
        ? baseCol.minValue + normAvg * (baseCol.maxValue - baseCol.minValue)
        : normAvg * 10;
      return roundTo(out, 2);
    }
    case 'ARITHMETIC_MEAN':
    default:
      return roundTo(entries.reduce((acc, e) => acc + e.val, 0) / entries.length, 2);
  }
}

export function computeFolderSummary(
  folder: FolderEntity,
  childCols: ColumnEntity[],
  studentId: string,
  book: ClassBook
): number | null {
  const overrideCell = book.cells[cellKey(studentId, folder.id)];
  if (overrideCell?.manualOverride && hasCellNumericGrade(overrideCell)) {
    return overrideCell.grade;
  }
  return computeFolderFormulaValue(folder, childCols, studentId, book);
}

export function countFolderOverridesAndNotices(
  book: ClassBook,
  folderId: string
): { manualCount: number; noticeCount: number; totalCount: number } {
  let manualCount = 0;
  let noticeCount = 0;
  for (const st of book.students) {
    if (st.isHidden) continue;
    const cell = book.cells[cellKey(st.id, folderId)];
    if (!cell) continue;
    if (cell.manualOverride) manualCount += 1;
    else if (cell.autoRecalcNotice) noticeCount += 1;
  }
  return { manualCount, noticeCount, totalCount: manualCount + noticeCount };
}

/**
 * Restores calculated folder values (clearing `manualOverride`, `manualSourceSignature`, and
 * `autoRecalcNotice`) for either specific student(s) or all students in `folderId`, while
 * preserving any existing text comments. Recomputes downstream AVERAGE columns.
 */
export function restoreFolderCellsCalculation(
  book: ClassBook,
  folderId: string,
  rubrics: RubricEntity[],
  studentIds?: string[]
): { book: ClassBook; restoredCount: number } {
  const targetStudentIds = studentIds ?? book.students.map((s) => s.id);
  const nextCells: Record<string, CellEntity> = { ...book.cells };
  let restoredCount = 0;

  for (const sid of targetStudentIds) {
    const k = cellKey(sid, folderId);
    const prev = nextCells[k];
    if (!prev || (!prev.manualOverride && !prev.autoRecalcNotice)) continue;
    restoredCount += 1;
    const cleanComment = (prev.comment ?? '').trim();
    if (cleanComment) {
      nextCells[k] = {
        grade: null,
        comment: cleanComment,
      };
    } else {
      delete nextCells[k];
    }
  }

  if (restoredCount === 0) {
    return { book, restoredCount: 0 };
  }

  return {
    book: recalculateBook({ ...book, cells: nextCells }, rubrics),
    restoredCount,
  };
}

export interface ColumnStats {
  count: number;
  avgLabel: string;
  passRateLabel: string;
}

export function computeColumnStats(
  col: ColumnEntity,
  students: StudentEntity[],
  book: ClassBook
): ColumnStats {
  const vals: number[] = [];
  let passed = 0;

  for (const s of students) {
    if (s.isHidden) continue;
    const g = book.cells[cellKey(s.id, col.id)]?.grade ?? null;
    if (g !== null && !Number.isNaN(g)) {
      vals.push(g);
      if (g >= col.passThreshold) passed++;
    }
  }

  if (vals.length === 0) {
    return { count: 0, avgLabel: '—', passRateLabel: '—' };
  }

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const passPct = Math.round((passed / vals.length) * 100);
  return {
    count: vals.length,
    avgLabel: formatGrade(avg, col.decimals),
    passRateLabel: `${passPct}%`,
  };
}

export function resolveCellColors(
  grade: number | null,
  col: Pick<ColumnEntity, 'colorMode' | 'minValue' | 'maxValue' | 'passThreshold'>
): { textColor?: string; bgColor?: string } {
  if (grade === null || Number.isNaN(grade) || !col.colorMode || col.colorMode === 'NONE') {
    return {};
  }

  const alert = getGradeAlertColors(grade, col.passThreshold);
  if (!alert) return {};

  if (col.colorMode === 'TEXT_ONLY') {
    return { textColor: alert.textColor };
  }
  return { textColor: alert.bgTextColor, bgColor: alert.bgColor };
}

export interface ParsedStudentItem {
  firstName: string;
  lastName: string;
  group?: string;
  raw: string;
}

/**
 * Parses raw text lines containing student entries into first and last names.
 * Expected primary format: "Apellidos, Nombre" (e.g. "García López, Juan").
 * Also supports:
 * - "García López, Juan (1ºA)" -> extracts group "1ºA"
 * - Tab-separated: "García López\tJuan"
 * - Semicolon-separated: "García López; Juan"
 * - Bulleted lines: "1. García López, Juan" or "- García López, Juan"
 * - Fallback for lines without separator: "Juan García López" -> firstName: "Juan", lastName: "García López"
 */
export function parseStudentList(rawText: string): ParsedStudentItem[] {
  const lines = rawText.split(/\r?\n/);
  const result: ParsedStudentItem[] = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Remove leading numbering or list bullets: "1.", "1)", "-", "*", "•", etc.
    line = line.replace(/^(\d+[\.\)]|\-|\*|•)\s*/, '').trim();
    if (!line) continue;

    // Check for group/subgroup in parentheses at end: e.g. "(1º ESO A)"
    let group: string | undefined;
    const groupMatch = /\s*\(([^)]+)\)\s*$/.exec(line);
    if (groupMatch) {
      group = groupMatch[1].trim();
      line = line.slice(0, groupMatch.index).trim();
    }

    let lastName = '';
    let firstName = '';

    if (line.includes(',')) {
      const parts = line.split(',');
      lastName = parts[0].trim();
      firstName = parts.slice(1).join(',').trim();
    } else if (line.includes('\t')) {
      const parts = line.split('\t');
      lastName = parts[0].trim();
      firstName = parts.slice(1).join(' ').trim();
    } else if (line.includes(';')) {
      const parts = line.split(';');
      lastName = parts[0].trim();
      firstName = parts.slice(1).join(' ').trim();
    } else {
      // Fallback: split by space. Assume first word is name, remaining words are surnames
      const tokens = line.split(/\s+/).filter(Boolean);
      if (tokens.length === 1) {
        firstName = tokens[0];
        lastName = '';
      } else {
        firstName = tokens[0];
        lastName = tokens.slice(1).join(' ');
      }
    }

    if (firstName || lastName) {
      result.push({
        firstName,
        lastName,
        group,
        raw: rawLine.trim(),
      });
    }
  }

  return result;
}

/**
 * Formats a list of students into a newline-separated string with "Apellidos, Nombre"
 */
export function exportStudentList(
  students: StudentEntity[],
  format: 'LAST_FIRST' | 'FIRST_LAST' = 'LAST_FIRST'
): string {
  return students
    .map((s) => {
      const fn = s.firstName.trim();
      const ln = s.lastName.trim();
      if (format === 'FIRST_LAST') {
        return [fn, ln].filter(Boolean).join(' ');
      }
      if (ln && fn) {
        return `${ln}, ${fn}`;
      }
      return ln || fn;
    })
    .join('\n');
}

export const STUDENT_SORT_OPTIONS: Array<{
  mode: StudentSortMode;
  label: string;
  shortLabel: string;
}> = [
  { mode: 'LAST_ASC', label: 'Apellidos (A–Z)', shortLabel: 'Apellidos A–Z' },
  { mode: 'LAST_DESC', label: 'Apellidos (Z–A)', shortLabel: 'Apellidos Z–A' },
  { mode: 'FIRST_ASC', label: 'Nombre (A–Z)', shortLabel: 'Nombre A–Z' },
  { mode: 'FIRST_DESC', label: 'Nombre (Z–A)', shortLabel: 'Nombre Z–A' },
  { mode: 'GRADE_DESC', label: 'Nota media (Mayor a menor)', shortLabel: 'Nota ↓' },
  { mode: 'GRADE_ASC', label: 'Nota media (Menor a mayor)', shortLabel: 'Nota ↑' },
  { mode: 'GROUP_ASC', label: 'Por grupo (A–Z)', shortLabel: 'Por grupo' },
  { mode: 'MANUAL', label: 'Orden manual (arrastrar filas)', shortLabel: 'Manual' },
];

/**
 * Decides whether a column or folder header title should render vertically (like iDoceo)
 * based on explicit orientation or whether the title fits cleanly horizontally within widthPx.
 */
export function shouldRenderVerticalHeader(
  title: string,
  widthPx: number,
  explicitOrientation?: 'HORIZONTAL' | 'VERTICAL'
): boolean {
  if (explicitOrientation === 'VERTICAL') return true;
  const clean = title.trim();
  if (!clean) return false;
  if (widthPx < 66) return true;

  const usableWidth = Math.max(16, widthPx - 14);
  const words = clean.split(/\s+/).filter(Boolean);
  const longestWordLen = words.reduce((max, w) => Math.max(max, w.length), 0);
  // Approx 6.7px per character at 11px bold
  if (longestWordLen * 6.7 > usableWidth) return true;

  // Check if wrapped text would exceed ~3 horizontal lines
  const charsPerLine = Math.max(1, Math.floor(usableWidth / 6.7));
  let lines = 1;
  let lineLen = 0;
  for (const w of words) {
    if (lineLen === 0) {
      lineLen = w.length;
    } else if (lineLen + 1 + w.length <= charsPerLine) {
      lineLen += 1 + w.length;
    } else {
      lines += 1;
      lineLen = w.length;
    }
  }
  return lines > 3;
}

function getLegacyEffectiveGroups(book: ClassBook): StudentGroupDef[] {
  const configured = [...(book.groups ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);
  const seen = new Set(configured.map((g) => g.name.trim().toLowerCase()));
  const extraNames: string[] = [];

  for (const st of book.students) {
    if (st.isHidden) continue;
    const g = st.group?.trim();
    if (!g) continue;
    const low = g.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      extraNames.push(g);
    }
  }

  extraNames.sort((a, b) => a.localeCompare(b, 'es'));

  const extras: StudentGroupDef[] = extraNames.map((name, i) => ({
    id: `grp-auto-${name}`,
    name,
    color: getGroupDefaultColor(name),
    orderIndex: configured.length + i,
  }));

  return [...configured, ...extras];
}

/**
 * Resolves the class's group categories (supporting multiple independent groupings per class
 * for different activities) and migrates legacy `book.groups` / `student.group` seamlessly.
 */
export function ensureGroupCategories(book: ClassBook): {
  categories: GroupCategoryDef[];
  activeCategory: GroupCategoryDef;
} {
  if (book.groupCategories && book.groupCategories.length > 0) {
    const active =
      book.groupCategories.find((c) => c.id === book.activeGroupCategoryId) ??
      book.groupCategories[0];
    return { categories: book.groupCategories, activeCategory: active };
  }

  const legacyAssignments: Record<string, string> = {};
  for (const st of book.students) {
    const g = st.group?.trim();
    if (g) legacyAssignments[st.id] = g;
  }

  const defaultCat: GroupCategoryDef = {
    id: 'cat-default',
    name: 'Grupos de clase',
    groups: getLegacyEffectiveGroups(book),
    assignments: legacyAssignments,
  };
  return { categories: [defaultCat], activeCategory: defaultCat };
}

export function getStudentActiveGroup(
  student: StudentEntity,
  book: ClassBook
): string | undefined {
  if (book.groupCategories && book.groupCategories.length > 0) {
    const { activeCategory } = ensureGroupCategories(book);
    const assigned = activeCategory.assignments?.[student.id]?.trim();
    return assigned || undefined;
  }
  const g = student.group?.trim();
  return g || undefined;
}

/**
 * Merges explicitly edited groups in the active category with any ad-hoc assigned group names
 * so every group assigned to a student is represented cleanly with a pastel color,
 * always ordered alphabetically (A–Z).
 */
export function getEffectiveBookGroups(book: ClassBook): StudentGroupDef[] {
  const { activeCategory } = ensureGroupCategories(book);
  const configured = [...(activeCategory.groups ?? [])];
  const seen = new Set(configured.map((g) => g.name.trim().toLowerCase()));
  const extraNames: string[] = [];

  for (const st of book.students) {
    if (st.isHidden) continue;
    const g = getStudentActiveGroup(st, book);
    if (!g) continue;
    const low = g.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      extraNames.push(g);
    }
  }

  const extras: StudentGroupDef[] = extraNames.map((name, i) => ({
    id: `grp-auto-${name}`,
    name,
    color: getGroupDefaultColor(name),
    orderIndex: configured.length + i,
  }));

  return [...configured, ...extras].sort((a, b) =>
    a.name.trim().localeCompare(b.name.trim(), 'es', { numeric: true, sensitivity: 'base' })
  );
}

/**
 * Computes a student's mean grade across graded leaf columns (or average columns as fallback)
 * in the active tab (or across all tabs if tab is omitted), normalized to 0–10.
 */
export function getStudentMeanGrade(
  studentId: string,
  book: ClassBook,
  tab?: TabEntity | null
): number | null {
  const cols = tab ? tab.columns : book.tabs.flatMap((t) => t.columns);
  const leafCols = cols.filter((c) => c.type === 'NUMERIC' || c.type === 'RUBRIC');

  let sum = 0;
  let count = 0;

  for (const col of leafCols) {
    const val = book.cells[cellKey(studentId, col.id)]?.grade;
    if (val === null || val === undefined || Number.isNaN(val)) continue;
    const span = col.maxValue - col.minValue;
    const normalized = span > 0 ? ((val - col.minValue) / span) * 10 : val;
    sum += normalized;
    count += 1;
  }

  if (count > 0) return sum / count;

  const avgCols = cols.filter((c) => c.type === 'AVERAGE');
  for (const col of avgCols) {
    const val = book.cells[cellKey(studentId, col.id)]?.grade;
    if (val === null || val === undefined || Number.isNaN(val)) continue;
    sum += val;
    count += 1;
  }

  return count > 0 ? sum / count : null;
}

export function sortStudentList(
  students: StudentEntity[],
  book: ClassBook,
  tab?: TabEntity | null
): StudentEntity[] {
  const mode = book.sortMode;
  const meanCache =
    mode === 'GRADE_DESC' || mode === 'GRADE_ASC'
      ? new Map(students.map((s) => [s.id, getStudentMeanGrade(s.id, book, tab)]))
      : null;

  const compareLastAsc = (a: StudentEntity, b: StudentEntity) =>
    a.lastName.localeCompare(b.lastName, 'es') || a.firstName.localeCompare(b.firstName, 'es');

  return [...students].sort((a, b) => {
    switch (mode) {
      case 'LAST_DESC':
        return (
          b.lastName.localeCompare(a.lastName, 'es') ||
          b.firstName.localeCompare(a.firstName, 'es')
        );
      case 'FIRST_ASC':
        return (
          a.firstName.localeCompare(b.firstName, 'es') ||
          a.lastName.localeCompare(b.lastName, 'es')
        );
      case 'FIRST_DESC':
        return (
          b.firstName.localeCompare(a.firstName, 'es') ||
          b.lastName.localeCompare(a.lastName, 'es')
        );
      case 'GROUP_ASC': {
        const ga = getStudentActiveGroup(a, book) ?? '';
        const gb = getStudentActiveGroup(b, book) ?? '';
        if (ga && !gb) return -1;
        if (!ga && gb) return 1;
        if (ga !== gb) {
          return ga.localeCompare(gb, 'es', { numeric: true, sensitivity: 'base' });
        }
        return compareLastAsc(a, b);
      }
      case 'GRADE_DESC':
      case 'GRADE_ASC': {
        const va = meanCache?.get(a.id) ?? null;
        const vb = meanCache?.get(b.id) ?? null;
        if (va === null && vb === null) return compareLastAsc(a, b);
        if (va === null) return 1; // ungraded always at bottom
        if (vb === null) return -1;
        if (Math.abs(va - vb) > 1e-6) {
          return mode === 'GRADE_DESC' ? vb - va : va - vb;
        }
        return compareLastAsc(a, b);
      }
      case 'MANUAL':
        return a.orderIndex - b.orderIndex;
      case 'LAST_ASC':
      default:
        return compareLastAsc(a, b);
    }
  });
}

export interface StudentGroupBucket {
  key: string;
  name: string;
  color: string;
  isUnassigned: boolean;
  isCollapsed: boolean;
  students: StudentEntity[];
}

export function organizeStudentsForGrid(
  book: ClassBook,
  tab: TabEntity | null,
  searchQuery: string
): { groups: StudentGroupBucket[]; visibleStudents: StudentEntity[] } {
  const q = searchQuery.trim().toLowerCase();
  const filtered = book.students.filter((s) => {
    if (s.isHidden) return false;
    if (!q) return true;
    const grp = getStudentActiveGroup(s, book) ?? '';
    const full = `${s.firstName} ${s.lastName} ${grp} ${s.tags.join(' ')}`.toLowerCase();
    return full.includes(q);
  });

  if (!book.groupByGroups) {
    const sorted = sortStudentList(filtered, book, tab);
    return {
      groups: [
        {
          key: '__all__',
          name: '',
          color: '#E2E8F0',
          isUnassigned: false,
          isCollapsed: false,
          students: sorted,
        },
      ],
      visibleStudents: sorted,
    };
  }

  const effectiveGroups = getEffectiveBookGroups(book);
  const collapsedSet = new Set(book.collapsedGroups ?? []);
  const byGroupKey = new Map<string, StudentEntity[]>();
  const unassigned: StudentEntity[] = [];

  for (const g of effectiveGroups) {
    byGroupKey.set(g.name.trim().toLowerCase(), []);
  }

  for (const st of filtered) {
    const gName = getStudentActiveGroup(st, book);
    if (!gName) {
      unassigned.push(st);
    } else {
      const k = gName.toLowerCase();
      if (!byGroupKey.has(k)) byGroupKey.set(k, []);
      byGroupKey.get(k)!.push(st);
    }
  }

  const buckets: StudentGroupBucket[] = [];
  for (const g of effectiveGroups) {
    const list = byGroupKey.get(g.name.trim().toLowerCase()) ?? [];
    // When searching, hide empty groups so search results stay focused
    if (q && list.length === 0) continue;
    const isCollapsed = collapsedSet.has(g.name);
    buckets.push({
      key: g.name,
      name: g.name,
      color: g.color,
      isUnassigned: false,
      isCollapsed,
      students: sortStudentList(list, book, tab),
    });
  }

  if (unassigned.length > 0) {
    const unassignedKey = '__unassigned__';
    buckets.push({
      key: unassignedKey,
      name: 'Sin grupo',
      color: '#E2E8F0',
      isUnassigned: true,
      isCollapsed: collapsedSet.has(unassignedKey),
      students: sortStudentList(unassigned, book, tab),
    });
  }

  const visibleStudents: StudentEntity[] = [];
  for (const b of buckets) {
    if (!b.isCollapsed) {
      visibleStudents.push(...b.students);
    }
  }

  return { groups: buckets, visibleStudents };
}

// ============================================================================
// Column Bottom Summary Rows (up to 5 customizable rows per column or global)
// ============================================================================
export const COLUMN_SUMMARY_OPTIONS: Array<{
  metric: ColumnSummaryMetric;
  label: string;
  shortLabel: string;
  symbol: string;
}> = [
  { metric: 'MEAN', label: 'Media aritmética', shortLabel: 'Media', symbol: 'x̄' },
  { metric: 'PASS_PCT', label: '% Aprobados', shortLabel: '% Aprob.', symbol: '✓' },
  { metric: 'PASS_COUNT', label: 'N.º Aprobados', shortLabel: 'Aprob.', symbol: '✓' },
  { metric: 'FAIL_COUNT', label: 'N.º Suspensos', shortLabel: 'Susp.', symbol: '✕' },
  { metric: 'FAIL_PCT', label: '% Suspensos', shortLabel: '% Susp.', symbol: '✕' },
  { metric: 'EMPTY_COUNT', label: 'Celdas vacías', shortLabel: 'Vacías', symbol: '○' },
  { metric: 'FILLED_COUNT', label: 'Celdas evaluadas', shortLabel: 'Eval.', symbol: '●' },
  { metric: 'MEDIAN', label: 'Mediana', shortLabel: 'Mediana', symbol: '~' },
  { metric: 'MAX', label: 'Nota máxima', shortLabel: 'Máx.', symbol: '↑' },
  { metric: 'MIN', label: 'Nota mínima', shortLabel: 'Mín.', symbol: '↓' },
  { metric: 'SUM', label: 'Suma total', shortLabel: 'Suma', symbol: 'Σ' },
  { metric: 'STD_DEV', label: 'Desviación típica', shortLabel: 'Desv.', symbol: 'σ' },
  { metric: 'NONE', label: 'Ocultar (vacío)', shortLabel: '—', symbol: '' },
];

export function computeColumnSummaryMetric(
  metric: ColumnSummaryMetric,
  grades: Array<number | null>,
  passThreshold: number,
  decimals = 2
): string {
  if (metric === 'NONE') return '';

  const total = grades.length;
  const vals = grades.filter((g): g is number => g !== null && !Number.isNaN(g));
  const emptyCount = total - vals.length;

  switch (metric) {
    case 'EMPTY_COUNT':
      return String(emptyCount);
    case 'FILLED_COUNT':
      return String(vals.length);
    case 'PASS_COUNT':
      return String(vals.filter((v) => v >= passThreshold).length);
    case 'FAIL_COUNT':
      return String(vals.filter((v) => v < passThreshold).length);
    case 'PASS_PCT':
      if (vals.length === 0) return '—';
      return `${Math.round((vals.filter((v) => v >= passThreshold).length / vals.length) * 100)}%`;
    case 'FAIL_PCT':
      if (vals.length === 0) return '—';
      return `${Math.round((vals.filter((v) => v < passThreshold).length / vals.length) * 100)}%`;
    case 'MEAN':
      if (vals.length === 0) return '—';
      return formatGrade(vals.reduce((a, b) => a + b, 0) / vals.length, decimals);
    case 'MEDIAN': {
      if (vals.length === 0) return '—';
      const sorted = [...vals].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const med = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return formatGrade(med, decimals);
    }
    case 'MAX':
      return vals.length === 0 ? '—' : formatGrade(Math.max(...vals), decimals);
    case 'MIN':
      return vals.length === 0 ? '—' : formatGrade(Math.min(...vals), decimals);
    case 'SUM':
      return vals.length === 0 ? '—' : formatGrade(vals.reduce((a, b) => a + b, 0), decimals);
    case 'STD_DEV': {
      if (vals.length === 0) return '—';
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / vals.length;
      return formatGrade(Math.sqrt(variance), decimals);
    }
    default:
      return '';
  }
}

/**
 * Builds the clipboard payload for copying an ENTIRE column (or folder summary column).
 * ALWAYS sorts ALL active students STRICTLY ALPHABETICALLY BY LAST NAME (Apellidos A-Z),
 * ignoring current sort mode, grouping, collapsed groups, or search filter.
 * Rubric grades are ALWAYS exported in 0-10 scale.
 */
export function buildAlphabeticalColumnCopyText(
  book: ClassBook,
  target:
    | { kind: 'COL'; col: ColumnEntity }
    | { kind: 'FOLDER'; folder: FolderEntity; childCols: ColumnEntity[] }
): { text: string; studentCount: number; nonEmptyCount: number } {
  const alphaStudents = [...book.students]
    .filter((s) => !s.isHidden)
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName, 'es') ||
        a.firstName.localeCompare(b.firstName, 'es')
    );

  let nonEmptyCount = 0;
  const lines = alphaStudents.map((st) => {
    if (target.kind === 'COL') {
      const cell = book.cells[cellKey(st.id, target.col.id)];
      const grade = cell?.grade ?? null;
      if (grade !== null) {
        nonEmptyCount += 1;
        return formatCellCopyValue(grade, target.col);
      }
      return '';
    }
    const val = computeFolderSummary(target.folder, target.childCols, st.id, book);
    if (val !== null) {
      nonEmptyCount += 1;
      return formatGrade(val, 2);
    }
    return '';
  });

  return {
    text: lines.join('\n'),
    studentCount: alphaStudents.length,
    nonEmptyCount,
  };
}

export function hasCellNumericGrade(cell: CellEntity | undefined): boolean {
  return cell?.grade !== null && cell?.grade !== undefined && !Number.isNaN(cell.grade);
}

/**
 * Returns every (activeStudent, editableColumn) coordinate without a numeric grade.
 * Text-only comments (with grade === null) are treated as ungraded.
 * Skips hidden students, AVERAGE columns, locked columns, and locked tabs.
 */
export function getEmptyGradeTargetsForColumns(
  book: ClassBook,
  columnIds: string[]
): Array<{ studentId: string; columnId: string }> {
  const uniqueIds = Array.from(new Set(columnIds.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const editableCols = new Map<string, ColumnEntity>();
  for (const tab of book.tabs ?? []) {
    if (tab.isLocked) continue;
    for (const col of tab.columns ?? []) {
      if (!col.isLocked && col.type !== 'AVERAGE') {
        editableCols.set(col.id, col);
      }
    }
  }

  const activeStudents = book.students.filter((s) => !s.isHidden);
  const targets: Array<{ studentId: string; columnId: string }> = [];

  for (const colId of uniqueIds) {
    if (!editableCols.has(colId)) continue;
    for (const st of activeStudents) {
      const cell = book.cells[cellKey(st.id, colId)];
      if (!hasCellNumericGrade(cell)) {
        targets.push({ studentId: st.id, columnId: colId });
      }
    }
  }

  return targets;
}

export function countEmptyGradesInColumns(book: ClassBook, columnIds: string[]): number {
  return getEmptyGradeTargetsForColumns(book, columnIds).length;
}

/**
 * Fills every ungraded active-student cell in the specified editable columns with
 * grade `0` (clamped to column bounds) and comment `"NP"` ("No presentado").
 * Cells that already have a numeric grade are left untouched; cells with text
 * only (`grade === null`) ARE filled.
 */
export function fillColumnsEmptyWithNP(
  book: ClassBook,
  columnIds: string[],
  rubrics: RubricEntity[]
): {
  book: ClassBook;
  filledCount: number;
  affectedColumnCount: number;
  firstTarget: { studentId: string; columnId: string } | null;
} {
  const targets = getEmptyGradeTargetsForColumns(book, columnIds);
  if (targets.length === 0) {
    return { book, filledCount: 0, affectedColumnCount: 0, firstTarget: null };
  }

  const colMap = new Map<string, ColumnEntity>();
  for (const tab of book.tabs ?? []) {
    for (const col of tab.columns ?? []) {
      colMap.set(col.id, col);
    }
  }

  const nextCells: Record<string, CellEntity> = { ...book.cells };
  const affectedCols = new Set<string>();
  let filledCount = 0;

  for (const { studentId, columnId } of targets) {
    const col = colMap.get(columnId);
    if (!col) continue;
    const k = cellKey(studentId, columnId);
    const prev = nextCells[k];
    const zeroGrade = clampGradeForColumn(0, col) ?? 0;

    if (col.type === 'RUBRIC') {
      nextCells[k] = {
        grade: zeroGrade,
        comment: 'NP',
        rubricEval: prev?.rubricEval,
        manualOverride: true,
      };
    } else {
      nextCells[k] = {
        ...prev,
        grade: zeroGrade,
        comment: 'NP',
        pendingAdjustment: undefined,
      };
    }

    affectedCols.add(columnId);
    filledCount += 1;
  }

  if (filledCount === 0) {
    return { book, filledCount: 0, affectedColumnCount: 0, firstTarget: null };
  }

  return {
    book: recalculateBook({ ...book, cells: nextCells }, rubrics),
    filledCount,
    affectedColumnCount: affectedCols.size,
    firstTarget: targets[0] ?? null,
  };
}



