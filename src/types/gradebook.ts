export type ColumnType = 'NUMERIC' | 'AVERAGE' | 'RUBRIC';

export type ColumnEditorMode =
  | 'STANDARD'
  | 'COUNTER_POS'
  | 'COUNTER_NEG'
  | 'QUICK_COUNTER';

export type ColorMode = 'NONE' | 'TEXT_ONLY' | 'CELL_BG';

export type FolderSummaryMode =
  | 'ARITHMETIC_MEAN'
  | 'WEIGHTED_MEAN'
  | 'SUM'
  | 'MAX'
  | 'MIN';

export type StudentSortMode =
  | 'LAST_ASC'
  | 'LAST_DESC'
  | 'FIRST_ASC'
  | 'FIRST_DESC'
  | 'GROUP_ASC'
  | 'GRADE_DESC'
  | 'GRADE_ASC'
  | 'MANUAL';

export interface StudentGroupDef {
  id: string;
  name: string;
  color: string;
  orderIndex: number;
}

export interface GroupCategoryDef {
  id: string;
  name: string;
  groups: StudentGroupDef[];
  /** Map of studentId -> groupName within this category */
  assignments: Record<string, string>;
  /** Custom per-group student ordering (optional: groupName -> ordered studentIds) */
  studentOrder?: Record<string, string[]>;
}

export type ColumnSummaryMetric =
  | 'NONE'
  | 'MEAN'
  | 'MEDIAN'
  | 'PASS_COUNT'
  | 'PASS_PCT'
  | 'FAIL_COUNT'
  | 'FAIL_PCT'
  | 'MAX'
  | 'MIN'
  | 'EMPTY_COUNT'
  | 'FILLED_COUNT'
  | 'SUM'
  | 'STD_DEV';

export interface RubricLevel {
  id: string;
  title: string;
  percentage: number; // 0 to 100
  color: string;
}

export interface RubricCriterion {
  id: string;
  title: string;
  weight: number; // percentage weight across criteria
}

export interface RubricEntity {
  id: string;
  title: string;
  description?: string;
  minScore: number;
  maxScore: number;
  decimals: number;
  levels: RubricLevel[];
  criteria: RubricCriterion[];
  descriptors: Record<string, string>; // key: `${criterionId}::${levelId}`
}

export type LomloeKeyCompetenceCode =
  | 'CCL'
  | 'CP'
  | 'STEM'
  | 'CD'
  | 'CPSAA'
  | 'CC'
  | 'CE'
  | 'CCEC';

export interface LomloeKeyCompetenceDef {
  id: string;
  code: string;
  number: number;
  name: string;
  shortName: string;
  color: string;
  iconName: string;
}

export interface LomloeSpecificCompetence {
  id: string;
  number: number;
  code: string;
  title: string;
  description?: string;
  keyCompetenceIds: string[];
}

export interface LomloeCriterion {
  id: string;
  code: string;
  specificCompetenceId: string;
  description: string;
  /** Opcional: competencias clave específicas de este criterio (si se omite, hereda de su Competencia Específica) */
  keyCompetenceIds?: string[];
}

export interface LomloeCurriculum {
  id: string;
  name: string;
  subject: string;
  stage: 'ESO_1_2' | 'ESO_3_4' | 'BAC_1' | 'CUSTOM';
  legalReference?: string;
  specificCompetences: LomloeSpecificCompetence[];
  criteria: LomloeCriterion[];
}

export interface RubricCellEval {
  rubricId: string;
  selections: Record<string, { levelId: string; note?: string }>;
}

export interface CellEntity {
  grade: number | null;
  comment: string;
  rubricEval?: RubricCellEval;
  /** True when a RUBRIC or FOLDER summary cell's numeric grade was manually edited, overriding computed score */
  manualOverride?: boolean;
  /** Snapshot signature of upstream child grades/formula when a folder cell was manually overridden */
  manualSourceSignature?: string;
  /** True when a manually overridden folder cell was automatically recalculated after an upstream change */
  autoRecalcNotice?: boolean;
  /** Pending grade delta (+/-) queued on an ungraded cell to apply automatically when a grade is later entered */
  pendingAdjustment?: number;
  /** Net +/- delta currently applied to a numeric/manual cell via batch adjustment */
  appliedAdjustment?: number;
  /** Original grade before any +/- batch adjustment so the original score can be restored cleanly */
  preAdjustmentGrade?: number;
}

export interface AverageConfig {
  sourceColumnIds: string[];
  weights: Record<string, number>;
  ignoreEmpty: boolean;
}

export interface EducamosColumnTracking {
  status: 'DONE';
  /** Snapshot of non-null student grades (`studentId -> grade`) when passed/updated in Educamos */
  snapshot: Record<string, number>;
  updatedAt?: string;
}

export interface ColumnEntity {
  id: string;
  folderId: string | null;
  title: string;
  description?: string;
  date?: string;
  color: string;
  width: number;
  orderIndex: number;
  type: ColumnType;
  headerOrientation?: 'HORIZONTAL' | 'VERTICAL';
  isLocked?: boolean;
  // Numeric & visual scale settings (defaults: 0 - 10, 2 decimals)
  minValue: number;
  maxValue: number;
  decimals: number;
  passThreshold: number;
  colorMode: ColorMode;
  // Type-specific configurations
  /** Modo de edición para columnas numéricas (estándar, contador +/- o contador rápido) */
  editorMode?: ColumnEditorMode;
  /** Incremento/decremento por clic para los modos de contador (por defecto 1) */
  counterStep?: number;
  averageConfig?: AverageConfig;
  rubricId?: string;
  /** Por defecto false: las rúbricas se muestran convertidas de % a 0–10. Si true ("No convertir"), muestra el %. Al copiar siempre se copia 0–10. */
  rubricShowPercentage?: boolean;
  /** Estado local UI: despliega la columna de rúbrica en subcolumnas por criterio en la cuadrícula. */
  rubricExpanded?: boolean;
  /** Sobrescrituras por fila (0..4) para los resúmenes inferiores de esta columna */
  summaryRowOverrides?: Record<number, ColumnSummaryMetric>;
  /** Sobrescrituras por fila (0..4) para los resúmenes al final de cada grupo */
  groupSummaryRowOverrides?: Record<number, ColumnSummaryMetric>;
  /** Criterios de evaluación LOMLOE conectados a esta columna/tarea (e.g. ['1.1', '5.1']) */
  lomloeCriteriaIds?: string[];
  /** Seguimiento de exportación/actualización de notas hacia Educamos */
  educamos?: EducamosColumnTracking;
}

export interface FolderEntity {
  id: string;
  title: string;
  color: string;
  width?: number;
  orderIndex: number;
  isCollapsed: boolean;
  summaryMode: FolderSummaryMode;
  columnWeights?: Record<string, number>;
  ignoreEmpty?: boolean;
  /** Modo de coloración de las notas resumen de la carpeta (NONE, TEXT_ONLY, CELL_BG) */
  colorMode?: ColorMode;
  summaryRowOverrides?: Record<number, ColumnSummaryMetric>;
  groupSummaryRowOverrides?: Record<number, ColumnSummaryMetric>;
}

export interface TabEntity {
  id: string;
  title: string;
  color: string;
  orderIndex: number;
  isLocked?: boolean;
  folders: FolderEntity[];
  columns: ColumnEntity[];
  /** Unified visual order of top-level items (folder IDs and standalone column IDs) */
  itemOrder?: string[];
}

export interface StudentEntity {
  id: string;
  firstName: string;
  lastName: string;
  group?: string;
  tags: string[];
  notes?: string;
  orderIndex: number;
  isHidden?: boolean;
}

export interface ClassBook {
  id: string;
  name: string;
  subject: string;
  school?: string;
  year: string;
  color: string;
  passThreshold: number;
  sortMode: StudentSortMode;
  groupByGroups?: boolean;
  groups?: StudentGroupDef[];
  /** Múltiples categorías de agrupaciones de alumnos para distintas actividades */
  groupCategories?: GroupCategoryDef[];
  activeGroupCategoryId?: string | null;
  /** Número de filas vacías visuales al final de cada grupo (por defecto 1) */
  groupSpacerRows?: number;
  collapsedGroups?: string[];
  /** Hasta 5 filas extra de resúmenes globales al final de cada columna */
  summaryRows?: ColumnSummaryMetric[];
  /** Hasta 5 filas extra de estadísticas al final de cada grupo (configurar uno configura todos) */
  groupSummaryRows?: ColumnSummaryMetric[];
  /** Currículo LOMLOE asignado a esta clase (si no se define, se infiere automáticamente del nombre/curso) */
  lomloeCurriculumId?: string | null;
  /** Mostrar la fila de criterios y competencias LOMLOE bajo las cabeceras en el cuaderno */
  showLomloeRow?: boolean;
  isTemplate?: boolean;
  tabs: TabEntity[];
  students: StudentEntity[];
  cells: Record<string, CellEntity>; // key: `${studentId}::${columnId}`
}

export interface ViewSettings {
  rowHeight: number;
  headerHeight: number;
  studentColWidth: number;
  nameFormat: 'LAST_FIRST' | 'FIRST_LAST';
  showStatsRow: boolean;
  sidebarVisible: boolean;
  /** Por defecto false: todas las rúbricas se muestran convertidas a 0–10. Si true ("No convertir"), muestra el % en la cuadrícula. */
  showRubricsAsPercent?: boolean;
  /** Nivel de zoom del cuaderno (0.5 a 1.8, por defecto 1) */
  gridZoom?: number;
  /** Nivel de zoom en rúbricas (0.6 a 1.6, por defecto 1) */
  rubricZoom?: number;
  /** Tamaño base de fuente de notas en px (por defecto 15) */
  gradeFontSize?: number;
  /** Tamaño base de fuente de textos (alumnos, cabeceras, comentarios) en px (por defecto 13.5) */
  textFontSize?: number;
  /** Tamaño base de iconos del cuaderno en px (por defecto 15) */
  iconSize?: number;
  /** Altura de las filas vacías separadoras debajo de los grupos en px (por defecto 24) */
  groupSpacerHeight?: number;
  /** Altura de las filas de estadísticas/resumen en px (por defecto 32) */
  summaryRowHeight?: number;
  /** Anchura uniforme de referencia para columnas en px (por defecto 108) */
  defaultColumnWidth?: number;
  /** Anchura uniforme de referencia para carpetas en px (por defecto 68) */
  defaultFolderWidth?: number;
  /** Mostrar fila LOMLOE debajo de las cabeceras por defecto */
  showLomloeRow?: boolean;
  /** Estado plegado/abierto de las secciones/centros del panel lateral de clases */
  collapsedSchools?: Record<string, boolean>;
  /** Filas de estadísticas inferiores compartidas globalmente entre todas las clases y pestañas */
  globalSummaryRows?: ColumnSummaryMetric[];
}

export interface GradebookWorkspace {
  version: number;
  classes: ClassBook[];
  templates: ClassBook[];
  activeMode: 'CLASS' | 'TEMPLATE';
  activeClassId: string | null;
  activeTemplateId: string | null;
  activeTabByBook: Record<string, string>;
  rubrics: RubricEntity[];
  lomloeKeyCompetences?: LomloeKeyCompetenceDef[];
  lomloeCurricula?: LomloeCurriculum[];
  settings: ViewSettings;
  updatedAt: string;
}

export function cellKey(studentId: string, columnId: string): string {
  return `${studentId}::${columnId}`;
}
