import { describe, expect, it } from 'vitest';
import { createSeedWorkspace, DEFAULT_RUBRICS } from '../../data/seedData';
import {
  buildAlphabeticalColumnCopyText,
  computeColumnSummaryMetric,
  computeFolderSummary,
  computeRubricPercentage,
  computeRubricScore,
  ensureGroupCategories,
  exportStudentList,
  formatCellCopyValue,
  formatCellDisplayGrade,
  getEffectiveBookGroups,
  getStudentActiveGroup,
  migrateRedundantFolderAverageColumns,
  normalizeRubricLevels,
  organizeStudentsForGrid,
  parseLiveMixedInput,
  parseMixedInput,
  parseStudentList,
  recalculateBook,
  resolveCellColors,
  shouldRenderVerticalHeader,
} from '../gradeMath';
import { cellKey, type ColumnEntity, type FolderEntity } from '../../types/gradebook';

describe('Mixed Grade & Comment Input Parser', () => {
  it('parses standalone numeric grades with dot or comma', () => {
    expect(parseMixedInput('8.5')).toEqual({ grade: 8.5, comment: '' });
    expect(parseMixedInput('7,25')).toEqual({ grade: 7.25, comment: '' });
  });

  it('separates leading grade and trailing text comment cleanly', () => {
    expect(parseMixedInput('8.5 buen trabajo')).toEqual({
      grade: 8.5,
      comment: 'buen trabajo',
    });
    expect(parseMixedInput('7,25 falta ejercicio 2')).toEqual({
      grade: 7.25,
      comment: 'falta ejercicio 2',
    });
  });

  it('separates leading text and trailing grade cleanly', () => {
    expect(parseMixedInput('muy bien 9.5')).toEqual({
      grade: 9.5,
      comment: 'muy bien',
    });
  });

  it('parses pure text as comment with null grade', () => {
    expect(parseMixedInput('pendiente de revisión')).toEqual({
      grade: null,
      comment: 'pendiente de revisión',
    });
    expect(parseMixedInput('   ')).toEqual({ grade: null, comment: '' });
  });
});

describe('Weighted Averages, Cross-Tab Chaining, Rubrics & Folders', () => {
  it('computes weighted averages and chained cross-tab averages while ignoring comments', () => {
    const ws = createSeedWorkspace();
    const book = ws.classes[0];
    const st1 = book.students[0];

    // Student 0: cuad 9.5 (15%), red 9.0 (15%), rub ~9.5 (20%), ex1 9.25 (20%), ex2 8.75 (30%)
    const media1 = book.cells[cellKey(st1.id, 'c1-col-media1')]?.grade;
    expect(media1).toBeCloseTo(9.15, 2);

    // Chained Media Global Curso on tab 2 references Media 1ª Ev (50%) + t2act (20%) + t2ex (30%)
    const mediaGlobal = book.cells[cellKey(st1.id, 'c1-col-media-final')]?.grade;
    expect(mediaGlobal).not.toBeNull();
    expect(mediaGlobal!).toBeGreaterThan(8);
  });

  it('recomputes rubric scores accurately when selections update', () => {
    const rubric = DEFAULT_RUBRICS[0];
    const score = computeRubricScore(rubric, {
      rubricId: rubric.id,
      selections: {
        'crit-exp-1': { levelId: 'lvl-4' }, // 100% * 35
        'crit-exp-2': { levelId: 'lvl-3' }, // 80% * 40
        'crit-exp-3': { levelId: 'lvl-2' }, // 55% * 25
      },
    });
    // (35 + 32 + 13.75) / 100 * 10 = 8.075 -> 8.08
    expect(score).toBe(8.08);
  });

  it('ignores comment-only cells during average computation', () => {
    const ws = createSeedWorkspace();
    const book = structuredClone(ws.classes[0]);
    const st1 = book.students[0];
    // Replace Cuaderno with comment-only cell
    book.cells[cellKey(st1.id, 'c1-col-cuad')] = { grade: null, comment: 'Justificante' };
    const updated = recalculateBook(book, ws.rubrics);
    const media = updated.cells[cellKey(st1.id, 'c1-col-media1')]?.grade;
    expect(media).not.toBeNull();
    expect(Number.isNaN(media!)).toBe(false);
  });

  it('computes collapsed folder summaries for all modes', () => {
    const ws = createSeedWorkspace();
    const book = ws.classes[0];
    const st1 = book.students[0];
    const folderCols = book.tabs[0].columns.filter((c) => c.folderId === 'c1-fld-diario');
    const baseFolder: FolderEntity = {
      id: 'c1-fld-diario',
      title: 'Trabajo Diario',
      color: '#DCFCE7',
      orderIndex: 0,
      isCollapsed: true,
      summaryMode: 'ARITHMETIC_MEAN',
      ignoreEmpty: true,
    };

    expect(computeFolderSummary({ ...baseFolder, summaryMode: 'ARITHMETIC_MEAN' }, folderCols, st1.id, book)).toBe(9.25);
    expect(computeFolderSummary({ ...baseFolder, summaryMode: 'SUM' }, folderCols, st1.id, book)).toBe(18.5);
    expect(computeFolderSummary({ ...baseFolder, summaryMode: 'MAX' }, folderCols, st1.id, book)).toBe(9.5);
    expect(computeFolderSummary({ ...baseFolder, summaryMode: 'MIN' }, folderCols, st1.id, book)).toBe(9.0);
  });

  it('respects colorMode NONE, TEXT_ONLY, and CELL_BG: colors ONLY < 5 (pastel red) and < 6 (pastel orange), leaving >= 6 uncolored', () => {
    const col: ColumnEntity = {
      id: 'col-1',
      folderId: null,
      title: 'Test',
      color: '#DBEAFE',
      width: 110,
      orderIndex: 0,
      type: 'NUMERIC',
      minValue: 0,
      maxValue: 10,
      decimals: 2,
      passThreshold: 5,
      colorMode: 'NONE',
    };

    expect(resolveCellColors(3.0, { ...col, colorMode: 'NONE' })).toEqual({});
    expect(resolveCellColors(8.5, { ...col, colorMode: 'TEXT_ONLY' })).toEqual({});
    expect(resolveCellColors(6.0, { ...col, colorMode: 'CELL_BG' })).toEqual({});

    const textFail = resolveCellColors(4.2, { ...col, colorMode: 'TEXT_ONLY' });
    expect(textFail).toEqual({ textColor: '#DC2626' });

    const textWarn = resolveCellColors(5.5, { ...col, colorMode: 'TEXT_ONLY' });
    expect(textWarn).toEqual({ textColor: '#EA580C' });

    const bgFail = resolveCellColors(3.0, { ...col, colorMode: 'CELL_BG' });
    expect(bgFail).toEqual({ textColor: '#7F1D1D', bgColor: '#FCA5A5' });

    const bgWarn = resolveCellColors(5.87, { ...col, colorMode: 'CELL_BG' });
    expect(bgWarn).toEqual({ textColor: '#9A3412', bgColor: '#FED7AA' });
  });

  it('displays rubrics converted to 0-10 by default, supports % when no-convert is enabled, and ALWAYS copies 0-10', () => {
    const rubric = DEFAULT_RUBRICS[0];
    const evalData = {
      rubricId: rubric.id,
      selections: {
        'crit-exp-1': { levelId: 'lvl-4' }, // 100% * 35
        'crit-exp-2': { levelId: 'lvl-3' }, // 80% * 40
        'crit-exp-3': { levelId: 'lvl-2' }, // 55% * 25
      },
    };
    const pct = computeRubricPercentage(rubric, evalData);
    const score = computeRubricScore(rubric, evalData);
    expect(pct).toBe(80.75);
    expect(score).toBe(8.08);

    const rubricCol: ColumnEntity = {
      id: 'col-rub',
      folderId: null,
      title: 'Rúbrica Test',
      color: '#EDE9FE',
      width: 120,
      orderIndex: 0,
      type: 'RUBRIC',
      minValue: 0,
      maxValue: 10,
      decimals: 2,
      passThreshold: 5,
      colorMode: 'NONE',
      rubricId: rubric.id,
      rubricShowPercentage: false,
    };

    // Default: converted 0-10
    expect(formatCellDisplayGrade(score, rubricCol, false)).toBe('8.08');
    // "No convertir" enabled: shows %
    expect(formatCellDisplayGrade(score, rubricCol, true)).toBe('80.8%');
    expect(formatCellDisplayGrade(8.4, rubricCol, true)).toBe('84%');
    // Copying ALWAYS outputs 0-10, never %
    expect(formatCellCopyValue(score, rubricCol)).toBe('8.08');
    expect(formatCellCopyValue(8.4, { ...rubricCol, rubricShowPercentage: true })).toBe('8.40');
  });

  it('parses NP as grade 0 with comment NP and splits live mixed typing cleanly', () => {
    expect(parseMixedInput('NP')).toEqual({ grade: 0, comment: 'NP' });
    expect(parseMixedInput('np')).toEqual({ grade: 0, comment: 'NP' });

    expect(parseLiveMixedInput('8.')).toEqual({
      gradeText: '8.',
      commentText: '',
      activePart: 'GRADE',
    });
    expect(parseLiveMixedInput('8.5 buen trabajo')).toEqual({
      gradeText: '8.5',
      commentText: 'buen trabajo',
      activePart: 'COMMENT',
    });
    expect(parseLiveMixedInput('falta entregar')).toEqual({
      gradeText: '',
      commentText: 'falta entregar',
      activePart: 'COMMENT',
    });
  });

  it('orders rubric levels from highest (left, pastel green) to lowest (right, pastel red) automatically', () => {
    const normalized = normalizeRubricLevels([
      { id: 'l0', title: 'Bajo', percentage: 0, color: '#000' },
      { id: 'l100', title: 'Alto', percentage: 100, color: '#000' },
      { id: 'l50', title: 'Medio', percentage: 50, color: '#000' },
    ]);
    expect(normalized.map((l) => l.percentage)).toEqual([100, 50, 0]);
    // Leftmost is green-dominant, rightmost is red-dominant
    const hexRgb = (hex: string) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const [rHigh, gHigh] = hexRgb(normalized[0].color);
    const [rLow, gLow] = hexRgb(normalized[2].color);
    expect(gHigh).toBeGreaterThan(rHigh);
    expect(rLow).toBeGreaterThan(gLow);
  });

  it('preserves manualOverride grades on RUBRIC cells during recalculateBook', () => {
    const ws = createSeedWorkspace();
    const book = structuredClone(ws.classes[0]);
    const st1 = book.students[0];
    const rubCol = book.tabs[0].columns.find((c) => c.type === 'RUBRIC')!;
    const k = cellKey(st1.id, rubCol.id);
    book.cells[k] = {
      ...book.cells[k],
      grade: 5.0,
      comment: 'Ajuste manual',
      manualOverride: true,
    };
    const recalculated = recalculateBook(book, ws.rubrics);
    expect(recalculated.cells[k]?.grade).toBe(5.0);
    expect(recalculated.cells[k]?.manualOverride).toBe(true);
    expect(recalculated.cells[k]?.comment).toBe('Ajuste manual');
  });

  it('parses bulk student lists formatted as "Apellidos, Nombre" and variations', () => {
    const raw = `
      1. García López, Juan (1ºA)
      Martínez Soler, María
      - Pérez Gómez, Alejandro
      Ruiz, Ana
      Carlos Santos
    `;
    const parsed = parseStudentList(raw);
    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toEqual({
      firstName: 'Juan',
      lastName: 'García López',
      group: '1ºA',
      raw: '1. García López, Juan (1ºA)',
    });
    expect(parsed[1]).toEqual({
      firstName: 'María',
      lastName: 'Martínez Soler',
      group: undefined,
      raw: 'Martínez Soler, María',
    });
    expect(parsed[2]).toEqual({
      firstName: 'Alejandro',
      lastName: 'Pérez Gómez',
      group: undefined,
      raw: '- Pérez Gómez, Alejandro',
    });
    expect(parsed[3]).toEqual({
      firstName: 'Ana',
      lastName: 'Ruiz',
      group: undefined,
      raw: 'Ruiz, Ana',
    });
    // Fallback space separated: first word is name, rest is surname
    expect(parsed[4]).toEqual({
      firstName: 'Carlos',
      lastName: 'Santos',
      group: undefined,
      raw: 'Carlos Santos',
    });
  });

  it('exports students list as "Apellidos, Nombre"', () => {
    const students = [
      { id: '1', firstName: 'Juan', lastName: 'García López', tags: [], orderIndex: 0 },
      { id: '2', firstName: 'María', lastName: 'Soler', tags: [], orderIndex: 1 },
    ];
    const exported = exportStudentList(students);
    expect(exported).toBe('García López, Juan\nSoler, María');
  });

  it('sorts students across LAST_ASC, LAST_DESC, FIRST_ASC, FIRST_DESC, GROUP_ASC, GRADE_DESC, GRADE_ASC and MANUAL', () => {
    const ws = createSeedWorkspace();
    const base = structuredClone(ws.classes[0]);
    const tab = base.tabs[0];

    // Clear existing seed groups and tag custom ones
    base.students.forEach((s) => {
      s.group = undefined;
    });
    base.students[0].group = 'Mesa B';
    base.students[1].group = 'Mesa A';
    base.students[2].group = '';

    // LAST_DESC starts at Z
    base.sortMode = 'LAST_DESC';
    const descLast = organizeStudentsForGrid(base, tab, '').visibleStudents;
    expect(descLast[0].lastName.localeCompare(descLast[descLast.length - 1].lastName, 'es')).toBeGreaterThan(0);

    // FIRST_ASC vs FIRST_DESC
    base.sortMode = 'FIRST_ASC';
    const firstAsc = organizeStudentsForGrid(base, tab, '').visibleStudents;
    base.sortMode = 'FIRST_DESC';
    const firstDesc = organizeStudentsForGrid(base, tab, '').visibleStudents;
    expect(firstAsc[0].id).toBe(firstDesc[firstDesc.length - 1].id);

    // GROUP_ASC places Mesa A before Mesa B and unassigned at the end
    base.sortMode = 'GROUP_ASC';
    const byGrp = organizeStudentsForGrid(base, tab, '').visibleStudents;
    expect(byGrp[0].group).toBe('Mesa A');
    expect(byGrp[1].group).toBe('Mesa B');
    expect(byGrp[byGrp.length - 1].group ?? '').toBe('');

    // GRADE_DESC places highest-grade student first
    base.sortMode = 'GRADE_DESC';
    const gradeDesc = organizeStudentsForGrid(base, tab, '').visibleStudents;
    base.sortMode = 'GRADE_ASC';
    const gradeAsc = organizeStudentsForGrid(base, tab, '').visibleStudents;
    expect(gradeDesc[0].id).not.toBe(gradeAsc[0].id);
  });

  it('partitions students by custom and ad-hoc groups when groupByGroups is enabled and respects collapsedGroups', () => {
    const ws = createSeedWorkspace();
    const book = structuredClone(ws.classes[0]);
    book.groups = [
      { id: 'g1', name: 'Equipo Rojo', color: '#FFE4E6', orderIndex: 0 },
      { id: 'g2', name: 'Equipo Azul', color: '#DBEAFE', orderIndex: 1 },
    ];
    book.students.forEach((s, idx) => {
      if (idx < 2) s.group = 'Equipo Azul';
      else if (idx === 2) s.group = 'Equipo Rojo';
      else if (idx === 3) s.group = 'Refuerzo'; // ad-hoc group
      else s.group = undefined;
    });
    book.groupByGroups = true;

    const effective = getEffectiveBookGroups(book);
    expect(effective.map((g) => g.name)).toEqual(['Equipo Rojo', 'Equipo Azul', 'Refuerzo']);

    const organized = organizeStudentsForGrid(book, book.tabs[0], '');
    expect(organized.groups.map((g) => g.name)).toEqual([
      'Equipo Rojo',
      'Equipo Azul',
      'Refuerzo',
      'Sin grupo',
    ]);
    expect(organized.groups[0].students).toHaveLength(1);
    expect(organized.groups[1].students).toHaveLength(2);
    expect(organized.visibleStudents).toHaveLength(book.students.length);

    // Collapsing Equipo Azul hides its 2 students from visibleStudents (keyboard nav skips them)
    book.collapsedGroups = ['Equipo Azul'];
    const collapsed = organizeStudentsForGrid(book, book.tabs[0], '');
    expect(collapsed.visibleStudents).toHaveLength(book.students.length - 2);
  });

  it('auto-switches column titles to vertical when narrow or when title cannot fit horizontally', () => {
    expect(shouldRenderVerticalHeader('TD', 44)).toBe(true);
    expect(shouldRenderVerticalHeader('Participación', 82)).toBe(true);
    expect(shouldRenderVerticalHeader('Prueba Inicial', 120)).toBe(false);
    expect(shouldRenderVerticalHeader('Nota', 140, 'VERTICAL')).toBe(true);
  });

  it('supports multiple independent group categories per class', () => {
    const ws = createSeedWorkspace();
    const book = structuredClone(ws.classes[0]);
    const seeded = ensureGroupCategories(book);
    expect(seeded.categories).toHaveLength(1);

    const st0 = book.students[0];
    const st1 = book.students[1];
    book.groupCategories = [
      seeded.categories[0],
      {
        id: 'cat-proyecto',
        name: 'Equipos Proyecto',
        groups: [
          { id: 'gp-1', name: 'Alfa', color: '#DBEAFE', orderIndex: 0 },
          { id: 'gp-2', name: 'Beta', color: '#FCE7F3', orderIndex: 1 },
        ],
        assignments: {
          [st0.id]: 'Alfa',
          [st1.id]: 'Beta',
        },
      },
    ];
    book.activeGroupCategoryId = 'cat-proyecto';
    book.groupByGroups = true;

    expect(getStudentActiveGroup(st0, book)).toBe('Alfa');
    expect(getStudentActiveGroup(st1, book)).toBe('Beta');
    const org = organizeStudentsForGrid(book, book.tabs[0], '');
    expect(org.groups.map((g) => g.name)).toEqual(['Alfa', 'Beta', 'Sin grupo']);
    expect(org.groups[0].students.map((s) => s.id)).toEqual([st0.id]);
    expect(org.groups[1].students.map((s) => s.id)).toEqual([st1.id]);

    // Switching back to the first category restores original grouping without data loss
    book.activeGroupCategoryId = seeded.categories[0].id;
    expect(getStudentActiveGroup(st0, book)).not.toBe('Alfa');
  });

  it('computes all bottom summary row metrics accurately', () => {
    const vals = [8, 6, 4, null, 10, null];
    expect(computeColumnSummaryMetric('MEAN', vals, 5, 2)).toBe('7.00');
    expect(computeColumnSummaryMetric('MEDIAN', vals, 5, 2)).toBe('7.00');
    expect(computeColumnSummaryMetric('PASS_COUNT', vals, 5, 2)).toBe('3');
    expect(computeColumnSummaryMetric('PASS_PCT', vals, 5, 2)).toBe('75%');
    expect(computeColumnSummaryMetric('FAIL_COUNT', vals, 5, 2)).toBe('1');
    expect(computeColumnSummaryMetric('FAIL_PCT', vals, 5, 2)).toBe('25%');
    expect(computeColumnSummaryMetric('MAX', vals, 5, 2)).toBe('10.00');
    expect(computeColumnSummaryMetric('MIN', vals, 5, 2)).toBe('4.00');
    expect(computeColumnSummaryMetric('EMPTY_COUNT', vals, 5, 2)).toBe('2');
    expect(computeColumnSummaryMetric('FILLED_COUNT', vals, 5, 2)).toBe('4');
    expect(computeColumnSummaryMetric('SUM', vals, 5, 2)).toBe('28.00');
    expect(computeColumnSummaryMetric('STD_DEV', vals, 5, 2)).toBe('2.24');
    expect(computeColumnSummaryMetric('NONE', vals, 5, 2)).toBe('');
  });

  it('ALWAYS copies an entire column or folder in strict alphabetical order by Apellidos (even when sorted by grade or grouped & collapsed) and converts rubrics to 0-10', () => {
    const ws = createSeedWorkspace();
    const book = structuredClone(ws.classes[0]);
    book.sortMode = 'GRADE_DESC';
    book.groupByGroups = true;
    book.collapsedGroups = ['Grupo A', 'Grupo B'];

    const tab = book.tabs[0];
    const rubCol = tab.columns.find((c) => c.type === 'RUBRIC')!;
    rubCol.rubricShowPercentage = true; // even with % display on, copy MUST be 0-10

    const alphaStudents = [...book.students]
      .filter((s) => !s.isHidden)
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'es') || a.firstName.localeCompare(b.firstName, 'es'));

    const expectedRubricLines = alphaStudents.map((st) => {
      const g = book.cells[cellKey(st.id, rubCol.id)]?.grade;
      return g !== null && g !== undefined ? g.toFixed(rubCol.decimals) : '';
    });

    const copiedCol = buildAlphabeticalColumnCopyText(book, { kind: 'COL', col: rubCol });
    expect(copiedCol.studentCount).toBe(alphaStudents.length);
    expect(copiedCol.text.split('\n')).toEqual(expectedRubricLines);
    expect(copiedCol.text).not.toContain('%');

    // Folder summary column also copies strictly alphabetically
    const folder = tab.folders[0];
    const folderCols = tab.columns.filter((c) => c.folderId === folder.id);
    const copiedFolder = buildAlphabeticalColumnCopyText(book, {
      kind: 'FOLDER',
      folder,
      childCols: folderCols,
    });
    expect(copiedFolder.studentCount).toBe(alphaStudents.length);
    const expectedFolderLines = alphaStudents.map((st) => {
      const g = computeFolderSummary(folder, folderCols, st.id, book);
      return g !== null ? g.toFixed(2) : '';
    });
    expect(copiedFolder.text.split('\n')).toEqual(expectedFolderLines);
  });

  it('migrates redundant in-folder Media AVERAGE columns and keeps downstream Nota Ev. identical via direct folder references', () => {
    const ws = createSeedWorkspace();
    const book = structuredClone(ws.classes[0]);
    const tab = book.tabs[0];
    const diarioFolder = tab.folders.find((f) => f.id === 'c1-fld-diario')!;
    const diarioChildren = tab.columns.filter((c) => c.folderId === diarioFolder.id);

    // Add a redundant in-folder "Media Trabajo Diario" column + a downstream "Nota Ev." referencing it
    tab.columns.push(
      {
        id: 'col-media-diario',
        folderId: diarioFolder.id,
        title: 'Media Trabajo Diario',
        color: diarioFolder.color,
        width: 90,
        orderIndex: 99,
        type: 'AVERAGE',
        minValue: 0,
        maxValue: 10,
        decimals: 2,
        passThreshold: 5,
        colorMode: 'NONE',
        averageConfig: {
          sourceColumnIds: diarioChildren.map((c) => c.id),
          weights: Object.fromEntries(diarioChildren.map((c) => [c.id, 50])),
          ignoreEmpty: true,
        },
      },
      {
        id: 'col-nota-ev-test',
        folderId: null,
        title: 'Nota Ev.',
        color: '#FEF9C3',
        width: 100,
        orderIndex: 100,
        type: 'AVERAGE',
        minValue: 0,
        maxValue: 10,
        decimals: 2,
        passThreshold: 5,
        colorMode: 'NONE',
        averageConfig: {
          sourceColumnIds: ['col-media-diario'],
          weights: { 'col-media-diario': 100 },
          ignoreEmpty: true,
        },
      }
    );

    const beforeRecalc = recalculateBook(book, ws.rubrics);
    const beforeGrades = beforeRecalc.students.map(
      (s) => beforeRecalc.cells[cellKey(s.id, 'col-nota-ev-test')]?.grade ?? null
    );

    const { book: migrated, removedCount } = migrateRedundantFolderAverageColumns(beforeRecalc);
    expect(removedCount).toBe(1);
    expect(migrated.tabs[0].columns.some((c) => c.id === 'col-media-diario')).toBe(false);

    const notaEvCol = migrated.tabs[0].columns.find((c) => c.id === 'col-nota-ev-test')!;
    expect(notaEvCol.averageConfig?.sourceColumnIds).toEqual([diarioFolder.id]);
    expect(notaEvCol.averageConfig?.weights[diarioFolder.id]).toBe(100);

    const afterRecalc = recalculateBook(migrated, ws.rubrics);
    const afterGrades = afterRecalc.students.map(
      (s) => afterRecalc.cells[cellKey(s.id, 'col-nota-ev-test')]?.grade ?? null
    );
    expect(afterGrades).toEqual(beforeGrades);
  });
});
