import { recalculateBook } from '../engine/gradeMath';
import {
  cellKey,
  type CellEntity,
  type ClassBook,
  type GradebookWorkspace,
  type RubricEntity,
  type StudentEntity,
} from '../types/gradebook';

export const DEFAULT_RUBRICS: RubricEntity[] = [
  {
    id: 'rub-exposicion',
    title: 'Rúbrica: Exposición Oral',
    description: 'Evalúa claridad expositiva, rigor del contenido y apoyo visual.',
    minScore: 0,
    maxScore: 10,
    decimals: 2,
    levels: [
      { id: 'lvl-1', title: 'Insuficiente', percentage: 25, color: '#FECDD3' },
      { id: 'lvl-2', title: 'Suficiente', percentage: 55, color: '#FEF3C7' },
      { id: 'lvl-3', title: 'Notable', percentage: 80, color: '#DBEAFE' },
      { id: 'lvl-4', title: 'Sobresaliente', percentage: 100, color: '#DCFCE7' },
    ],
    criteria: [
      { id: 'crit-exp-1', title: 'Claridad y fluidez oral', weight: 35 },
      { id: 'crit-exp-2', title: 'Dominio y rigor del tema', weight: 40 },
      { id: 'crit-exp-3', title: 'Material visual y estructura', weight: 25 },
    ],
    descriptors: {
      'crit-exp-1::lvl-1': 'Lee casi todo el guion; tono monótono o pausas constantes.',
      'crit-exp-1::lvl-2': 'Se expresa de forma comprensible, con apoyo frecuente en notas.',
      'crit-exp-1::lvl-3': 'Discurso fluido, buen ritmo y contacto visual con el aula.',
      'crit-exp-1::lvl-4': 'Comunicación muy segura, natural, expresiva y convincente.',
      'crit-exp-2::lvl-1': 'Contenidos incompletos o con errores conceptuales básicos.',
      'crit-exp-2::lvl-2': 'Explica las ideas principales de manera general y correcta.',
      'crit-exp-2::lvl-3': 'Domina el tema y aporta ejemplos pertinentes.',
      'crit-exp-2::lvl-4': 'Rigor excelente; responde preguntas con soltura y profundidad.',
      'crit-exp-3::lvl-1': 'Sin apoyo visual o diapositivas saturadas de texto.',
      'crit-exp-3::lvl-2': 'Presentación ordenada con algún recurso gráfico básico.',
      'crit-exp-3::lvl-3': 'Diseño limpio, esquemático y bien sincronizado con la charla.',
      'crit-exp-3::lvl-4': 'Soporte visual muy atractivo, claro y sintetizado con criterio.',
    },
  },
  {
    id: 'rub-proyecto',
    title: 'Rúbrica: Proyecto Práctico',
    description: 'Valoración del proceso de trabajo, producto final y autonomía.',
    minScore: 0,
    maxScore: 10,
    decimals: 2,
    levels: [
      { id: 'lvl-1', title: 'Inicial', percentage: 25, color: '#FECDD3' },
      { id: 'lvl-2', title: 'En desarrollo', percentage: 55, color: '#FEF3C7' },
      { id: 'lvl-3', title: 'Avanzado', percentage: 80, color: '#DBEAFE' },
      { id: 'lvl-4', title: 'Experto', percentage: 100, color: '#DCFCE7' },
    ],
    criteria: [
      { id: 'crit-pro-1', title: 'Planificación y seguimiento', weight: 30 },
      { id: 'crit-pro-2', title: 'Calidad técnica del producto', weight: 45 },
      { id: 'crit-pro-3', title: 'Originalidad y reflexión final', weight: 25 },
    ],
    descriptors: {
      'crit-pro-1::lvl-1': 'Entrega incompleta o fuera de plazo sin seguimiento previo.',
      'crit-pro-1::lvl-2': 'Cumple las fases básicas con supervisión docente.',
      'crit-pro-1::lvl-3': 'Organiza el trabajo en plazo y revisa avances.',
      'crit-pro-1::lvl-4': 'Planificación autónoma impecable y mejoras continuas.',
      'crit-pro-2::lvl-1': 'Presenta fallos importantes de acabado o funcionamiento.',
      'crit-pro-2::lvl-2': 'Producto funcional y correcto en lo esencial.',
      'crit-pro-2::lvl-3': 'Buen acabado, preciso y bien documentado.',
      'crit-pro-2::lvl-4': 'Calidad sobresaliente en detalle técnico y presentación.',
      'crit-pro-3::lvl-1': 'Propuesta muy básica o poco personal.',
      'crit-pro-3::lvl-2': 'Aporta algún detalle propio sobre el modelo estándar.',
      'crit-pro-3::lvl-3': 'Enfoque creativo bien justificado.',
      'crit-pro-3::lvl-4': 'Propuesta muy original acompañada de autoevaluación crítica.',
    },
  },
];

function mkStudents(prefix: string, list: [string, string, string?, string[]?][]): StudentEntity[] {
  return list.map(([firstName, lastName, group, tags], idx) => ({
    id: `${prefix}-st-${idx + 1}`,
    firstName,
    lastName,
    group: group ?? 'General',
    tags: tags ?? [],
    orderIndex: idx,
    isHidden: false,
  }));
}

export function createSeedWorkspace(): GradebookWorkspace {
  const rubrics = structuredClone(DEFAULT_RUBRICS);

  // =====================================================================
  // CLASE 1: 3.º ESO A — Lengua y Literatura
  // =====================================================================
  const c1Students = mkStudents('c1', [
    ['Lucía', 'Alonso Martín', 'Grupo A', ['Delegada']],
    ['Mateo', 'Blanco Serrano', 'Grupo A'],
    ['Sofía', 'Castro Domínguez', 'Grupo B', ['Participativa']],
    ['Hugo', 'Delgado Ruiz', 'Grupo B'],
    ['Valeria', 'Fernández Gil', 'Grupo A'],
    ['Daniel', 'Gómez Navarro', 'Grupo B', ['Seguimiento']],
    ['Carmen', 'Herrera Morales', 'Grupo A'],
  ]);

  const c1Cells: Record<string, CellEntity> = {};
  const setC1 = (
    stIdx: number,
    colId: string,
    grade: number | null,
    comment = '',
    rubricSel?: Record<string, string>
  ) => {
    const stId = c1Students[stIdx].id;
    c1Cells[cellKey(stId, colId)] = {
      grade,
      comment,
      rubricEval: rubricSel
        ? {
            rubricId: 'rub-exposicion',
            selections: Object.fromEntries(
              Object.entries(rubricSel).map(([k, lvl]) => [k, { levelId: lvl }])
            ),
          }
        : undefined,
    };
  };

  // Valores iniciales coherentes (notas + comentarios separados)
  const sampleC1Data: Array<{
    st: number;
    cuad: [number | null, string];
    red: [number | null, string];
    rub: Record<string, string>;
    rubCom?: string;
    ex1: [number | null, string];
    ex2: [number | null, string];
    t2Act: [number | null, string];
    t2Ex: [number | null, string];
  }> = [
    {
      st: 0,
      cuad: [9.5, 'Muy ordenado'],
      red: [9.0, ''],
      rub: { 'crit-exp-1': 'lvl-4', 'crit-exp-2': 'lvl-4', 'crit-exp-3': 'lvl-3' },
      rubCom: 'Excelente entonación',
      ex1: [9.25, ''],
      ex2: [8.75, ''],
      t2Act: [9.2, ''],
      t2Ex: [9.0, ''],
    },
    {
      st: 1,
      cuad: [7.5, ''],
      red: [8.0, 'Buen vocabulario'],
      rub: { 'crit-exp-1': 'lvl-3', 'crit-exp-2': 'lvl-3', 'crit-exp-3': 'lvl-3' },
      ex1: [6.8, ''],
      ex2: [7.4, ''],
      t2Act: [7.8, ''],
      t2Ex: [7.1, ''],
    },
    {
      st: 2,
      cuad: [8.5, 'Entrega puntual'],
      red: [8.75, ''],
      rub: { 'crit-exp-1': 'lvl-4', 'crit-exp-2': 'lvl-3', 'crit-exp-3': 'lvl-4' },
      ex1: [8.1, ''],
      ex2: [8.5, ''],
      t2Act: [8.6, ''],
      t2Ex: [8.4, ''],
    },
    {
      st: 3,
      cuad: [3.5, 'Faltan ejercicios'],
      red: [4.2, 'Revisar tildes'],
      rub: { 'crit-exp-1': 'lvl-2', 'crit-exp-2': 'lvl-1', 'crit-exp-3': 'lvl-2' },
      ex1: [3.8, ''],
      ex2: [4.5, 'Mejora leve'],
      t2Act: [5.0, ''],
      t2Ex: [4.75, ''],
    },
    {
      st: 4,
      cuad: [6.5, ''],
      red: [7.0, ''],
      rub: { 'crit-exp-1': 'lvl-3', 'crit-exp-2': 'lvl-2', 'crit-exp-3': 'lvl-3' },
      ex1: [5.9, ''],
      ex2: [6.4, ''],
      t2Act: [6.8, ''],
      t2Ex: [6.2, ''],
    },
    {
      st: 5,
      cuad: [null, 'Pendiente revisión'],
      red: [4.8, 'Entrega con retraso'],
      rub: { 'crit-exp-1': 'lvl-2', 'crit-exp-2': 'lvl-2', 'crit-exp-3': 'lvl-1' },
      ex1: [4.1, ''],
      ex2: [5.2, ''],
      t2Act: [5.4, ''],
      t2Ex: [4.9, ''],
    },
    {
      st: 6,
      cuad: [8.25, ''],
      red: [7.9, ''],
      rub: { 'crit-exp-1': 'lvl-3', 'crit-exp-2': 'lvl-4', 'crit-exp-3': 'lvl-3' },
      ex1: [8.6, ''],
      ex2: [8.9, ''],
      t2Act: [8.5, ''],
      t2Ex: [8.7, ''],
    },
  ];

  for (const row of sampleC1Data) {
    setC1(row.st, 'c1-col-cuad', row.cuad[0], row.cuad[1]);
    setC1(row.st, 'c1-col-red', row.red[0], row.red[1]);
    setC1(row.st, 'c1-col-rub', null, row.rubCom ?? '', row.rub);
    setC1(row.st, 'c1-col-ex1', row.ex1[0], row.ex1[1]);
    setC1(row.st, 'c1-col-ex2', row.ex2[0], row.ex2[1]);
    setC1(row.st, 'c1-col-t2act', row.t2Act[0], row.t2Act[1]);
    setC1(row.st, 'c1-col-t2ex', row.t2Ex[0], row.t2Ex[1]);
  }

  let class1: ClassBook = {
    id: 'cls-lengua-3a',
    name: '3.º ESO A',
    subject: 'Lengua y Literatura',
    year: '2026-2027',
    color: '#3B82F6',
    passThreshold: 5,
    sortMode: 'LAST_ASC',
    students: c1Students,
    tabs: [
      {
        id: 'c1-tab-1',
        title: '1.ª Evaluación',
        color: '#DCFCE7',
        orderIndex: 0,
        folders: [
          {
            id: 'c1-fld-diario',
            title: 'Trabajo Diario',
            color: '#DCFCE7',
            orderIndex: 0,
            isCollapsed: false,
            summaryMode: 'ARITHMETIC_MEAN',
            ignoreEmpty: true,
          },
          {
            id: 'c1-fld-pruebas',
            title: 'Pruebas y Oral',
            color: '#FFE4E6',
            orderIndex: 1,
            isCollapsed: false,
            summaryMode: 'WEIGHTED_MEAN',
            ignoreEmpty: true,
          },
        ],
        columns: [
          {
            id: 'c1-col-cuad',
            folderId: 'c1-fld-diario',
            title: 'Cuaderno y Tareas',
            description: 'Revisión periódica de actividades diarias',
            date: '14/10',
            color: '#FFFFFF',
            width: 122,
            orderIndex: 0,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c1-col-red',
            folderId: 'c1-fld-diario',
            title: 'Comentario Texto',
            date: '28/10',
            color: '#FFFFFF',
            width: 122,
            orderIndex: 1,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c1-col-rub',
            folderId: 'c1-fld-pruebas',
            title: 'Exposición (Rúbrica)',
            date: '08/11',
            color: '#FFFFFF',
            width: 128,
            orderIndex: 2,
            type: 'RUBRIC',
            rubricId: 'rub-exposicion',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c1-col-ex1',
            folderId: 'c1-fld-pruebas',
            title: 'Control Temas 1-2',
            date: '15/11',
            color: '#FFFFFF',
            width: 118,
            orderIndex: 3,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c1-col-ex2',
            folderId: 'c1-fld-pruebas',
            title: 'Examen Global 1.ª',
            date: '04/12',
            color: '#FFFFFF',
            width: 120,
            orderIndex: 4,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c1-col-media1',
            folderId: null,
            title: 'Media 1.ª Ev.',
            description: '30% trabajo diario + 20% rúbrica + 50% pruebas escritas',
            color: '#D1FAE5',
            width: 112,
            orderIndex: 5,
            type: 'AVERAGE',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'TEXT_ONLY',
            averageConfig: {
              sourceColumnIds: ['c1-col-cuad', 'c1-col-red', 'c1-col-rub', 'c1-col-ex1', 'c1-col-ex2'],
              weights: {
                'c1-col-cuad': 15,
                'c1-col-red': 15,
                'c1-col-rub': 20,
                'c1-col-ex1': 20,
                'c1-col-ex2': 30,
              },
              ignoreEmpty: true,
            },
          },
        ],
      },
      {
        id: 'c1-tab-2',
        title: '2.ª Evaluación',
        color: '#FEF9C3',
        orderIndex: 1,
        folders: [],
        columns: [
          {
            id: 'c1-col-t2act',
            folderId: null,
            title: 'Taller Sintaxis',
            date: '22/01',
            color: '#D1FAE5',
            width: 120,
            orderIndex: 0,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c1-col-t2ex',
            folderId: null,
            title: 'Prueba 2.ª Ev.',
            date: '19/02',
            color: '#FFE4E6',
            width: 120,
            orderIndex: 1,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c1-col-media-final',
            folderId: null,
            title: 'Media Global Curso',
            description: '50% 1.ª Evaluación + 50% 2.ª Evaluación',
            color: '#E2E8F0',
            width: 126,
            orderIndex: 2,
            type: 'AVERAGE',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'CELL_BG',
            averageConfig: {
              sourceColumnIds: ['c1-col-media1', 'c1-col-t2act', 'c1-col-t2ex'],
              weights: {
                'c1-col-media1': 50,
                'c1-col-t2act': 20,
                'c1-col-t2ex': 30,
              },
              ignoreEmpty: true,
            },
          },
        ],
      },
    ],
    cells: c1Cells,
  };
  class1 = recalculateBook(class1, rubrics);

  // =====================================================================
  // CLASE 2: 1.º Bachillerato B — Historia Contemporánea
  // =====================================================================
  const c2Students = mkStudents('c2', [
    ['Elena', 'Ibáñez Torres', 'Humanidades'],
    ['Álvaro', 'Jiménez Pardo', 'Humanidades'],
    ['Nerea', 'López Cuesta', 'Sociales'],
    ['Pablo', 'Molina Ortiz', 'Sociales'],
    ['Marta', 'Núñez Vega', 'Humanidades'],
    ['Lucas', 'Ortega Campos', 'Sociales'],
  ]);

  const c2Cells: Record<string, CellEntity> = {};
  const setC2 = (stIdx: number, colId: string, grade: number, comment = '') => {
    c2Cells[cellKey(c2Students[stIdx].id, colId)] = { grade, comment };
  };
  [
    [8.8, 'Análisis muy preciso', 9.0, 8.6],
    [6.4, '', 7.0, 6.2],
    [9.4, 'Destaca en fuentes', 9.2, 9.5],
    [4.5, 'Falta bibliografía', 5.1, 4.3],
    [7.8, '', 8.1, 7.6],
    [5.8, '', 6.0, 5.5],
  ].forEach(([f, c, d, p], idx) => {
    setC2(idx, 'c2-col-fuentes', Number(f), String(c));
    setC2(idx, 'c2-col-dossier', Number(d));
    setC2(idx, 'c2-col-parcial', Number(p));
  });

  let class2: ClassBook = {
    id: 'cls-historia-1b',
    name: '1.º Bach. B',
    subject: 'Historia Contemporánea',
    year: '2026-2027',
    color: '#8B5CF6',
    passThreshold: 5,
    sortMode: 'LAST_ASC',
    students: c2Students,
    tabs: [
      {
        id: 'c2-tab-1',
        title: '1.ª Evaluación',
        color: '#EDE9FE',
        orderIndex: 0,
        folders: [],
        columns: [
          {
            id: 'c2-col-fuentes',
            folderId: null,
            title: 'Comentario Fuentes',
            color: '#E0F2FE',
            width: 126,
            orderIndex: 0,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c2-col-dossier',
            folderId: null,
            title: 'Dossier Revolución Ind.',
            color: '#DCFCE7',
            width: 128,
            orderIndex: 1,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c2-col-parcial',
            folderId: null,
            title: 'Examen Tema 1-4',
            color: '#FFE4E6',
            width: 120,
            orderIndex: 2,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c2-col-media',
            folderId: null,
            title: 'Media 1.ª Ev.',
            color: '#FEF9C3',
            width: 112,
            orderIndex: 3,
            type: 'AVERAGE',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'TEXT_ONLY',
            averageConfig: {
              sourceColumnIds: ['c2-col-fuentes', 'c2-col-dossier', 'c2-col-parcial'],
              weights: {
                'c2-col-fuentes': 25,
                'c2-col-dossier': 25,
                'c2-col-parcial': 50,
              },
              ignoreEmpty: true,
            },
          },
        ],
      },
    ],
    cells: c2Cells,
  };
  class2 = recalculateBook(class2, rubrics);

  // =====================================================================
  // CLASE 3: 4.º ESO C — Tecnología y Digitalización
  // =====================================================================
  const c3Students = mkStudents('c3', [
    ['Aitana', 'Pérez Lozano', 'Equipo 1'],
    ['Marcos', 'Quintero Sanz', 'Equipo 1'],
    ['Claudia', 'Ramos Esteban', 'Equipo 2'],
    ['Iker', 'Soler Méndez', 'Equipo 2'],
    ['Laura', 'Vidal Romero', 'Equipo 3'],
  ]);

  const c3Cells: Record<string, CellEntity> = {};
  c3Cells[cellKey(c3Students[0].id, 'c3-col-prot')] = {
    grade: null,
    comment: 'Diseño muy limpio',
    rubricEval: {
      rubricId: 'rub-proyecto',
      selections: {
        'crit-pro-1': { levelId: 'lvl-4' },
        'crit-pro-2': { levelId: 'lvl-4' },
        'crit-pro-3': { levelId: 'lvl-3' },
      },
    },
  };
  c3Cells[cellKey(c3Students[0].id, 'c3-col-test')] = { grade: 8.9, comment: '' };
  c3Cells[cellKey(c3Students[1].id, 'c3-col-prot')] = {
    grade: null,
    comment: '',
    rubricEval: {
      rubricId: 'rub-proyecto',
      selections: {
        'crit-pro-1': { levelId: 'lvl-3' },
        'crit-pro-2': { levelId: 'lvl-2' },
        'crit-pro-3': { levelId: 'lvl-3' },
      },
    },
  };
  c3Cells[cellKey(c3Students[1].id, 'c3-col-test')] = { grade: 6.5, comment: 'Repasar circuitos' };
  c3Cells[cellKey(c3Students[2].id, 'c3-col-test')] = { grade: 7.4, comment: '' };
  c3Cells[cellKey(c3Students[3].id, 'c3-col-test')] = { grade: 4.8, comment: '' };
  c3Cells[cellKey(c3Students[4].id, 'c3-col-test')] = { grade: 9.1, comment: 'Sobresaliente' };

  let class3: ClassBook = {
    id: 'cls-tecno-4c',
    name: '4.º ESO C',
    subject: 'Tecnología y Digitalización',
    year: '2026-2027',
    color: '#10B981',
    passThreshold: 5,
    sortMode: 'LAST_ASC',
    students: c3Students,
    tabs: [
      {
        id: 'c3-tab-1',
        title: 'Evaluación Única',
        color: '#D1FAE5',
        orderIndex: 0,
        folders: [],
        columns: [
          {
            id: 'c3-col-prot',
            folderId: null,
            title: 'Prototipo (Rúbrica)',
            color: '#DBEAFE',
            width: 132,
            orderIndex: 0,
            type: 'RUBRIC',
            rubricId: 'rub-proyecto',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c3-col-test',
            folderId: null,
            title: 'Prueba Práctica',
            color: '#ECFCCB',
            width: 120,
            orderIndex: 1,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 'c3-col-media',
            folderId: null,
            title: 'Nota Final',
            color: '#FEF9C3',
            width: 112,
            orderIndex: 2,
            type: 'AVERAGE',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'TEXT_ONLY',
            averageConfig: {
              sourceColumnIds: ['c3-col-prot', 'c3-col-test'],
              weights: { 'c3-col-prot': 60, 'c3-col-test': 40 },
              ignoreEmpty: true,
            },
          },
        ],
      },
    ],
    cells: c3Cells,
  };
  class3 = recalculateBook(class3, rubrics);

  // =====================================================================
  // PLANTILLAS DE CLASE (CLASES EN BORRADOR)
  // =====================================================================
  let tpl1: ClassBook = {
    id: 'tpl-estandar',
    name: 'Borrador 3.º ESO',
    subject: 'Clase plantilla · 40% diario + 60% pruebas',
    year: 'Borrador',
    color: '#64748B',
    passThreshold: 5,
    sortMode: 'LAST_ASC',
    isTemplate: true,
    students: mkStudents('t1', [
      ['Ejemplo', 'Alumnado 1', 'Modelo'],
      ['Ejemplo', 'Alumnado 2', 'Modelo'],
    ]),
    tabs: [
      {
        id: 't1-tab-1',
        title: '1.ª Evaluación',
        color: '#E2E8F0',
        orderIndex: 0,
        folders: [
          {
            id: 't1-fld-cont',
            title: 'Trabajo Diario',
            color: '#D1FAE5',
            orderIndex: 0,
            isCollapsed: false,
            summaryMode: 'ARITHMETIC_MEAN',
            ignoreEmpty: true,
          },
        ],
        columns: [
          {
            id: 't1-col-1',
            folderId: 't1-fld-cont',
            title: 'Cuaderno y Tareas',
            color: '#D1FAE5',
            width: 118,
            orderIndex: 0,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 't1-col-2',
            folderId: 't1-fld-cont',
            title: 'Actividad Evaluable',
            color: '#D1FAE5',
            width: 118,
            orderIndex: 1,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 't1-col-3',
            folderId: null,
            title: 'Prueba Escrita',
            color: '#FFE4E6',
            width: 118,
            orderIndex: 2,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 't1-col-4',
            folderId: null,
            title: 'Media 1.ª Ev.',
            color: '#FEF9C3',
            width: 118,
            orderIndex: 3,
            type: 'AVERAGE',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
            averageConfig: {
              sourceColumnIds: ['t1-col-1', 't1-col-2', 't1-col-3'],
              weights: { 't1-col-1': 20, 't1-col-2': 20, 't1-col-3': 60 },
              ignoreEmpty: true,
            },
          },
        ],
      },
      {
        id: 't1-tab-2',
        title: '3.ª Evaluación',
        color: '#FEF3C7',
        orderIndex: 1,
        folders: [],
        columns: [
          {
            id: 't1-col-t3-1',
            folderId: null,
            title: 'Proyecto Final',
            color: '#DBEAFE',
            width: 124,
            orderIndex: 0,
            type: 'RUBRIC',
            rubricId: 'rub-proyecto',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
        ],
      },
    ],
    cells: {
      [cellKey('t1-st-1', 't1-col-1')]: { grade: 8.5, comment: 'Buen inicio' },
      [cellKey('t1-st-1', 't1-col-2')]: { grade: 9.0, comment: '' },
      [cellKey('t1-st-1', 't1-col-3')]: { grade: 8.0, comment: '' },
    },
  };
  tpl1 = recalculateBook(tpl1, rubrics);

  let tpl2: ClassBook = {
    id: 'tpl-rubrica',
    name: 'Borrador Proyectos',
    subject: 'Clase plantilla · Evaluación competencial',
    year: 'Borrador',
    color: '#0D9488',
    passThreshold: 5,
    sortMode: 'LAST_ASC',
    isTemplate: true,
    students: mkStudents('t2', [['Ejemplo', 'Equipo 1', 'Modelo']]),
    tabs: [
      {
        id: 't2-tab-1',
        title: 'Proyecto',
        color: '#DBEAFE',
        orderIndex: 0,
        folders: [],
        columns: [
          {
            id: 't2-col-1',
            folderId: null,
            title: 'Producto (Rúbrica)',
            color: '#DBEAFE',
            width: 128,
            orderIndex: 0,
            type: 'RUBRIC',
            rubricId: 'rub-proyecto',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 't2-col-2',
            folderId: null,
            title: 'Exposición Oral',
            color: '#EDE9FE',
            width: 126,
            orderIndex: 1,
            type: 'RUBRIC',
            rubricId: 'rub-exposicion',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
          },
          {
            id: 't2-col-3',
            folderId: null,
            title: 'Media Proyecto',
            color: '#FEF9C3',
            width: 120,
            orderIndex: 2,
            type: 'AVERAGE',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: 5,
            colorMode: 'NONE',
            averageConfig: {
              sourceColumnIds: ['t2-col-1', 't2-col-2'],
              weights: { 't2-col-1': 65, 't2-col-2': 35 },
              ignoreEmpty: true,
            },
          },
        ],
      },
    ],
    cells: {},
  };
  tpl2 = recalculateBook(tpl2, rubrics);

  return {
    version: 1,
    classes: [class1, class2, class3],
    templates: [tpl1, tpl2],
    activeMode: 'CLASS',
    activeClassId: class1.id,
    activeTemplateId: tpl1.id,
    activeTabByBook: {
      [class1.id]: class1.tabs[0].id,
      [class2.id]: class2.tabs[0].id,
      [class3.id]: class3.tabs[0].id,
      [tpl1.id]: tpl1.tabs[0].id,
      [tpl2.id]: tpl2.tabs[0].id,
    },
    rubrics,
    settings: {
      rowHeight: 48,
      headerHeight: 86,
      studentColWidth: 224,
      nameFormat: 'LAST_FIRST',
      showStatsRow: true,
      sidebarVisible: true,
    },
    updatedAt: new Date().toISOString(),
  };
}
