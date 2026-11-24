import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eraser,
  FileX2,
  FolderOutput,
  FolderPlus,
  GripVertical,
  Hexagon,
  Layers,
  LayoutGrid,
  Lock,
  MessageSquare,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Sigma,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  blendWithWhite,
  PASTEL_SWATCHES,
} from '../../constants/colors';
import { DEFAULT_LOMLOE_KEY_COMPETENCES } from '../../data/lomloeReligion';
import { useGradebook } from '../../context/GradebookContext';
import { useDeviceProfile } from '../../hooks/useDeviceProfile';
import { useTouchDoubleTap } from '../../hooks/useLongPress';
import {
  applyCounterDelta,
  buildAlphabeticalColumnCopyText,
  canCellRestoreOriginalGrade,
  clampGradeForColumn,
  COLUMN_SUMMARY_OPTIONS,
  computeColumnSummaryMetric,
  computeFolderFormulaValue,
  computeFolderSummary,
  computeRubricCriterionResult,
  countEmptyGradesInColumns,
  countFolderOverridesAndNotices,
  ensureGroupCategories,
  formatCellCopyValue,
  formatCellDisplayGrade,
  formatGrade,
  getEffectiveBookGroups,
  getStudentActiveGroup,
  normalizeRubricLevels,
  organizeStudentsForGrid,
  parseLiveMixedInput,
  parseMixedInput,
  resolveCellColors,
  shouldRenderVerticalHeader,
} from '../../engine/gradeMath';
import {
  getColumnEducamosSummary,
  getEducamosSnappedGrade,
  isCellOutdatedForEducamos,
} from '../../engine/educamos';
import {
  isLomloeRowVisible,
  resolveBookCurriculum,
  resolveColumnLomloeSummary,
} from '../../engine/lomloe';
import { getTabDisplayOrder, type DragItemPayload } from '../../engine/tabLayout';
import {
  cellKey,
  type ColumnEntity,
  type ColumnSummaryMetric,
  type FolderEntity,
  type RubricCriterion,
  type RubricEntity,
  type StudentEntity,
} from '../../types/gradebook';
import {
  clampZoom,
  usePinchZoom,
  ZoomControls,
  type PinchGestureMeta,
} from '../common/ZoomControls';
import { LomloeCompetenceBadge } from '../lomloe/LomloeCompetenceBadge';
import { LomloeCriteriaPickerPopover } from '../lomloe/LomloeCriteriaPickerPopover';
import {
  BatchAdjustGradeModal,
  type BatchAdjustTargetState,
} from '../modals/BatchAdjustGradeModal';

interface GradebookGridProps {
  searchQuery: string;
  onEditStudent: (student: StudentEntity) => void;
  onNewStudent: () => void;
  onOpenBulkStudents?: () => void;
  onOpenGroupsManager?: (initialGroupName?: string) => void;
  onEditColumn: (col: ColumnEntity) => void;
  onNewColumn: (presetType?: 'NUMERIC' | 'AVERAGE' | 'RUBRIC', folderId?: string | null) => void;
  onEditFolder: (tabId: string, folder: FolderEntity) => void;
  onOpenCellModal: (student: StudentEntity, col: ColumnEntity) => void;
  onOpenRubricGrader: (
    student: StudentEntity | null,
    col: ColumnEntity,
    groupBatch?: { groupName: string; studentIds: string[] } | null
  ) => void;
  onOpenLomloeManager?: () => void;
}

const RUBRIC_CRIT_SEP = '::crit::';

type DisplaySlot =
  | {
      kind: 'COL';
      key: string;
      col: ColumnEntity;
      width: number;
      isChild: boolean;
      parentFolder?: FolderEntity;
    }
  | {
      kind: 'RUBRIC_CRITERION';
      key: string;
      col: ColumnEntity;
      rubric: RubricEntity;
      criterion: RubricCriterion;
      criterionIndex: number;
      width: number;
      isChild: boolean;
      parentFolder?: FolderEntity;
    }
  | {
      kind: 'FOLDER_SUMMARY';
      key: string;
      folder: FolderEntity;
      childCols: ColumnEntity[];
      width: number;
      isOpen: boolean;
    };

type Row1HeaderItem =
  | { kind: 'COL'; col: ColumnEntity }
  | {
      kind: 'RUBRIC_EXPANDED';
      col: ColumnEntity;
      rubric: RubricEntity;
      criteria: RubricCriterion[];
      critWidth: number;
    }
  | { kind: 'FOLDER_CLOSED'; folder: FolderEntity; childCols: ColumnEntity[] }
  | {
      kind: 'FOLDER_OPEN';
      folder: FolderEntity;
      childCols: ColumnEntity[];
      childColSpan: number;
      childWidthSum: number;
    };

function getDisplaySlotId(slot: DisplaySlot): string {
  return slot.kind === 'COL' ? slot.col.id : slot.key;
}

type SelectedColumnTarget =
  | { kind: 'COL'; col: ColumnEntity }
  | { kind: 'FOLDER'; folder: FolderEntity; childCols: ColumnEntity[] };

type ActiveDragState =
  | { kind: 'COL'; id: string; folderId: string | null }
  | { kind: 'FOLDER'; id: string };

interface DropHint {
  key: string;
  mode: 'BEFORE' | 'AFTER' | 'INSIDE' | 'OUTSIDE_END' | 'OUTSIDE_START';
}

const DRAG_MIME = 'application/x-cuaderno-drag';

let sharedMeasureCanvas: HTMLCanvasElement | null = null;
function measureTextPx(text: string, font: string): number {
  if (!text) return 0;
  if (typeof document === 'undefined') return text.length * 7.5;
  if (!sharedMeasureCanvas) sharedMeasureCanvas = document.createElement('canvas');
  const ctx = sharedMeasureCanvas.getContext('2d');
  if (!ctx) return text.length * 7.5;
  ctx.font = font;
  return ctx.measureText(text).width;
}

interface GradebookZoomBarHandle {
  setPreviewZoom: (next: number | null) => void;
}

const GradebookZoomBar = React.memo(
  React.forwardRef<
    GradebookZoomBarHandle,
    {
      zoom: number;
      min?: number;
      max?: number;
      onChangeZoom: (next: number) => void;
    }
  >(({ zoom, min = 0.5, max = 1.8, onChangeZoom }, ref) => {
    const [previewZoom, setPreviewZoom] = useState<number | null>(null);
    useImperativeHandle(ref, () => ({ setPreviewZoom }), []);
    return (
      <ZoomControls
        zoom={previewZoom ?? zoom}
        min={min}
        max={max}
        onChangeZoom={onChangeZoom}
      />
    );
  })
);
GradebookZoomBar.displayName = 'GradebookZoomBar';

export const GradebookGrid: React.FC<GradebookGridProps> = ({
  searchQuery,
  onEditStudent,
  onNewStudent,
  onOpenBulkStudents,
  onOpenGroupsManager,
  onEditColumn,
  onNewColumn,
  onEditFolder,
  onOpenCellModal,
  onOpenRubricGrader,
  onOpenLomloeManager,
}) => {
  const device = useDeviceProfile();
  const touchDoubleTap = useTouchDoubleTap();
  const {
    workspace,
    activeBook,
    activeTab,
    updateBook,
    updateSettings,
    resizeColumn,
    resizeFolder,
    stepColumn,
    stepFolder,
    moveItemInActiveTab,
    addFolder,
    toggleFolderCollapse,
    setColumnLomloeCriteria,
    setColumnEducamosStatus,
    markCellEducamosUpdated,
    addSummaryRow,
    updateGlobalSummaryRow,
    removeSummaryRow,
    setColumnSummaryOverride,
    addGroupSummaryRow,
    updateGlobalGroupSummaryRow,
    removeGroupSummaryRow,
    setColumnGroupSummaryOverride,
    reorderStudents,
    selectGroupCategory,
    upsertStudentGroup,
    toggleGroupCollapsed,
    setCellData,
    setMultipleCellsData,
    applyCellsBatch,
    restoreOriginalGrades,
    setRubricCriterionForStudents,
    toggleColumnRubricExpanded,
    clearCell,
    clearMultipleCells,
    fillEmptyGradesWithNP,
    restoreFolderCellCalculation,
    restoreFolderCalculation,
    undo,
    lastUndoneTarget,
    beginAspectChange,
  } = useGradebook();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const zoomBarRef = useRef<GradebookZoomBarHandle>(null);
  const inlineInputRef = useRef<HTMLTextAreaElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const skipNextBlurRef = useRef(false);
  const justResizedRef = useRef(false);
  const lastCopiedTextRef = useRef<string | null>(null);
  const prevAutoFitSizesRef = useRef<Map<string, { prev: number; fitted: number }>>(new Map());

  const [selectedCoord, setSelectedCoord] = useState<{
    studentId: string;
    columnId: string;
  } | null>(null);
  const [anchorCoord, setAnchorCoord] = useState<{
    studentId: string;
    columnId: string;
  } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [selectedStudentRowId, setSelectedStudentRowId] = useState<string | null>(null);
  const [selectedStudentColHeader, setSelectedStudentColHeader] = useState(false);
  const [quickCounterColumnId, setQuickCounterColumnId] = useState<string | null>(null);
  const [selectedColumnTarget, setSelectedColumnTarget] = useState<SelectedColumnTarget | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const copyToastTimerRef = useRef<number | null>(null);

  const [inlineEdit, setInlineEdit] = useState<{
    studentId: string;
    columnId: string;
    draft: string;
    applyToSelection?: boolean;
    initialGrade?: number | null;
    initialComment?: string | null;
    mode?: 'TYPE_OVER' | 'FULL_EDIT';
    cursorPos?: number;
    preserveRubricGrade?: boolean;
  } | null>(null);
  const [inlineEditRect, setInlineEditRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const inlineCursorInitKeyRef = useRef<string | null>(null);

  const [showAddColMenu, setShowAddColMenu] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState<{ top: number; left: number }>({ top: 120, left: 200 });
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showAddSummaryMenu, setShowAddSummaryMenu] = useState(false);
  const [addGroupSummaryMenu, setAddGroupSummaryMenu] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [summaryCellPicker, setSummaryCellPicker] = useState<{
    scope: 'TABLE' | 'GROUP';
    rowIndex: number;
    target:
      | { kind: 'GLOBAL' }
      | { kind: 'COL'; id: string; title: string }
      | { kind: 'FOLDER'; tabId: string; id: string; title: string };
    top: number;
    left: number;
  } | null>(null);
  const [selectedGroupColCell, setSelectedGroupColCell] = useState<{
    bucketKey: string;
    slotKey: string;
  } | null>(null);
  const [selectedSummaryCell, setSelectedSummaryCell] = useState<string | null>(null);
  const [groupColAction, setGroupColAction] = useState<{
    bucketKey: string;
    bucketName: string;
    studentIds: string[];
    slot:
      | { kind: 'COL'; col: ColumnEntity }
      | { kind: 'FOLDER'; folder: FolderEntity; childCols: ColumnEntity[] }
      | {
          kind: 'RUBRIC_CRITERION';
          col: ColumnEntity;
          rubric: RubricEntity;
          criterion: RubricCriterion;
          criterionIndex: number;
        };
    top: number;
    left: number;
  } | null>(null);
  const [criterionPicker, setCriterionPicker] = useState<{
    studentIds: string[];
    studentLabel: string;
    col: ColumnEntity;
    rubric: RubricEntity;
    criterion: RubricCriterion;
    criterionIndex: number;
    currentLevelId: string | null;
    top: number;
    left: number;
  } | null>(null);
  const [groupColGradeDraft, setGroupColGradeDraft] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderTitle, setNewFolderTitle] = useState('');
  const [dragItem, setDragItem] = useState<ActiveDragState | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const [dragStudentId, setDragStudentId] = useState<string | null>(null);
  const [lomloePicker, setLomloePicker] = useState<{
    colId: string;
    rect: { top: number; left: number; width: number; bottom: number };
  } | null>(null);
  const [educamosMenu, setEducamosMenu] = useState<{
    colId: string;
    rect: { top: number; bottom: number; left: number; right: number };
  } | null>(null);
  const [copiedLomloeCriteria, setCopiedLomloeCriteria] = useState<string[]>([]);

  const [cellTooltip, setCellTooltip] = useState<{
    text: string;
    rect: { top: number; bottom: number; left: number; width: number };
  } | null>(null);
  const [batchAdjustState, setBatchAdjustState] = useState<BatchAdjustTargetState | null>(null);
  const [touchMultiSelect, setTouchMultiSelect] = useState(false);
  const [editingGroup, setEditingGroup] = useState<{
    key: string;
    originalName: string;
    color: string;
    draft: string;
  } | null>(null);
  const cellTooltipTimerRef = useRef<number | null>(null);
  const clearCellTooltip = useCallback(() => {
    if (cellTooltipTimerRef.current !== null) {
      window.clearTimeout(cellTooltipTimerRef.current);
      cellTooltipTimerRef.current = null;
    }
    setCellTooltip(null);
  }, []);

  useEffect(() => clearCellTooltip, [clearCellTooltip]);

  const [quickCounterPopup, setQuickCounterPopup] = useState<{
    left: number;
    col: ColumnEntity;
    rows: Array<{ student: StudentEntity; top: number; height: number }>;
  } | null>(null);

  const lastHandledUndoneSeqRef = useRef(0);

  const gridZoom = workspace.settings.gridZoom ?? 1;
  const prevCommittedZoomRef = useRef(gridZoom);
  const activeZoomAnimRef = useRef<Animation | null>(null);
  const livePinchZoomRef = useRef<number | null>(null);
  const pinchRafRef = useRef<number | null>(null);
  const pinchCommitMetaRef = useRef<{
    targetZoom: number;
    fromLayoutZoom: number;
    fromScrollLeft: number;
    fromScrollTop: number;
  } | null>(null);
  const pendingZoomTransitionRef = useRef<{
    fromVisualZoom: number;
    fromLayoutZoom: number;
    fromScrollLeft: number;
    fromScrollTop: number;
  } | null>(null);

  const readTableLiveScale = useCallback((tableEl: HTMLTableElement | null): number => {
    if (!tableEl) return 1;
    const inlineScale = Number.parseFloat(tableEl.style.scale);
    if (Number.isFinite(inlineScale) && inlineScale > 0.05) return inlineScale;
    const computedScale = Number.parseFloat(getComputedStyle(tableEl).scale);
    if (Number.isFinite(computedScale) && computedScale > 0.05) return computedScale;
    const matrixStr = getComputedStyle(tableEl).transform;
    if (matrixStr && matrixStr !== 'none') {
      const m = new DOMMatrixReadOnly(matrixStr);
      if (Number.isFinite(m.a) && m.a > 0.05) return m.a;
    }
    return 1;
  }, []);

  const capturePreZoomVisualState = useCallback(() => {
    const tableEl = tableRef.current;
    const wrapper = wrapperRef.current;
    const prevLayoutZoom = prevCommittedZoomRef.current;
    let currentVisualZoom = prevLayoutZoom;

    if (livePinchZoomRef.current !== null) {
      currentVisualZoom = livePinchZoomRef.current;
    } else if (tableEl && activeZoomAnimRef.current) {
      currentVisualZoom = prevLayoutZoom * readTableLiveScale(tableEl);
    }

    pendingZoomTransitionRef.current = {
      fromVisualZoom: currentVisualZoom,
      fromLayoutZoom: prevLayoutZoom,
      fromScrollLeft: wrapper?.scrollLeft ?? 0,
      fromScrollTop: wrapper?.scrollTop ?? 0,
    };
  }, [readTableLiveScale]);

  const commitSteppedZoom = useCallback(
    (nextRaw: number) => {
      const nextZoom = clampZoom(nextRaw, 0.5, 1.8);
      if (Math.abs(nextZoom - gridZoom) < 0.001) return;
      capturePreZoomVisualState();
      updateSettings({ gridZoom: nextZoom });
    },
    [gridZoom, capturePreZoomVisualState, updateSettings]
  );

  const applyLivePinchScaleFrame = useCallback(() => {
    pinchRafRef.current = null;
    const tableEl = tableRef.current;
    const wrapper = wrapperRef.current;
    const liveZoom = livePinchZoomRef.current;
    if (!tableEl || !wrapper || liveZoom === null) return;
    const ratio = liveZoom / prevCommittedZoomRef.current;
    tableEl.style.willChange = 'transform';
    tableEl.style.transformOrigin = `${wrapper.scrollLeft}px ${wrapper.scrollTop}px`;
    tableEl.style.scale = String(ratio);
  }, []);

  const handleLivePinchZoom = useCallback(
    (liveZoom: number, meta: PinchGestureMeta) => {
      const tableEl = tableRef.current;
      const wrapper = wrapperRef.current;

      if (meta.phase === 'start') {
        if (activeZoomAnimRef.current && tableEl) {
          const midScale = readTableLiveScale(tableEl);
          livePinchZoomRef.current = prevCommittedZoomRef.current * midScale;
          activeZoomAnimRef.current.cancel();
          activeZoomAnimRef.current = null;
        }
        return;
      }

      if (meta.phase === 'move') {
        livePinchZoomRef.current = liveZoom;
        zoomBarRef.current?.setPreviewZoom(liveZoom);
        if (pinchRafRef.current === null) {
          pinchRafRef.current = window.requestAnimationFrame(applyLivePinchScaleFrame);
        }
        return;
      }

      // phase === 'end'
      if (pinchRafRef.current !== null) {
        window.cancelAnimationFrame(pinchRafRef.current);
        pinchRafRef.current = null;
      }
      zoomBarRef.current?.setPreviewZoom(null);
      const fromVisualZoom = livePinchZoomRef.current ?? prevCommittedZoomRef.current;
      livePinchZoomRef.current = null;

      const committed = clampZoom(liveZoom, 0.5, 1.8);
      const fromLayoutZoom = prevCommittedZoomRef.current;

      if (Math.abs(committed - fromLayoutZoom) < 0.005) {
        // Returned to the same committed zoom: smoothly release any residual scale
        if (tableEl) {
          const startScale = fromVisualZoom / fromLayoutZoom;
          tableEl.style.scale = '1';
          const prefersReduced =
            typeof window !== 'undefined' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (!prefersReduced && Math.abs(startScale - 1) > 0.004 && typeof tableEl.animate === 'function') {
            tableEl.style.willChange = 'transform';
            if (wrapper) {
              tableEl.style.transformOrigin = `${wrapper.scrollLeft}px ${wrapper.scrollTop}px`;
            }
            const anim = tableEl.animate(
              [{ scale: String(startScale) }, { scale: '1' }],
              { duration: 160, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
            );
            activeZoomAnimRef.current = anim;
            const cleanup = () => {
              if (activeZoomAnimRef.current !== anim) return;
              activeZoomAnimRef.current = null;
              tableEl.style.willChange = '';
              tableEl.style.transformOrigin = '';
            };
            anim.onfinish = cleanup;
            anim.oncancel = cleanup;
          } else {
            tableEl.style.willChange = '';
            tableEl.style.transformOrigin = '';
          }
        }
        return;
      }

      pinchCommitMetaRef.current = {
        targetZoom: committed,
        fromLayoutZoom,
        fromScrollLeft: wrapper?.scrollLeft ?? 0,
        fromScrollTop: wrapper?.scrollTop ?? 0,
      };
    },
    [applyLivePinchScaleFrame, readTableLiveScale]
  );

  usePinchZoom(
    wrapperRef,
    gridZoom,
    (next) => updateSettings({ gridZoom: next }),
    { min: 0.5, max: 1.8, onLiveZoom: handleLivePinchZoom }
  );

  // Smoothly reconcile layout zoom changes:
  // - After a live pinch finishes, swap GPU scale for crisp vector layout in a single pre-paint frame.
  // - After clicking +/-/100% or Cmd/Ctrl +/-/0 (or Aspect Undo), play a GPU FLIP scale animation.
  useLayoutEffect(() => {
    const prevZoom = prevCommittedZoomRef.current;
    prevCommittedZoomRef.current = gridZoom;
    if (prevZoom === gridZoom) return;

    if (pinchRafRef.current !== null) {
      window.cancelAnimationFrame(pinchRafRef.current);
      pinchRafRef.current = null;
    }
    if (activeZoomAnimRef.current) {
      activeZoomAnimRef.current.cancel();
      activeZoomAnimRef.current = null;
    }
    livePinchZoomRef.current = null;

    const tableEl = tableRef.current;
    const wrapper = wrapperRef.current;
    if (!tableEl) return;

    const pinchMeta = pinchCommitMetaRef.current;
    if (pinchMeta && Math.abs(pinchMeta.targetZoom - gridZoom) < 0.001) {
      pinchCommitMetaRef.current = null;
      pendingZoomTransitionRef.current = null;
      const ratio = gridZoom / pinchMeta.fromLayoutZoom;
      tableEl.style.scale = '1';
      tableEl.style.willChange = '';
      tableEl.style.transformOrigin = '';
      if (wrapper) {
        wrapper.scrollLeft = Math.round(pinchMeta.fromScrollLeft * ratio);
        wrapper.scrollTop = Math.round(pinchMeta.fromScrollTop * ratio);
      }
      return;
    }
    pinchCommitMetaRef.current = null;

    const pending = pendingZoomTransitionRef.current;
    pendingZoomTransitionRef.current = null;

    const fromVisualZoom = pending?.fromVisualZoom ?? prevZoom;
    const fromLayoutZoom = pending?.fromLayoutZoom ?? prevZoom;
    const ratio = gridZoom / fromLayoutZoom;

    if (wrapper) {
      const baseSL = pending?.fromScrollLeft ?? wrapper.scrollLeft;
      const baseST = pending?.fromScrollTop ?? wrapper.scrollTop;
      wrapper.scrollLeft = Math.round(baseSL * ratio);
      wrapper.scrollTop = Math.round(baseST * ratio);
    }

    tableEl.style.scale = '1';

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startScale = fromVisualZoom / gridZoom;

    if (
      prefersReducedMotion ||
      Math.abs(startScale - 1) <= 0.002 ||
      typeof tableEl.animate !== 'function'
    ) {
      tableEl.style.willChange = '';
      tableEl.style.transformOrigin = '';
      return;
    }

    const sL = wrapper?.scrollLeft ?? 0;
    const sT = wrapper?.scrollTop ?? 0;
    tableEl.style.transformOrigin = `${sL}px ${sT}px`;
    tableEl.style.willChange = 'transform';

    const anim = tableEl.animate(
      [{ scale: String(startScale) }, { scale: '1' }],
      {
        duration: 210,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }
    );
    activeZoomAnimRef.current = anim;

    const cleanup = () => {
      if (activeZoomAnimRef.current !== anim) return;
      activeZoomAnimRef.current = null;
      tableEl.style.willChange = '';
      tableEl.style.transformOrigin = '';
    };
    anim.onfinish = cleanup;
    anim.oncancel = cleanup;
  }, [gridZoom]);

  useEffect(() => {
    return () => {
      if (pinchRafRef.current !== null) {
        window.cancelAnimationFrame(pinchRafRef.current);
      }
      if (activeZoomAnimRef.current) {
        activeZoomAnimRef.current.cancel();
      }
    };
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (touchDoubleTap.wasDoubleTapJustHandled()) {
        return;
      }
      setShowAddColMenu(false);
      setShowSortMenu(false);
      setShowCategoryMenu(false);
      setShowAddSummaryMenu(false);
      setAddGroupSummaryMenu(null);
      setSummaryCellPicker(null);
      setGroupColAction(null);
      setCriterionPicker(null);
      setSelectedGroupColCell(null);
      setSelectedSummaryCell(null);
      setLomloePicker(null);
      if (
        !(
          e.target instanceof Element &&
          e.target.closest('[data-educamos-menu="true"], [data-educamos-col-btn]')
        )
      ) {
        setEducamosMenu(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  // Clear selection/edit when switching class or tab
  useEffect(() => {
    setSelectedCoord(null);
    setAnchorCoord(null);
    setSelectedKeys(new Set());
    setSelectedStudentRowId(null);
    setSelectedStudentColHeader(false);
    setQuickCounterColumnId(null);
    setSelectedColumnTarget(null);
    setSelectedGroupColCell(null);
    setSelectedSummaryCell(null);
    setInlineEdit(null);
    setInlineEditRect(null);
    setCriterionPicker(null);
    setLomloePicker(null);
    setEducamosMenu(null);
    setBatchAdjustState(null);
    setTouchMultiSelect(false);
    setEditingGroup(null);
  }, [activeBook?.id, activeTab?.id]);

  // Clear stale selectedColumnTarget if that column/folder was deleted
  useEffect(() => {
    if (!selectedColumnTarget || !activeTab) return;
    if (
      selectedColumnTarget.kind === 'COL' &&
      !activeTab.columns.some((c) => c.id === selectedColumnTarget.col.id)
    ) {
      setSelectedColumnTarget(null);
    } else if (
      selectedColumnTarget.kind === 'FOLDER' &&
      !activeTab.folders.some((f) => f.id === selectedColumnTarget.folder.id)
    ) {
      setSelectedColumnTarget(null);
    }
  }, [selectedColumnTarget, activeTab]);

  // Hide quick-counter +/- column buttons & student row selection whenever selection moves elsewhere
  useEffect(() => {
    if (
      selectedStudentRowId &&
      (selectedCoord !== null ||
        selectedColumnTarget !== null ||
        selectedGroupColCell !== null ||
        selectedSummaryCell !== null)
    ) {
      setSelectedStudentRowId(null);
    }
    if (!quickCounterColumnId) return;
    if (
      !selectedCoord ||
      selectedCoord.columnId !== quickCounterColumnId ||
      selectedColumnTarget !== null ||
      selectedGroupColCell !== null ||
      selectedSummaryCell !== null ||
      selectedStudentRowId !== null
    ) {
      setQuickCounterColumnId(null);
    }
  }, [
    quickCounterColumnId,
    selectedCoord,
    selectedColumnTarget,
    selectedGroupColCell,
    selectedSummaryCell,
    selectedStudentRowId,
  ]);

  // Update floating anchor rect whenever inline-edited cell changes (or closes)
  useLayoutEffect(() => {
    if (!inlineEdit) {
      inlineCursorInitKeyRef.current = null;
      setInlineEditRect(null);
      return;
    }
    const cellEl = getCellNode(inlineEdit.studentId, inlineEdit.columnId);
    if (cellEl) {
      const r = cellEl.getBoundingClientRect();
      setInlineEditRect((prev) =>
        prev &&
        prev.top === r.top &&
        prev.left === r.left &&
        prev.width === r.width &&
        prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height }
      );
    }
  }, [inlineEdit?.studentId, inlineEdit?.columnId]);

  // Synchronous focus & cursor placement once the portal <textarea> actually mounts
  useLayoutEffect(() => {
    if (!inlineEdit || !inlineEditRect) return;
    const el = inlineInputRef.current;
    if (!el) return;
    const editKey = `${inlineEdit.studentId}::${inlineEdit.columnId}`;
    if (inlineCursorInitKeyRef.current === editKey) return;
    inlineCursorInitKeyRef.current = editKey;

    el.style.height = 'auto';
    el.style.height = `${Math.min(200, Math.max(38, el.scrollHeight))}px`;
    el.focus({ preventScroll: true });
    const pos =
      typeof inlineEdit.cursorPos === 'number'
        ? Math.max(0, Math.min(el.value.length, inlineEdit.cursorPos))
        : el.value.length;
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      // ignore
    }
    el.scrollTop = el.scrollHeight;
  }, [inlineEdit?.studentId, inlineEdit?.columnId, inlineEditRect]);

  // Keep textarea auto-grown as user types so 100% of text stays visible while editing
  useLayoutEffect(() => {
    const el = inlineInputRef.current;
    if (!inlineEdit || !el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(200, Math.max(38, el.scrollHeight))}px`;
  }, [inlineEdit?.draft, inlineEditRect]);

  // Filtered, sorted & optionally grouped students + group categories
  const { groupBuckets, visibleStudents, effectiveGroups, groupCategories, activeGroupCategory } =
    useMemo(() => {
      if (!activeBook) {
        return {
          groupBuckets: [],
          visibleStudents: [] as StudentEntity[],
          effectiveGroups: [],
          groupCategories: [],
          activeGroupCategory: null,
        };
      }
      const organized = organizeStudentsForGrid(activeBook, activeTab, searchQuery);
      const { categories, activeCategory } = ensureGroupCategories(activeBook);
      return {
        groupBuckets: organized.groups,
        visibleStudents: organized.visibleStudents,
        effectiveGroups: getEffectiveBookGroups(activeBook),
        groupCategories: categories,
        activeGroupCategory: activeCategory,
      };
    }, [activeBook, activeTab, searchQuery]);

  const normalizedRubricById = useMemo(() => {
    const map = new Map<string, RubricEntity>();
    for (const r of workspace.rubrics) {
      map.set(r.id, { ...r, levels: normalizeRubricLevels(r.levels) });
    }
    return map;
  }, [workspace.rubrics]);

  const resolveColumnRubric = useCallback(
    (col: ColumnEntity): RubricEntity | null => {
      if (col.type !== 'RUBRIC') return null;
      return (
        (col.rubricId ? normalizedRubricById.get(col.rubricId) : undefined) ??
        normalizedRubricById.values().next().value ??
        null
      );
    },
    [normalizedRubricById]
  );

  // Build iDoceo-style continuous horizontal slots + Row 1/Row 2 header topology
  const {
    visibleColumns,
    displaySlots,
    row1Headers,
    row2Slots,
    hasExpandedChildRubric,
  } = useMemo(() => {
    if (!activeTab) {
      return {
        visibleColumns: [] as ColumnEntity[],
        displaySlots: [] as DisplaySlot[],
        row1Headers: [] as Row1HeaderItem[],
        row2Slots: [] as DisplaySlot[],
        hasExpandedChildRubric: false,
      };
    }

    const topItems = getTabDisplayOrder(activeTab);
    const visCols: ColumnEntity[] = [];
    const slots: DisplaySlot[] = [];
    const r1: Row1HeaderItem[] = [];
    const r2: DisplaySlot[] = [];
    const CRIT_SUBCOL_WIDTH = 75;
    let expandedChildRubric = false;

    const buildExpandedCriterionSlots = (
      col: ColumnEntity,
      rubric: RubricEntity,
      isChild: boolean,
      parentFolder?: FolderEntity
    ): DisplaySlot[] => {
      return rubric.criteria.map((criterion, criterionIndex) => ({
        kind: 'RUBRIC_CRITERION' as const,
        key: `${col.id}${RUBRIC_CRIT_SEP}${criterion.id}`,
        col,
        rubric,
        criterion,
        criterionIndex,
        width: CRIT_SUBCOL_WIDTH,
        isChild,
        parentFolder,
      }));
    };

    for (const item of topItems) {
      if (item.kind === 'COL') {
        visCols.push(item.col);
        const rubric = item.col.rubricExpanded ? resolveColumnRubric(item.col) : null;
        if (rubric && rubric.criteria.length > 0) {
          const critWidth = CRIT_SUBCOL_WIDTH;
          const colSlot: DisplaySlot = {
            kind: 'COL',
            key: item.col.id,
            col: item.col,
            width: item.col.width,
            isChild: false,
          };
          const critSlots = buildExpandedCriterionSlots(item.col, rubric, false);
          r1.push({
            kind: 'RUBRIC_EXPANDED',
            col: item.col,
            rubric,
            criteria: rubric.criteria,
            critWidth,
          });
          slots.push(colSlot, ...critSlots);
          r2.push(colSlot, ...critSlots);
        } else {
          slots.push({
            kind: 'COL',
            key: item.col.id,
            col: item.col,
            width: item.col.width,
            isChild: false,
          });
          r1.push({ kind: 'COL', col: item.col });
        }
        continue;
      }

      const { folder, childCols } = item;
      const fldW = folder.width ?? 68;
      if (folder.isCollapsed) {
        const closedSlot: DisplaySlot = {
          kind: 'FOLDER_SUMMARY',
          key: `fld-sum-${folder.id}`,
          folder,
          childCols,
          width: fldW,
          isOpen: false,
        };
        slots.push(closedSlot);
        // Keep BOTH Row 1 canopy AND Row 2 summary header even when collapsed
        // so the top bar never disappears and header height never shifts!
        r1.push({ kind: 'FOLDER_CLOSED', folder, childCols });
        r2.push(closedSlot);
      } else {
        const sumSlot: DisplaySlot = {
          kind: 'FOLDER_SUMMARY',
          key: `fld-sum-${folder.id}`,
          folder,
          childCols,
          width: fldW,
          isOpen: true,
        };
        slots.push(sumSlot);
        r2.push(sumSlot);

        let childColSpan = 0;
        let childWidthSum = 0;
        for (const c of childCols) {
          visCols.push(c);
          const cSlot: DisplaySlot = {
            kind: 'COL',
            key: c.id,
            col: c,
            width: c.width,
            isChild: true,
            parentFolder: folder,
          };
          slots.push(cSlot);
          r2.push(cSlot);
          childColSpan += 1;
          childWidthSum += c.width;

          const childRubric = c.rubricExpanded ? resolveColumnRubric(c) : null;
          if (childRubric && childRubric.criteria.length > 0) {
            expandedChildRubric = true;
            const critSlots = buildExpandedCriterionSlots(c, childRubric, true, folder);
            slots.push(...critSlots);
            r2.push(...critSlots);
            childColSpan += critSlots.length;
            childWidthSum += critSlots.reduce((acc, s) => acc + s.width, 0);
          }
        }
        r1.push({
          kind: 'FOLDER_OPEN',
          folder,
          childCols,
          childColSpan,
          childWidthSum,
        });
      }
    }

    return {
      visibleColumns: visCols,
      displaySlots: slots,
      row1Headers: r1,
      row2Slots: r2,
      hasExpandedChildRubric: expandedChildRubric,
    };
  }, [activeTab, resolveColumnRubric]);

  // Helper to resolve drag payload safely from state or dataTransfer
  const readDragPayload = (e: React.DragEvent): DragItemPayload | null => {
    if (dragItem) return { kind: dragItem.kind, id: dragItem.id };
    try {
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (raw) {
        const parsed = JSON.parse(raw) as DragItemPayload;
        if (parsed && (parsed.kind === 'COL' || parsed.kind === 'FOLDER') && parsed.id) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    const plain = e.dataTransfer.getData('text/plain');
    if (plain) return { kind: 'COL', id: plain };
    return null;
  };

  const clearDrag = () => {
    setDragItem(null);
    setDropHint(null);
  };

  const getPointerHalf = (e: React.DragEvent): 'BEFORE' | 'AFTER' => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX < rect.left + rect.width / 2 ? 'BEFORE' : 'AFTER';
  };

  const getCellNode = (studentId: string, columnId: string): HTMLElement | null =>
    wrapperRef.current?.querySelector(`[data-cell="${studentId}::${columnId}"]`) ?? null;

  const ensureCellVisible = useCallback(
    (studentId: string, columnId: string, behavior: ScrollBehavior = 'auto') => {
      requestAnimationFrame(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        const el = getCellNode(studentId, columnId);
        if (!el) return;

        const wrapperRect = wrapper.getBoundingClientRect();
        const cellRect = el.getBoundingClientRect();

        const thead = wrapper.querySelector('thead');
        const theadHeight = thead
          ? thead.getBoundingClientRect().height
          : (workspace.settings.headerHeight + 28) * gridZoom;
        const studentHeaderTh = thead?.querySelector('th');
        const studentColW = studentHeaderTh
          ? studentHeaderTh.getBoundingClientRect().width
          : workspace.settings.studentColWidth * gridZoom;

        const cellLeftInWrapper = cellRect.left - wrapperRect.left;
        const cellRightInWrapper = cellRect.right - wrapperRect.left;
        const cellTopInWrapper = cellRect.top - wrapperRect.top;
        const cellBottomInWrapper = cellRect.bottom - wrapperRect.top;

        let deltaX = 0;
        let deltaY = 0;

        // Check horizontal visibility against sticky student column and container right edge
        if (cellLeftInWrapper < studentColW + 2) {
          deltaX = cellLeftInWrapper - (studentColW + 14);
        } else if (cellRightInWrapper > wrapper.clientWidth - 2) {
          deltaX = cellRightInWrapper - wrapper.clientWidth + 18;
        }

        // Check vertical visibility against sticky header and container bottom edge
        if (cellTopInWrapper < theadHeight + 2) {
          deltaY = cellTopInWrapper - (theadHeight + 10);
        } else if (cellBottomInWrapper > wrapper.clientHeight - 2) {
          deltaY = cellBottomInWrapper - wrapper.clientHeight + 10;
        }

        if (deltaX !== 0 || deltaY !== 0) {
          wrapper.scrollBy({
            left: deltaX,
            top: deltaY,
            behavior,
          });
        }
      });
    },
    [workspace.settings.studentColWidth, workspace.settings.headerHeight, gridZoom]
  );

  const focusCell = useCallback(
    (studentId: string, columnId: string) => {
      requestAnimationFrame(() => {
        const el = getCellNode(studentId, columnId);
        if (el) {
          el.focus({ preventScroll: true });
        }
        ensureCellVisible(studentId, columnId, 'auto');
      });
    },
    [ensureCellVisible]
  );

  const folderSlotById = useMemo(() => {
    const map = new Map<string, { folder: FolderEntity; childCols: ColumnEntity[] }>();
    for (const slot of displaySlots) {
      if (slot.kind === 'FOLDER_SUMMARY') {
        map.set(slot.key, { folder: slot.folder, childCols: slot.childCols });
      }
    }
    return map;
  }, [displaySlots]);

  const makeVirtualFolderCol = useCallback(
    (folder: FolderEntity, childCols: ColumnEntity[]): ColumnEntity => {
      const baseChild = childCols[0];
      return {
        id: folder.id,
        folderId: null,
        title: folder.title,
        color: folder.color,
        width: folder.width ?? 68,
        orderIndex: folder.orderIndex,
        type: 'NUMERIC',
        isLocked: Boolean(activeTab?.isLocked),
        minValue: baseChild ? baseChild.minValue : 0,
        maxValue: baseChild ? baseChild.maxValue : 10,
        decimals: 2,
        passThreshold: activeBook?.passThreshold ?? 5,
        colorMode: folder.colorMode ?? 'NONE',
      };
    },
    [activeTab?.isLocked, activeBook?.passThreshold]
  );

  const resolveEditableTarget = useCallback(
    (
      targetId: string
    ): {
      col: ColumnEntity;
      isFolder: boolean;
      folder?: FolderEntity;
      childCols?: ColumnEntity[];
    } | null => {
      const col = visibleColumns.find((c) => c.id === targetId);
      if (col) {
        return { col, isFolder: false };
      }
      const fldEntry = folderSlotById.get(targetId);
      if (fldEntry) {
        return {
          col: makeVirtualFolderCol(fldEntry.folder, fldEntry.childCols),
          isFolder: true,
          folder: fldEntry.folder,
          childCols: fldEntry.childCols,
        };
      }
      return null;
    },
    [visibleColumns, folderSlotById, makeVirtualFolderCol]
  );

  const canTypeInline = useCallback(
    (col: ColumnEntity) =>
      Boolean(!activeTab?.isLocked && !col.isLocked && (col.type === 'NUMERIC' || col.type === 'RUBRIC')),
    [activeTab?.isLocked]
  );

  const canTypeInlineTarget = useCallback(
    (targetId: string) => {
      const info = resolveEditableTarget(targetId);
      return info ? canTypeInline(info.col) : false;
    },
    [resolveEditableTarget, canTypeInline]
  );

  // Resolve active visible selected cells from selectedKeys
  const selectedTargets = useMemo(() => {
    const visStSet = new Set(visibleStudents.map((s) => s.id));
    const visColMap = new Map(visibleColumns.map((c) => [c.id, c]));
    const list: Array<{ studentId: string; columnId: string; col: ColumnEntity; isFolder: boolean }> = [];
    for (const key of selectedKeys) {
      const sep = key.indexOf('::');
      if (sep < 0) continue;
      const studentId = key.slice(0, sep);
      const columnId = key.slice(sep + 2);
      if (!visStSet.has(studentId)) continue;
      const col = visColMap.get(columnId);
      if (col) {
        list.push({ studentId, columnId, col, isFolder: false });
        continue;
      }
      const fldEntry = folderSlotById.get(columnId);
      if (fldEntry) {
        list.push({
          studentId,
          columnId,
          col: makeVirtualFolderCol(fldEntry.folder, fldEntry.childCols),
          isFolder: true,
        });
      }
    }
    return list;
  }, [selectedKeys, visibleStudents, visibleColumns, folderSlotById, makeVirtualFolderCol]);

  const editableNumericTargets = useMemo(
    () =>
      activeTab?.isLocked
        ? []
        : selectedTargets
            .filter((t) => !t.col.isLocked && (t.col.type === 'NUMERIC' || t.col.type === 'RUBRIC'))
            .map(({ studentId, columnId }) => ({ studentId, columnId })),
    [activeTab?.isLocked, selectedTargets]
  );

  const adjustableSelectionTargets = useMemo(
    () =>
      activeTab?.isLocked
        ? []
        : selectedTargets
            .filter(
              (t) =>
                !t.isFolder &&
                !t.col.isLocked &&
                (t.col.type === 'NUMERIC' || t.col.type === 'RUBRIC')
            )
            .map(({ studentId, columnId }) => ({ studentId, columnId })),
    [activeTab?.isLocked, selectedTargets]
  );

  const restorableSelectionTargets = useMemo(() => {
    if (!activeBook) return [];
    return adjustableSelectionTargets.filter(({ studentId, columnId }) =>
      canCellRestoreOriginalGrade(activeBook.cells[cellKey(studentId, columnId)])
    );
  }, [activeBook, adjustableSelectionTargets]);

  const openBatchAdjustForSelection = useCallback(() => {
    if (adjustableSelectionTargets.length === 0) return;
    const distinctColIds = [...new Set(adjustableSelectionTargets.map((t) => t.columnId))];
    const singleCol =
      distinctColIds.length === 1
        ? visibleColumns.find((c) => c.id === distinctColIds[0]) ?? null
        : null;
    const subtitle = singleCol
      ? `${singleCol.title} · ${adjustableSelectionTargets.length} ${
          adjustableSelectionTargets.length === 1 ? 'alumno seleccionado' : 'alumnos seleccionados'
        }`
      : `${adjustableSelectionTargets.length} celdas seleccionadas`;
    setBatchAdjustState({
      title: 'Ajustar notas seleccionadas',
      subtitle,
      targets: adjustableSelectionTargets,
    });
  }, [adjustableSelectionTargets, visibleColumns]);

  const clearableTargets = useMemo(
    () =>
      activeTab?.isLocked
        ? []
        : selectedTargets
            .filter((t) => !t.col.isLocked && t.col.type !== 'AVERAGE')
            .map(({ studentId, columnId }) => ({ studentId, columnId })),
    [activeTab?.isLocked, selectedTargets]
  );

  // Batch rubric selection: multiple selected cells belonging to the SAME RUBRIC column
  const sameRubricColSelection = useMemo(() => {
    if (activeTab?.isLocked || selectedKeys.size <= 1) return null;
    if (selectedTargets.length !== selectedKeys.size) return null;
    const first = selectedTargets[0];
    if (!first || first.isFolder || first.col.type !== 'RUBRIC' || first.col.isLocked) {
      return null;
    }
    const allSame = selectedTargets.every((t) => !t.isFolder && t.col.id === first.col.id);
    if (!allSame) return null;
    return {
      col: first.col,
      studentIds: selectedTargets.map((t) => t.studentId),
    };
  }, [activeTab?.isLocked, selectedKeys.size, selectedTargets]);

  // Batch rubric criterion selection: multiple selected cells belonging to the SAME expanded criterion slot
  const sameCriterionSelection = useMemo(() => {
    if (activeTab?.isLocked || selectedKeys.size <= 1) return null;
    const visStSet = new Set(visibleStudents.map((s) => s.id));
    let matchedCritKey: string | null = null;
    const studentIds: string[] = [];
    for (const k of selectedKeys) {
      const sep = k.indexOf('::');
      if (sep < 0) return null;
      const studentId = k.slice(0, sep);
      const slotKey = k.slice(sep + 2);
      if (!visStSet.has(studentId) || !slotKey.includes(RUBRIC_CRIT_SEP)) return null;
      if (matchedCritKey === null) matchedCritKey = slotKey;
      else if (matchedCritKey !== slotKey) return null;
      studentIds.push(studentId);
    }
    if (!matchedCritKey || studentIds.length <= 1) return null;
    const critSlot = displaySlots.find(
      (s): s is Extract<DisplaySlot, { kind: 'RUBRIC_CRITERION' }> =>
        s.kind === 'RUBRIC_CRITERION' && s.key === matchedCritKey
    );
    if (!critSlot || critSlot.col.isLocked) return null;
    return {
      critSlot,
      studentIds,
    };
  }, [activeTab?.isLocked, selectedKeys, visibleStudents, displaySlots]);

  const slotIdsInOrder = useMemo(
    () => displaySlots.map(getDisplaySlotId),
    [displaySlots]
  );

  const selectSingleCell = useCallback((studentId: string, columnId: string) => {
    const k = cellKey(studentId, columnId);
    setSelectedStudentRowId(null);
    setSelectedStudentColHeader(false);
    setSelectedColumnTarget(null);
    setSelectedGroupColCell(null);
    setSelectedSummaryCell(null);
    setSelectedCoord({ studentId, columnId });
    setAnchorCoord({ studentId, columnId });
    setSelectedKeys(new Set([k]));
  }, []);

  // Select and scroll to the exact cell where Data Undo reverted a change
  useEffect(() => {
    if (!lastUndoneTarget || !activeBook || !activeTab) return;
    if (lastUndoneTarget.seq === lastHandledUndoneSeqRef.current) return;
    if (lastUndoneTarget.bookId !== activeBook.id) return;
    if (lastUndoneTarget.tabId && lastUndoneTarget.tabId !== activeTab.id) return;

    const studentExists = visibleStudents.some((s) => s.id === lastUndoneTarget.studentId);
    if (!studentExists) return;

    let targetSlotId: string | null = null;
    if (slotIdsInOrder.includes(lastUndoneTarget.columnId)) {
      targetSlotId = lastUndoneTarget.columnId;
    } else {
      const col = activeTab.columns.find((c) => c.id === lastUndoneTarget.columnId);
      if (col?.folderId) {
        const folderKey = `folder:${col.folderId}`;
        if (slotIdsInOrder.includes(folderKey)) {
          targetSlotId = folderKey;
        }
      }
    }
    if (!targetSlotId) return;

    lastHandledUndoneSeqRef.current = lastUndoneTarget.seq;
    selectSingleCell(lastUndoneTarget.studentId, targetSlotId);
    const sid = lastUndoneTarget.studentId;
    const cid = targetSlotId;
    window.requestAnimationFrame(() => {
      ensureCellVisible(sid, cid, 'smooth');
      focusCell(sid, cid);
    });
  }, [
    lastUndoneTarget,
    activeBook,
    activeTab,
    visibleStudents,
    slotIdsInOrder,
    selectSingleCell,
    ensureCellVisible,
    focusCell,
  ]);

  // Anchor the floating Quick-Counter popup to the RIGHT edge of the active column
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!quickCounterColumnId || !wrapper || !activeTab) {
      setQuickCounterPopup(null);
      return;
    }
    const targetCol = activeTab.columns.find((c) => c.id === quickCounterColumnId);
    if (!targetCol || targetCol.isLocked || activeTab.isLocked) {
      setQuickCounterPopup(null);
      return;
    }
    const colEl = wrapper.querySelector(
      `[data-col-header="${quickCounterColumnId}"]`
    ) as HTMLElement | null;
    if (!colEl) {
      setQuickCounterPopup(null);
      return;
    }

    const wrRect = wrapper.getBoundingClientRect();
    const colRect = colEl.getBoundingClientRect();
    const left = colRect.right - wrRect.left + wrapper.scrollLeft + 4;

    const rows: Array<{ student: StudentEntity; top: number; height: number }> = [];
    for (const student of visibleStudents) {
      const trEl = wrapper.querySelector(
        `tr[data-student-row="${student.id}"]`
      ) as HTMLElement | null;
      if (!trEl) continue;
      const rRect = trEl.getBoundingClientRect();
      rows.push({
        student,
        top: rRect.top - wrRect.top + wrapper.scrollTop,
        height: rRect.height,
      });
    }

    setQuickCounterPopup({ left, col: targetCol, rows });
  }, [
    quickCounterColumnId,
    activeBook,
    activeTab,
    gridZoom,
    visibleStudents,
    displaySlots,
    workspace.settings.rowHeight,
    workspace.settings.headerHeight,
    workspace.settings.studentColWidth,
    workspace.settings.groupSpacerHeight,
    workspace.settings.summaryRowHeight,
    workspace.settings.sidebarVisible,
    workspace.settings.showLomloeRow,
  ]);

  const selectRangeToCell = useCallback(
    (
      anchor: { studentId: string; columnId: string },
      target: { studentId: string; columnId: string },
      additive = false
    ) => {
      const r1 = visibleStudents.findIndex((s) => s.id === anchor.studentId);
      const c1 = slotIdsInOrder.indexOf(anchor.columnId);
      const r2 = visibleStudents.findIndex((s) => s.id === target.studentId);
      const c2 = slotIdsInOrder.indexOf(target.columnId);
      if (r1 < 0 || c1 < 0 || r2 < 0 || c2 < 0) return;

      const rMin = Math.min(r1, r2);
      const rMax = Math.max(r1, r2);
      const cMin = Math.min(c1, c2);
      const cMax = Math.max(c1, c2);

      const next = additive ? new Set(selectedKeys) : new Set<string>();
      for (let r = rMin; r <= rMax; r++) {
        for (let c = cMin; c <= cMax; c++) {
          next.add(cellKey(visibleStudents[r].id, slotIdsInOrder[c]));
        }
      }
      setSelectedStudentRowId(null);
      setSelectedStudentColHeader(false);
      setSelectedColumnTarget(null);
      setSelectedGroupColCell(null);
      setSelectedSummaryCell(null);
      setAnchorCoord(anchor);
      setSelectedCoord(target);
      setSelectedKeys(next);
    },
    [visibleStudents, slotIdsInOrder, selectedKeys]
  );

  const selectEntireColumn = useCallback((col: ColumnEntity) => {
    setSelectedStudentRowId(null);
    setSelectedStudentColHeader(false);
    setSelectedColumnTarget({ kind: 'COL', col });
    setSelectedGroupColCell(null);
    setSelectedSummaryCell(null);
    setSelectedKeys(new Set());
    setSelectedCoord(null);
    setAnchorCoord(null);
    wrapperRef.current?.focus({ preventScroll: true });
  }, []);

  const selectFolderSummaryColumn = useCallback(
    (folder: FolderEntity, childCols: ColumnEntity[]) => {
      setSelectedStudentRowId(null);
      setSelectedStudentColHeader(false);
      setSelectedColumnTarget({ kind: 'FOLDER', folder, childCols });
      setSelectedGroupColCell(null);
      setSelectedSummaryCell(null);
      setSelectedKeys(new Set());
      setSelectedCoord(null);
      setAnchorCoord(null);
      wrapperRef.current?.focus({ preventScroll: true });
    },
    []
  );

  const selectEntireStudentRow = useCallback((studentId: string) => {
    setSelectedStudentRowId(studentId);
    setSelectedStudentColHeader(false);
    setSelectedColumnTarget(null);
    setSelectedGroupColCell(null);
    setSelectedSummaryCell(null);
    setSelectedKeys(new Set());
    setSelectedCoord(null);
    setAnchorCoord(null);
    wrapperRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onHighlightStudent = (e: Event) => {
      const studentId = (e as CustomEvent<{ studentId?: string }>).detail?.studentId;
      if (!studentId) return;
      selectEntireStudentRow(studentId);
      requestAnimationFrame(() => {
        const rowEl = wrapperRef.current?.querySelector(
          `[data-student-row="${CSS.escape(studentId)}"]`
        );
        rowEl?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      });
    };

    const onHighlightGroup = (e: Event) => {
      const groupName = (e as CustomEvent<{ groupName?: string }>).detail?.groupName;
      if (!groupName) return;
      if (activeBook && !activeBook.groupByGroups) {
        updateBook(activeBook.id, { groupByGroups: true });
      }
      if (activeBook?.collapsedGroups?.includes(groupName)) {
        toggleGroupCollapsed(groupName);
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const grpEl = wrapperRef.current?.querySelector(
            `[data-group-header="${CSS.escape(groupName)}"]`
          );
          grpEl?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        });
      });
    };

    window.addEventListener('cuaderno:highlight-student', onHighlightStudent);
    window.addEventListener('cuaderno:highlight-group', onHighlightGroup);
    return () => {
      window.removeEventListener('cuaderno:highlight-student', onHighlightStudent);
      window.removeEventListener('cuaderno:highlight-group', onHighlightGroup);
    };
  }, [
    activeBook?.collapsedGroups,
    activeBook?.groupByGroups,
    activeBook?.id,
    selectEntireStudentRow,
    toggleGroupCollapsed,
    updateBook,
  ]);

  const selectStudentColHeader = useCallback(() => {
    setSelectedStudentColHeader(true);
    setSelectedStudentRowId(null);
    setSelectedColumnTarget(null);
    setSelectedGroupColCell(null);
    setSelectedSummaryCell(null);
    setSelectedKeys(new Set());
    setSelectedCoord(null);
    setAnchorCoord(null);
    wrapperRef.current?.focus({ preventScroll: true });
  }, []);

  const clearAllSelection = useCallback(() => {
    setSelectedCoord(null);
    setAnchorCoord(null);
    setSelectedKeys(new Set());
    setSelectedStudentRowId(null);
    setSelectedStudentColHeader(false);
    setQuickCounterColumnId(null);
    setSelectedColumnTarget(null);
    setSelectedGroupColCell(null);
    setSelectedSummaryCell(null);
  }, []);

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    if (copyToastTimerRef.current) window.clearTimeout(copyToastTimerRef.current);
    copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 2400);
  }, []);

  const handleRestoreOriginalSelection = useCallback(
    (targets: Array<{ studentId: string; columnId: string }>) => {
      if (targets.length === 0) return;
      restoreOriginalGrades(targets);
      showCopyToast(
        targets.length === 1
          ? 'Nota original restaurada'
          : `${targets.length} notas originales restauradas`
      );
    },
    [restoreOriginalGrades, showCopyToast]
  );

  const copyColumnAlphabetical = useCallback(
    (target: SelectedColumnTarget) => {
      if (!activeBook) return false;
      const { text, studentCount } = buildAlphabeticalColumnCopyText(activeBook, target);
      lastCopiedTextRef.current = text;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
          // fallback ignored
        });
      }
      const title = target.kind === 'COL' ? target.col.title : target.folder.title;
      showCopyToast(`«${title}» copiada (${studentCount} alumnos · orden alfabético por apellidos)`);
      return true;
    },
    [activeBook, showCopyToast]
  );

  const triggerFillEmptyWithNP = useCallback(
    (columnIds: string[], targetLabel: string) => {
      const res = fillEmptyGradesWithNP(columnIds);
      if (res.filledCount === 0) {
        showCopyToast(`«${targetLabel}» no tiene celdas sin nota`);
        return;
      }
      showCopyToast(
        `«${targetLabel}»: ${res.filledCount} ${
          res.filledCount === 1 ? 'celda sin nota rellenada' : 'celdas sin nota rellenadas'
        } con 0 (NP)`
      );
    },
    [fillEmptyGradesWithNP, showCopyToast]
  );

  /**
   * Builds a TSV payload for the currently selected cell(s) or selected column.
   * - If an entire column (or folder summary column) is selected, ALWAYS copies ALL active students
   *   in strict alphabetical order by Apellidos (A-Z), regardless of active sort/groups.
   * - RUBRIC grades are ALWAYS copied on the 0–10 scale (never "%").
   */
  const buildSelectionCopyText = useCallback((): string | null => {
    if (!activeBook) return null;
    if (selectedColumnTarget) {
      return buildAlphabeticalColumnCopyText(activeBook, selectedColumnTarget).text;
    }

    if (selectedStudentRowId && !selectedCoord && selectedKeys.size === 0) {
      if (displaySlots.length === 0) return null;
      return displaySlots
        .map((slot) => {
          if (slot.kind === 'FOLDER_SUMMARY') {
            const val = computeFolderSummary(
              slot.folder,
              slot.childCols,
              selectedStudentRowId,
              activeBook
            );
            return val !== null ? formatGrade(val, 2) : '';
          }
          if (slot.kind === 'RUBRIC_CRITERION') {
            const evalData = activeBook.cells[cellKey(selectedStudentRowId, slot.col.id)]?.rubricEval;
            const critRes = computeRubricCriterionResult(slot.rubric, slot.criterion.id, evalData);
            return critRes ? formatCellCopyValue(critRes.grade, slot.col) : '';
          }
          const cell = activeBook.cells[cellKey(selectedStudentRowId, slot.col.id)];
          const gradeStr = formatCellCopyValue(cell?.grade ?? null, slot.col);
          return gradeStr || cell?.comment || '';
        })
        .join('\t');
    }

    const keysToRead =
      selectedKeys.size > 0
        ? Array.from(selectedKeys)
        : selectedCoord
          ? [cellKey(selectedCoord.studentId, selectedCoord.columnId)]
          : [];
    if (keysToRead.length === 0) return null;

    const rowIndexMap = new Map(visibleStudents.map((s, idx) => [s.id, idx]));
    const slotMap = new Map<string, { idx: number; slot: DisplaySlot }>();
    displaySlots.forEach((slot, idx) => {
      slotMap.set(getDisplaySlotId(slot), { idx, slot });
    });

    const rowMap = new Map<number, Map<number, string>>();
    const colSet = new Set<number>();

    for (const k of keysToRead) {
      const sep = k.indexOf('::');
      if (sep < 0) continue;
      const studentId = k.slice(0, sep);
      const slotId = k.slice(sep + 2);
      const rIdx = rowIndexMap.get(studentId);
      const slotEntry = slotMap.get(slotId);
      if (rIdx === undefined || !slotEntry) continue;

      colSet.add(slotEntry.idx);
      let textVal = '';
      if (slotEntry.slot.kind === 'FOLDER_SUMMARY') {
        const val = computeFolderSummary(
          slotEntry.slot.folder,
          slotEntry.slot.childCols,
          studentId,
          activeBook
        );
        textVal = val !== null ? formatGrade(val, 2) : '';
      } else if (slotEntry.slot.kind === 'RUBRIC_CRITERION') {
        const evalData = activeBook.cells[cellKey(studentId, slotEntry.slot.col.id)]?.rubricEval;
        const critRes = computeRubricCriterionResult(
          slotEntry.slot.rubric,
          slotEntry.slot.criterion.id,
          evalData
        );
        textVal = critRes ? formatCellCopyValue(critRes.grade, slotEntry.slot.col) : '';
      } else {
        const cell = activeBook.cells[cellKey(studentId, slotEntry.slot.col.id)];
        const gradeStr = formatCellCopyValue(cell?.grade ?? null, slotEntry.slot.col);
        textVal = gradeStr || cell?.comment || '';
      }
      const cols = rowMap.get(rIdx) ?? new Map<number, string>();
      cols.set(slotEntry.idx, textVal);
      rowMap.set(rIdx, cols);
    }

    if (rowMap.size === 0) return null;

    const sortedRows = [...rowMap.keys()].sort((a, b) => a - b);
    const sortedCols = [...colSet].sort((a, b) => a - b);

    return sortedRows
      .map((r) => {
        const cols = rowMap.get(r)!;
        return sortedCols.map((c) => cols.get(c) ?? '').join('\t');
      })
      .join('\n');
  }, [
    activeBook,
    selectedColumnTarget,
    selectedStudentRowId,
    selectedKeys,
    selectedCoord,
    visibleStudents,
    displaySlots,
  ]);

  const stepCellByDelta = useCallback(
    (studentId: string, col: ColumnEntity, delta: number) => {
      if (!activeBook || activeTab?.isLocked || col.isLocked || col.type !== 'NUMERIC') return;
      const existing = activeBook.cells[cellKey(studentId, col.id)];
      const nextGrade = applyCounterDelta(existing?.grade ?? null, delta, col);
      setCellData(studentId, col.id, nextGrade, existing?.comment ?? '');
    },
    [activeBook, activeTab?.isLocked, setCellData]
  );

  const copySelectionToClipboard = useCallback(() => {
    if (selectedColumnTarget) {
      return copyColumnAlphabetical(selectedColumnTarget);
    }
    const text = buildSelectionCopyText();
    if (text === null) return false;
    lastCopiedTextRef.current = text;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        // fallback ignored
      });
    }
    const count = Math.max(1, selectedKeys.size, selectedTargets.length);
    showCopyToast(
      count > 1 ? `${count} celdas copiadas (escala 0–10)` : `Copiado: ${text || 'vacío'}`
    );
    return true;
  }, [
    selectedColumnTarget,
    copyColumnAlphabetical,
    buildSelectionCopyText,
    selectedTargets.length,
    selectedKeys.size,
    showCopyToast,
  ]);

  const pasteTextIntoGrid = useCallback(
    (rawText: string) => {
      if (!activeBook || activeTab?.isLocked) return false;
      const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalized.endsWith('\n')
        ? normalized.slice(0, -1).split('\n')
        : normalized.split('\n');
      const matrix = lines.map((line) => line.split('\t'));
      if (matrix.length === 0 || (matrix.length === 1 && matrix[0].length === 0)) return false;

      const isSingleValue = matrix.length === 1 && matrix[0].length === 1;

      // Case 1: single value pasted onto a multi-cell selection -> fill all selected editable cells
      if (isSingleValue && editableNumericTargets.length > 1) {
        const parsed = parseMixedInput(matrix[0][0]);
        applyCellsBatch(
          editableNumericTargets.map((t) => ({
            studentId: t.studentId,
            columnId: t.columnId,
            grade: parsed.grade,
            comment: parsed.comment,
          }))
        );
        showCopyToast(`Pegado en ${editableNumericTargets.length} celdas`);
        return true;
      }

      // Case 2: matrix paste anchored at top-left of selection (or focused cell)
      let startRow = -1;
      let startCol = -1;
      if (selectedCoord) {
        startRow = visibleStudents.findIndex((s) => s.id === selectedCoord.studentId);
        startCol = slotIdsInOrder.indexOf(selectedCoord.columnId);
      }
      if (selectedTargets.length > 1) {
        const rIdxs = selectedTargets
          .map((t) => visibleStudents.findIndex((s) => s.id === t.studentId))
          .filter((i) => i >= 0);
        const cIdxs = selectedTargets
          .map((t) => slotIdsInOrder.indexOf(t.columnId))
          .filter((i) => i >= 0);
        if (rIdxs.length > 0 && cIdxs.length > 0) {
          startRow = Math.min(...rIdxs);
          startCol = Math.min(...cIdxs);
        }
      }
      if (startRow < 0 || startCol < 0) return false;

      const entries: Array<{
        studentId: string;
        columnId: string;
        grade: number | null;
        comment: string;
      }> = [];

      for (let dr = 0; dr < matrix.length; dr++) {
        const st = visibleStudents[startRow + dr];
        if (!st) break;
        for (let dc = 0; dc < matrix[dr].length; dc++) {
          const targetSlot = displaySlots[startCol + dc];
          if (!targetSlot) break;
          const targetId =
            targetSlot.kind === 'FOLDER_SUMMARY' ? targetSlot.key : targetSlot.col.id;
          const targetInfo = resolveEditableTarget(targetId);
          if (!targetInfo || !canTypeInline(targetInfo.col)) continue;
          const parsed = parseMixedInput(matrix[dr][dc]);
          entries.push({
            studentId: st.id,
            columnId: targetInfo.col.id,
            grade: parsed.grade,
            comment: parsed.comment,
          });
        }
      }

      if (entries.length === 0) return false;
      applyCellsBatch(entries);
      showCopyToast(
        entries.length === 1 ? 'Pegado en 1 celda' : `Pegadas ${entries.length} celdas`
      );
      return true;
    },
    [
      activeBook,
      activeTab?.isLocked,
      editableNumericTargets,
      selectedCoord,
      selectedTargets,
      visibleStudents,
      slotIdsInOrder,
      displaySlots,
      resolveEditableTarget,
      canTypeInline,
      applyCellsBatch,
      showCopyToast,
    ]
  );

  const startInlineEditForCell = useCallback(
    (
      studentId: string,
      columnId: string,
      initialChar: string | null,
      applyToSelection = false
    ) => {
      if (!activeBook) return;
      const targetInfo = resolveEditableTarget(columnId);
      if (!targetInfo || !canTypeInline(targetInfo.col)) return;
      const { col, isFolder, folder, childCols } = targetInfo;

      const existing = activeBook.cells[cellKey(studentId, col.id)];
      const calculatedFolderGrade =
        isFolder && folder && childCols
          ? computeFolderSummary(folder, childCols, studentId, activeBook)
          : null;
      const initialGrade = isFolder
        ? (existing?.manualOverride ? existing.grade : calculatedFolderGrade)
        : (existing?.grade ?? null);
      const initialComment = existing?.comment ?? null;
      const isRubricAuto = !isFolder && col.type === 'RUBRIC' && !existing?.manualOverride;
      const isFolderAuto = isFolder && !existing?.manualOverride;

      let baseDraft = '';
      let mode: 'TYPE_OVER' | 'FULL_EDIT' = 'TYPE_OVER';
      let cursorPos: number | undefined;
      let preserveRubricGrade = false;

      if (initialChar !== null) {
        const isNumericKey = /^[0-9.,+\-]$/.test(initialChar);
        if (!applyToSelection && (isRubricAuto || isFolderAuto)) {
          if (!isNumericKey) {
            // Typing comment text on a calculated rubric/folder cell: preserve live formula grade!
            preserveRubricGrade = true;
            mode = 'FULL_EDIT';
            const prevComment = existing?.comment ?? '';
            if (prevComment) {
              const sep =
                initialChar === ' ' || /^[,.;:!?)]$/.test(initialChar) ? '' : ' ';
              baseDraft = `${prevComment}${sep}${initialChar}`;
            } else {
              baseDraft = initialChar === ' ' ? '' : initialChar;
            }
          } else if (existing?.comment) {
            mode = 'FULL_EDIT';
            baseDraft = `${initialChar} ${existing.comment}`;
            cursorPos = initialChar.length;
          } else {
            mode = 'TYPE_OVER';
            baseDraft = initialChar;
            cursorPos = initialChar.length;
          }
        } else if (!applyToSelection && existing && (existing.comment || existing.grade !== null)) {
          if (!isNumericKey) {
            mode = 'FULL_EDIT';
            const numPart =
              existing.grade !== null && existing.grade !== undefined
                ? String(existing.grade)
                : '';
            const prevComment = existing.comment ?? '';
            if (prevComment) {
              const sep =
                initialChar === ' ' || /^[,.;:!?)]$/.test(initialChar) ? '' : ' ';
              baseDraft = [numPart, `${prevComment}${sep}${initialChar}`]
                .filter(Boolean)
                .join(' ');
            } else {
              const charPart = initialChar === ' ' ? '' : initialChar;
              baseDraft = numPart ? (charPart ? `${numPart} ${charPart}` : `${numPart} `) : charPart;
            }
          } else if (existing.comment) {
            mode = 'FULL_EDIT';
            baseDraft = `${initialChar} ${existing.comment}`;
            cursorPos = initialChar.length;
          } else {
            mode = 'TYPE_OVER';
            baseDraft = initialChar;
            cursorPos = initialChar.length;
          }
        } else {
          baseDraft = initialChar === ' ' ? '' : initialChar;
          mode = 'TYPE_OVER';
        }
      } else if (!applyToSelection && (existing || (isFolder && calculatedFolderGrade !== null))) {
        mode = 'FULL_EDIT';
        if (isRubricAuto) {
          preserveRubricGrade = true;
          baseDraft = existing?.comment ?? '';
        } else {
          const numPart =
            initialGrade !== null && initialGrade !== undefined
              ? String(initialGrade)
              : '';
          baseDraft = [numPart, existing?.comment].filter(Boolean).join(' ');
        }
      }

      skipNextBlurRef.current = false;
      inlineCursorInitKeyRef.current = null;
      if (!applyToSelection) {
        selectSingleCell(studentId, columnId);
      } else {
        setSelectedCoord({ studentId, columnId });
      }
      ensureCellVisible(studentId, columnId, 'auto');
      const cellElNow = getCellNode(studentId, columnId);
      if (cellElNow) {
        const r = cellElNow.getBoundingClientRect();
        setInlineEditRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
      setInlineEdit({
        studentId,
        columnId,
        draft: baseDraft,
        applyToSelection,
        initialGrade,
        initialComment,
        mode,
        cursorPos,
        preserveRubricGrade,
      });
    },
    [activeBook, resolveEditableTarget, canTypeInline, selectSingleCell, ensureCellVisible]
  );

  const moveSelection = useCallback(
    (
      fromStudentId: string,
      fromColumnId: string,
      dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT',
      startInlineAfter = false,
      extendRange = false
    ) => {
      const rIdx = visibleStudents.findIndex((s) => s.id === fromStudentId);
      const cIdx = slotIdsInOrder.indexOf(fromColumnId);
      if (rIdx < 0 || cIdx < 0) return;

      let nr = rIdx;
      let nc = cIdx;
      if (dir === 'UP') nr = Math.max(0, rIdx - 1);
      else if (dir === 'DOWN') nr = Math.min(visibleStudents.length - 1, rIdx + 1);
      else if (dir === 'LEFT') nc = Math.max(0, cIdx - 1);
      else if (dir === 'RIGHT') nc = Math.min(displaySlots.length - 1, cIdx + 1);

      const nextSt = visibleStudents[nr];
      const nextSlot = displaySlots[nc];
      if (!nextSt || !nextSlot) return;
      const nextSlotId = nextSlot.kind === 'FOLDER_SUMMARY' ? nextSlot.key : nextSlot.col.id;

      if (extendRange) {
        const anchor = anchorCoord ?? { studentId: fromStudentId, columnId: fromColumnId };
        selectRangeToCell(anchor, { studentId: nextSt.id, columnId: nextSlotId }, false);
        focusCell(nextSt.id, nextSlotId);
        ensureCellVisible(nextSt.id, nextSlotId, 'auto');
        return;
      }

      selectSingleCell(nextSt.id, nextSlotId);
      if (startInlineAfter && canTypeInlineTarget(nextSlotId)) {
        startInlineEditForCell(nextSt.id, nextSlotId, null, false);
      } else {
        focusCell(nextSt.id, nextSlotId);
      }
      ensureCellVisible(nextSt.id, nextSlotId, 'auto');
    },
    [
      visibleStudents,
      slotIdsInOrder,
      displaySlots,
      anchorCoord,
      selectRangeToCell,
      selectSingleCell,
      canTypeInlineTarget,
      startInlineEditForCell,
      focusCell,
      ensureCellVisible,
    ]
  );

  const commitInlineEdit = useCallback(
    (advanceDir: 'STAY' | 'DOWN' | 'RIGHT') => {
      if (!inlineEdit) return;
      skipNextBlurRef.current = true;
      const {
        studentId,
        columnId,
        draft,
        applyToSelection,
        initialGrade,
        initialComment,
        mode,
        preserveRubricGrade,
      } = inlineEdit;
      const targetInfo = resolveEditableTarget(columnId);
      const col = targetInfo?.col;
      const persistColumnId = col?.id ?? columnId;

      const parsed = parseMixedInput(draft);

      if (applyToSelection && editableNumericTargets.length > 1) {
        const isGradeOnly = parsed.grade !== null && !parsed.comment;
        const isCommentOnly = parsed.grade === null && Boolean(parsed.comment);

        setMultipleCellsData(
          editableNumericTargets,
          parsed.grade,
          parsed.comment,
          {
            preserveExistingComment: isGradeOnly,
            preserveExistingGrade: isCommentOnly,
          }
        );
        setInlineEdit(null);
        focusCell(studentId, columnId);
        return;
      }

      if (preserveRubricGrade && (col?.type === 'RUBRIC' || targetInfo?.isFolder) && parsed.grade === null) {
        setCellData(studentId, persistColumnId, null, draft.trim(), { preserveExistingGrade: true });
        setInlineEdit(null);
        if (advanceDir === 'DOWN') {
          moveSelection(studentId, columnId, 'DOWN', true);
        } else if (advanceDir === 'RIGHT') {
          moveSelection(studentId, columnId, 'RIGHT', true);
        } else {
          focusCell(studentId, columnId);
        }
        return;
      }

      let finalGrade = parsed.grade;
      let finalComment = parsed.comment;

      if (mode === 'TYPE_OVER') {
        if (parsed.grade !== null && !parsed.comment && initialComment) {
          finalComment = initialComment;
        } else if (parsed.grade === null && parsed.comment && initialGrade !== null && initialGrade !== undefined) {
          finalGrade = initialGrade;
        } else if (parsed.grade === null && !parsed.comment) {
          finalGrade = initialGrade ?? null;
          finalComment = initialComment ?? '';
        }
      }

      const clamped = col ? clampGradeForColumn(finalGrade, col) : finalGrade;
      setCellData(studentId, persistColumnId, clamped, finalComment);
      setInlineEdit(null);

      if (advanceDir === 'DOWN') {
        moveSelection(studentId, columnId, 'DOWN', true);
      } else if (advanceDir === 'RIGHT') {
        moveSelection(studentId, columnId, 'RIGHT', true);
      } else {
        focusCell(studentId, columnId);
      }
    },
    [
      inlineEdit,
      resolveEditableTarget,
      editableNumericTargets,
      setMultipleCellsData,
      setCellData,
      moveSelection,
      focusCell,
    ]
  );

  const cancelInlineEdit = useCallback(() => {
    if (!inlineEdit) return;
    skipNextBlurRef.current = true;
    const { studentId, columnId } = inlineEdit;
    setInlineEdit(null);
    focusCell(studentId, columnId);
  }, [inlineEdit, focusCell]);

  // Global keyboard handler when cell is selected (allows interaction when a modal is DOCKED non-modal, blocks only for blocking :modal dialogs or clicks inside a <dialog>)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const inInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';

      if (document.querySelector('dialog[open]:modal')) return;
      if (target?.closest('dialog')) return;

      if (isMod && e.key.toLowerCase() === 'z' && !inInput) {
        e.preventDefault();
        undo();
        return;
      }

      if (isMod && !inInput && !inlineEdit) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          commitSteppedZoom(gridZoom + 0.1);
          return;
        }
        if (e.key === '-') {
          e.preventDefault();
          commitSteppedZoom(gridZoom - 0.1);
          return;
        }
        if (e.key === '0') {
          e.preventDefault();
          commitSteppedZoom(1);
          return;
        }
      }

      if (inlineEdit || inInput) return;

      // Never allow keyboard keys to scroll the gradebook viewport — arrows move strictly between cells
      const isArrowKey =
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight';
      const isScrollKey =
        isArrowKey ||
        e.key === 'PageUp' ||
        e.key === 'PageDown' ||
        e.key === 'Home' ||
        e.key === 'End' ||
        e.key === ' ';

      if (isScrollKey) {
        e.preventDefault();
      }

      if (isMod && e.key.toLowerCase() === 'c') {
        if (copySelectionToClipboard()) {
          e.preventDefault();
        }
        return;
      }

      if (!selectedCoord) {
        if (selectedStudentRowId) {
          if (e.key === 'Escape') {
            e.preventDefault();
            setSelectedStudentRowId(null);
            return;
          }
          const stIdx = visibleStudents.findIndex((s) => s.id === selectedStudentRowId);
          if (stIdx >= 0) {
            if (e.key === 'ArrowDown' && stIdx < visibleStudents.length - 1) {
              e.preventDefault();
              setSelectedStudentRowId(visibleStudents[stIdx + 1].id);
              return;
            }
            if (e.key === 'ArrowUp' && stIdx > 0) {
              e.preventDefault();
              setSelectedStudentRowId(visibleStudents[stIdx - 1].id);
              return;
            }
            if (e.key === 'ArrowRight' && slotIdsInOrder.length > 0) {
              e.preventDefault();
              selectSingleCell(selectedStudentRowId, slotIdsInOrder[0]);
              focusCell(selectedStudentRowId, slotIdsInOrder[0]);
              return;
            }
          }
        }
        if (isArrowKey && visibleStudents.length > 0 && slotIdsInOrder.length > 0) {
          selectSingleCell(visibleStudents[0].id, slotIdsInOrder[0]);
          focusCell(visibleStudents[0].id, slotIdsInOrder[0]);
        }
        return;
      }

      const { studentId, columnId } = selectedCoord;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(studentId, columnId, 'UP', false, e.shiftKey);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(studentId, columnId, 'DOWN', false, e.shiftKey);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveSelection(studentId, columnId, 'LEFT', false, e.shiftKey);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveSelection(studentId, columnId, 'RIGHT', false, e.shiftKey);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        moveSelection(studentId, columnId, e.shiftKey ? 'LEFT' : 'RIGHT');
      } else if (e.key === 'Enter') {
        if (e.isComposing || e.keyCode === 229) return;
        if (target?.tagName === 'BUTTON') return;
        e.preventDefault();
        if (sameRubricColSelection) {
          onOpenRubricGrader(null, sameRubricColSelection.col, {
            groupName: `${sameRubricColSelection.studentIds.length} alumnos seleccionados`,
            studentIds: sameRubricColSelection.studentIds,
          });
          return;
        }
        if (sameCriterionSelection) {
          const cellNode = getCellNode(studentId, columnId);
          const rect = cellNode?.getBoundingClientRect();
          if (rect) {
            const { col, rubric, criterion, criterionIndex } = sameCriterionSelection.critSlot;
            setCriterionPicker({
              studentIds: sameCriterionSelection.studentIds,
              studentLabel: `${sameCriterionSelection.studentIds.length} alumnos seleccionados`,
              col,
              rubric,
              criterion,
              criterionIndex,
              currentLevelId: null,
              top: Math.max(12, Math.min(window.innerHeight - 430, rect.bottom + 6)),
              left: Math.max(12, Math.min(window.innerWidth - 320, rect.left)),
            });
          }
          return;
        }
        if (selectedTargets.length > 1) {
          const anchorTarget =
            editableNumericTargets.find(
              (t) => t.studentId === studentId && t.columnId === columnId
            ) ?? editableNumericTargets[0];
          if (anchorTarget) {
            startInlineEditForCell(anchorTarget.studentId, anchorTarget.columnId, null, true);
          }
          return;
        }
        if (e.shiftKey && isMod) {
          moveSelection(studentId, columnId, 'RIGHT', true);
        } else if (e.shiftKey) {
          moveSelection(studentId, columnId, 'DOWN', true);
        } else {
          const critSlot = displaySlots.find(
            (s): s is Extract<DisplaySlot, { kind: 'RUBRIC_CRITERION' }> =>
              s.kind === 'RUBRIC_CRITERION' && s.key === columnId
          );
          if (critSlot) {
            const cellNode = getCellNode(studentId, columnId);
            const rect = cellNode?.getBoundingClientRect();
            const matchingStudentIds = Array.from(selectedKeys)
              .filter((k) => k.endsWith(`::${columnId}`))
              .map((k) => k.slice(0, k.indexOf('::')));
            const studentIdsForPicker =
              matchingStudentIds.length > 1 ? matchingStudentIds : [studentId];
            const stObj = visibleStudents.find((s) => s.id === studentId);
            const curLevelId =
              activeBook?.cells[cellKey(studentId, critSlot.col.id)]?.rubricEval?.selections?.[
                critSlot.criterion.id
              ]?.levelId ?? null;
            setCriterionPicker({
              studentIds: studentIdsForPicker,
              studentLabel:
                studentIdsForPicker.length > 1
                  ? `${studentIdsForPicker.length} alumnos seleccionados`
                  : stObj
                    ? `${stObj.lastName}, ${stObj.firstName}`
                    : 'Alumno',
              col: critSlot.col,
              rubric: critSlot.rubric,
              criterion: critSlot.criterion,
              criterionIndex: critSlot.criterionIndex,
              currentLevelId: studentIdsForPicker.length === 1 ? curLevelId : null,
              top: rect
                ? Math.max(12, Math.min(window.innerHeight - 360, rect.bottom + 6))
                : 160,
              left: rect
                ? Math.max(12, Math.min(window.innerWidth - 310, rect.left))
                : 200,
            });
            return;
          }
          startInlineEditForCell(studentId, columnId, null, false);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedCritKeys = (
          selectedKeys.size > 0
            ? Array.from(selectedKeys)
            : [cellKey(studentId, columnId)]
        ).filter((k) => k.includes(RUBRIC_CRIT_SEP));
        if (selectedCritKeys.length > 0 && !activeTab?.isLocked) {
          e.preventDefault();
          const bySlot = new Map<string, string[]>();
          for (const k of selectedCritKeys) {
            const sep = k.indexOf('::');
            if (sep < 0) continue;
            const sid = k.slice(0, sep);
            const slotId = k.slice(sep + 2);
            const arr = bySlot.get(slotId) ?? [];
            arr.push(sid);
            bySlot.set(slotId, arr);
          }
          for (const [slotId, sids] of bySlot.entries()) {
            const slot = displaySlots.find(
              (s): s is Extract<DisplaySlot, { kind: 'RUBRIC_CRITERION' }> =>
                s.kind === 'RUBRIC_CRITERION' && s.key === slotId
            );
            if (slot && !slot.col.isLocked) {
              setRubricCriterionForStudents(
                sids,
                slot.col.id,
                slot.rubric.id,
                slot.criterion.id,
                null
              );
            }
          }
          return;
        }
        if (clearableTargets.length > 1) {
          e.preventDefault();
          clearMultipleCells(clearableTargets);
        } else if (clearableTargets.length === 1) {
          e.preventDefault();
          clearCell(clearableTargets[0].studentId, clearableTargets[0].columnId);
        } else {
          const targetInfo = resolveEditableTarget(columnId);
          if (targetInfo && canTypeInline(targetInfo.col)) {
            e.preventDefault();
            clearCell(studentId, targetInfo.col.id);
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setLomloePicker(null);
        setEducamosMenu(null);
        setCriterionPicker(null);
        setSummaryCellPicker(null);
        setSelectedSummaryCell(null);
        setQuickCounterColumnId(null);
        clearCellTooltip();
        // Escape keeps cell selection intact without deselecting
      } else if (e.key.length === 1 && !isMod && !e.altKey) {
        if (selectedTargets.length > 1) {
          const anchorTarget =
            editableNumericTargets.find(
              (t) => t.studentId === studentId && t.columnId === columnId
            ) ?? editableNumericTargets[0];
          if (anchorTarget) {
            e.preventDefault();
            startInlineEditForCell(anchorTarget.studentId, anchorTarget.columnId, e.key, true);
          }
          return;
        }
        if (canTypeInlineTarget(columnId)) {
          e.preventDefault();
          startInlineEditForCell(studentId, columnId, e.key, false);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    inlineEdit,
    selectedCoord,
    selectedStudentRowId,
    selectedTargets.length,
    editableNumericTargets,
    clearableTargets,
    visibleStudents,
    slotIdsInOrder,
    canTypeInlineTarget,
    selectSingleCell,
    focusCell,
    moveSelection,
    startInlineEditForCell,
    clearCell,
    clearMultipleCells,
    clearAllSelection,
    copySelectionToClipboard,
    undo,
    gridZoom,
    commitSteppedZoom,
  ]);

  // Global Ctrl/Cmd + V paste handler when cell(s) are selected in the grid
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';
      if (inInput || inlineEdit) return;
      if (document.querySelector('dialog[open]:modal')) return;
      if (target?.closest('dialog')) return;
      if (!selectedCoord && selectedTargets.length === 0) return;

      const text = e.clipboardData?.getData('text/plain') || lastCopiedTextRef.current || '';
      if (!text) return;

      e.preventDefault();
      pasteTextIntoGrid(text);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [inlineEdit, selectedCoord, selectedTargets.length, pasteTextIntoGrid]);

  const baseGradeFs = workspace.settings.gradeFontSize ?? 12.5;
  const baseTextFs = workspace.settings.textFontSize ?? 13.5;
  const baseIconSz = workspace.settings.iconSize ?? 15;

  // Individual column width resize (does NOT touch other columns; never triggers click/modal on release)
  const startColumnResize = (e: React.PointerEvent, col: ColumnEntity) => {
    e.preventDefault();
    e.stopPropagation();
    justResizedRef.current = true;
    beginAspectChange();
    const startX = e.clientX;
    const startW = col.width;

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 2) {
        prevAutoFitSizesRef.current.delete(`col:${col.id}`);
      }
      resizeColumn(col.id, startW + (ev.clientX - startX) / gridZoom);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.setTimeout(() => {
        justResizedRef.current = false;
      }, 200);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const toggleAutoFitColumn = (e: React.MouseEvent, col: ColumnEntity) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeBook) return;
    const key = `col:${col.id}`;
    const saved = prevAutoFitSizesRef.current.get(key);
    if (saved && Math.abs(col.width - saved.fitted) <= 2) {
      prevAutoFitSizesRef.current.delete(key);
      resizeColumn(col.id, saved.prev);
      return;
    }

    const titleFont = `700 ${Number((baseTextFs * 0.88).toFixed(1))}px Inter, system-ui, sans-serif`;
    const gradeFont = `700 ${baseGradeFs}px Inter, system-ui, sans-serif`;
    const commentFont = `400 ${Number((baseTextFs * 0.85).toFixed(1))}px Inter, system-ui, sans-serif`;

    let maxW = measureTextPx(col.title.trim(), titleFont) + 24;
    if (col.date) {
      maxW = Math.max(maxW, measureTextPx(col.date, commentFont) + 24);
    }

    const showPct = Boolean(col.rubricShowPercentage || workspace.settings.showRubricsAsPercent);
    for (const st of visibleStudents) {
      const cell = activeBook.cells[cellKey(st.id, col.id)];
      if (!cell) continue;
      if (cell.grade !== null && cell.grade !== undefined) {
        const gStr = formatCellDisplayGrade(cell.grade, col, showPct);
        maxW = Math.max(maxW, measureTextPx(gStr, gradeFont) + 18);
      }
      if (cell.comment) {
        maxW = Math.max(maxW, measureTextPx(cell.comment, commentFont) + 18);
      }
    }

    const fitted = Math.max(36, Math.min(360, Math.ceil(maxW)));
    prevAutoFitSizesRef.current.set(key, { prev: col.width, fitted });
    resizeColumn(col.id, fitted);
  };

  // Folder own width resize (open or closed)
  const startFolderResize = (e: React.PointerEvent, folder: FolderEntity) => {
    if (!activeTab) return;
    e.preventDefault();
    e.stopPropagation();
    justResizedRef.current = true;
    beginAspectChange();
    const startX = e.clientX;
    const startW = folder.width ?? 68;
    const tabId = activeTab.id;

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 2) {
        prevAutoFitSizesRef.current.delete(`fld:${folder.id}`);
      }
      resizeFolder(tabId, folder.id, startW + (ev.clientX - startX) / gridZoom);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.setTimeout(() => {
        justResizedRef.current = false;
      }, 200);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const toggleAutoFitFolder = (
    e: React.MouseEvent,
    folder: FolderEntity,
    childCols: ColumnEntity[]
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeBook || !activeTab) return;
    const currentW = folder.width ?? 68;
    const key = `fld:${folder.id}`;
    const saved = prevAutoFitSizesRef.current.get(key);
    if (saved && Math.abs(currentW - saved.fitted) <= 2) {
      prevAutoFitSizesRef.current.delete(key);
      resizeFolder(activeTab.id, folder.id, saved.prev);
      return;
    }

    const titleFont = `700 ${Number((baseTextFs * 0.86).toFixed(1))}px Inter, system-ui, sans-serif`;
    const gradeFont = `700 ${baseGradeFs}px Inter, system-ui, sans-serif`;
    let maxW = measureTextPx(folder.title.trim(), titleFont) + 26;
    for (const st of visibleStudents) {
      const val = computeFolderSummary(folder, childCols, st.id, activeBook);
      if (val !== null) {
        maxW = Math.max(maxW, measureTextPx(formatGrade(val, 2), gradeFont) + 18);
      }
    }

    const fitted = Math.max(42, Math.min(280, Math.ceil(maxW)));
    prevAutoFitSizesRef.current.set(key, { prev: currentW, fitted });
    resizeFolder(activeTab.id, folder.id, fitted);
  };

  // Student sticky column resize
  const startStudentColResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    justResizedRef.current = true;
    beginAspectChange();
    const startX = e.clientX;
    const startW = workspace.settings.studentColWidth;

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 2) {
        prevAutoFitSizesRef.current.delete('studentCol');
      }
      const clamped = Math.max(
        150,
        Math.min(460, Math.round(startW + (ev.clientX - startX) / gridZoom))
      );
      updateSettings({ studentColWidth: clamped });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.setTimeout(() => {
        justResizedRef.current = false;
      }, 200);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const toggleAutoFitStudentCol = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeBook) return;
    const currentW = workspace.settings.studentColWidth;
    const saved = prevAutoFitSizesRef.current.get('studentCol');
    if (saved && Math.abs(currentW - saved.fitted) <= 2) {
      prevAutoFitSizesRef.current.delete('studentCol');
      updateSettings({ studentColWidth: saved.prev });
      return;
    }

    const nameFont = `600 ${baseTextFs}px Inter, system-ui, sans-serif`;
    const avatarAndChrome = Math.round(baseTextFs * 2) + 64;
    let maxW = 190;
    for (const st of activeBook.students) {
      if (st.isHidden) continue;
      const displayName =
        workspace.settings.nameFormat === 'FIRST_LAST'
          ? `${st.firstName} ${st.lastName}`
          : `${st.lastName}, ${st.firstName}`;
      maxW = Math.max(maxW, measureTextPx(displayName, nameFont) + avatarAndChrome);
    }

    const fitted = Math.max(150, Math.min(460, Math.ceil(maxW)));
    prevAutoFitSizesRef.current.set('studentCol', { prev: currentW, fitted });
    updateSettings({ studentColWidth: fitted });
  };

  // Header height resize by dragging the bottom border of <thead>
  const startHeaderHeightResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    justResizedRef.current = true;
    beginAspectChange();
    const startY = e.clientY;
    const startH = workspace.settings.headerHeight;

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) > 2) {
        prevAutoFitSizesRef.current.delete('headerHeight');
      }
      const clamped = Math.max(
        52,
        Math.min(220, Math.round(startH + (ev.clientY - startY) / gridZoom))
      );
      updateSettings({ headerHeight: clamped });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.setTimeout(() => {
        justResizedRef.current = false;
      }, 200);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Summary / Stats / Averages row height resize (applies globally to all classes & templates via workspace.settings)
  const startSummaryRowHeightResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    justResizedRef.current = true;
    beginAspectChange();
    const startY = e.clientY;
    const startH = workspace.settings.summaryRowHeight ?? 32;

    const onMove = (ev: PointerEvent) => {
      const clamped = Math.max(
        20,
        Math.min(64, Math.round(startH + (ev.clientY - startY) / gridZoom))
      );
      updateSettings({ summaryRowHeight: clamped });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.setTimeout(() => {
        justResizedRef.current = false;
      }, 200);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const toggleAutoFitHeaderHeight = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeTab) return;
    const currentH = workspace.settings.headerHeight;
    const saved = prevAutoFitSizesRef.current.get('headerHeight');
    if (saved && Math.abs(currentH - saved.fitted) <= 2) {
      prevAutoFitSizesRef.current.delete('headerHeight');
      updateSettings({ headerHeight: saved.prev });
      return;
    }

    const titleFont = `700 ${Number((baseTextFs * 0.88).toFixed(1))}px Inter, system-ui, sans-serif`;
    let maxHeaderNeeded = 68;

    const checkSlotHeight = (title: string, widthPx: number, isVertical: boolean, extraH: number) => {
      if (isVertical) {
        const textLen = measureTextPx(title.trim(), titleFont);
        const usableW = Math.max(18, widthPx - 8);
        const lines = Math.max(1, Math.ceil(textLen / Math.max(60, 140)));
        const verticalSpan = lines > 1 ? Math.min(textLen, Math.max(84, textLen * 0.72)) : textLen;
        maxHeaderNeeded = Math.max(maxHeaderNeeded, Math.min(210, verticalSpan + extraH));
        void usableW;
        return;
      }
      const usableW = Math.max(24, widthPx - 12);
      const words = title.trim().split(/\s+/).filter(Boolean);
      let lineCount = 1;
      let lineW = 0;
      const spaceW = measureTextPx(' ', titleFont);
      for (const word of words) {
        const w = measureTextPx(word, titleFont);
        if (lineW > 0 && lineW + spaceW + w > usableW) {
          lineCount += 1;
          lineW = w;
        } else {
          lineW = lineW > 0 ? lineW + spaceW + w : w;
        }
      }
      const h = lineCount * Math.ceil(baseTextFs * 1.15) + extraH;
      maxHeaderNeeded = Math.max(maxHeaderNeeded, h);
    };

    for (const slot of displaySlots) {
      if (slot.kind === 'FOLDER_SUMMARY') {
        if (!slot.isOpen) {
          const fldW = slot.folder.width ?? 68;
          checkSlotHeight(slot.folder.title, fldW, shouldRenderVerticalHeader(slot.folder.title, fldW), 22);
        }
      } else {
        const col = slot.col;
        const isStandalone = col.folderId === null;
        const vert = shouldRenderVerticalHeader(col.title, col.width, col.headerOrientation);
        const extra = isStandalone ? 4 : 32; // standalone gets canopy height (+30px) too
        checkSlotHeight(col.title, col.width, vert, extra);
      }
    }

    const fitted = Math.max(56, Math.min(220, Math.ceil(maxHeaderNeeded)));
    prevAutoFitSizesRef.current.set('headerHeight', { prev: currentH, fitted });
    updateSettings({ headerHeight: fitted });
  };

  if (!activeBook || !activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
        Crea o selecciona una clase o plantilla para empezar.
      </div>
    );
  }

  const scaledGradeFs = Number((baseGradeFs * gridZoom).toFixed(2));
  const scaledTextFs = Number((baseTextFs * gridZoom).toFixed(2));
  const scaledIconPx = Math.max(10, Math.round(baseIconSz * gridZoom));
  const smallIconPx = Math.max(9, Math.round(baseIconSz * 0.8 * gridZoom));
  const iconStyle: React.CSSProperties = { width: scaledIconPx, height: scaledIconPx };
  const smallIconStyle: React.CSSProperties = { width: smallIconPx, height: smallIconPx };
  const baseSmallIconPx = Math.max(9, Math.round(baseIconSz * 0.8));
  const baseSmallIconStyle: React.CSSProperties = {
    width: baseSmallIconPx,
    height: baseSmallIconPx,
  };

  const baseHeaderH = workspace.settings.headerHeight;
  const baseCanopyH = 30;
  const baseLomloeRowH = 60;

  // On mobile (< 640px), clamp the sticky student column visually so grades remain readable without altering desktop settings
  const effectiveStudentBaseW = device.isMobile
    ? Math.min(workspace.settings.studentColWidth, Math.max(124, Math.round(device.viewportWidth * 0.4)))
    : workspace.settings.studentColWidth;
  const studentColW = effectiveStudentBaseW * gridZoom;
  const rowH = Math.round(workspace.settings.rowHeight * gridZoom);
  const headerH = baseHeaderH * gridZoom;
  const canopyH = baseCanopyH * gridZoom;
  const activeCurriculum = resolveBookCurriculum(activeBook, workspace.lomloeCurricula);
  const keyCompetencesCatalog =
    workspace.lomloeKeyCompetences && workspace.lomloeKeyCompetences.length > 0
      ? workspace.lomloeKeyCompetences
      : DEFAULT_LOMLOE_KEY_COMPETENCES;
  const showLomloeBar =
    Boolean(activeCurriculum) && isLomloeRowVisible(activeBook, workspace.settings);
  const lomloeRowH = baseLomloeRowH * gridZoom;
  const addColW = Math.round(86 * gridZoom);
  const groupRowH = Math.max(28, Math.round(34 * gridZoom));
  const groupSpacerRows = activeBook.groupSpacerRows ?? 1;
  const groupSpacerH = Math.max(10, Math.round((workspace.settings.groupSpacerHeight ?? 24) * gridZoom));
  const summaryRowH = Math.max(18, Math.round((workspace.settings.summaryRowHeight ?? 32) * gridZoom));
  const summaryRows: ColumnSummaryMetric[] =
    workspace.settings.globalSummaryRows ?? activeBook.summaryRows ?? ['MEAN', 'PASS_PCT'];
  const groupSummaryRows: ColumnSummaryMetric[] = activeBook.groupSummaryRows ?? ['MEAN'];
  const scaledSlotsWidth = displaySlots.reduce(
    (sum, s) => sum + s.width * gridZoom,
    0
  );
  const totalTableWidth = studentColW + scaledSlotsWidth + addColW;

  const sortShortLabel = (() => {
    switch (activeBook.sortMode) {
      case 'LAST_DESC':
        return 'Apellidos ↓';
      case 'FIRST_ASC':
        return 'Nombre ↑';
      case 'FIRST_DESC':
        return 'Nombre ↓';
      case 'GRADE_DESC':
        return 'Nota ↓';
      case 'GRADE_ASC':
        return 'Nota ↑';
      case 'MANUAL':
        return 'Manual';
      case 'GROUP_ASC':
        return 'Grupo ↑';
      case 'LAST_ASC':
      default:
        return 'Apellidos ↑';
    }
  })();

  const totalActiveStudents = activeBook.students.filter((s) => !s.isHidden).length;
  const isSlotColumnSelected = (slot: DisplaySlot) =>
    (selectedColumnTarget?.kind === 'COL' &&
      (slot.kind === 'COL' || slot.kind === 'RUBRIC_CRITERION') &&
      selectedColumnTarget.col.id === slot.col.id) ||
    (selectedColumnTarget?.kind === 'FOLDER' &&
      slot.kind === 'FOLDER_SUMMARY' &&
      selectedColumnTarget.folder.id === slot.folder.id);

  const subCanopyBaseH = hasExpandedChildRubric ? Math.min(24, Math.max(20, Math.round(baseHeaderH * 0.28))) : 0;
  const subCanopyH = subCanopyBaseH * gridZoom;
  const mainHeaderRowSpan = hasExpandedChildRubric ? 3 : 2;
  const totalHeaderRows = mainHeaderRowSpan + (showLomloeBar ? 1 : 0);

  // Shared renderer for standalone columns (rowSpan=mainHeaderRowSpan in Row 1) and child / expanded-rubric columns
  const renderColumnHeaderCell = (
    col: ColumnEntity,
    isStandalone: boolean,
    inExpandedRubricFolder = false,
    rowSpanOverride?: number,
    heightOverride?: number,
    unzoomedHeightOverride?: number
  ) => {
    const hint = dropHint?.key === col.id ? dropHint.mode : null;
    const isDraggingThis = dragItem?.kind === 'COL' && dragItem.id === col.id;
    const isColSelected =
      selectedColumnTarget?.kind === 'COL' && selectedColumnTarget.col.id === col.id;
    const isVertical =
      !inExpandedRubricFolder && shouldRenderVerticalHeader(col.title, col.width, col.headerOrientation);
    const hasTopCanopy = isStandalone && !inExpandedRubricFolder;
    const cellHeight = heightOverride ?? (hasTopCanopy ? canopyH + headerH : headerH);
    const unzoomedCellH =
      unzoomedHeightOverride ?? (hasTopCanopy ? baseCanopyH + baseHeaderH : baseHeaderH);
    const effectiveRowSpan = rowSpanOverride ?? (hasTopCanopy ? mainHeaderRowSpan : undefined);
    const educamosSummary = getColumnEducamosSummary(col, activeBook.students, activeBook.cells);
    const isEducamosMenuOpen = educamosMenu?.colId === col.id;
    const colRubric = resolveColumnRubric(col);
    const canExpandRubric = Boolean(colRubric && colRubric.criteria.length > 0);
    const isRubricExpanded = canExpandRubric && Boolean(col.rubricExpanded);

    return (
      <th
        key={col.id}
        data-col-header={col.id}
        rowSpan={effectiveRowSpan}
        draggable={!activeTab.isLocked && !device.isTouch}
        onPointerDown={(e) => {
          touchDoubleTap.start(e, `hdr-col:${col.id}`);
        }}
        onPointerMove={touchDoubleTap.move}
        onPointerUp={(e) => {
          touchDoubleTap.end(e, `hdr-col:${col.id}`, () => {
            if (justResizedRef.current) return;
            selectEntireColumn(col);
            onEditColumn(col);
          });
        }}
        onPointerCancel={touchDoubleTap.cancel}
        onDragStart={(e) => {
          const payload: DragItemPayload = { kind: 'COL', id: col.id };
          setDragItem({ kind: 'COL', id: col.id, folderId: col.folderId });
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
          e.dataTransfer.setData('text/plain', col.id);
        }}
        onDragEnd={clearDrag}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragItem) return;
          if (dragItem.kind === 'COL' && dragItem.id === col.id) return;
          if (dragItem.kind === 'FOLDER' && col.folderId === dragItem.id) return;
          setDropHint({ key: col.id, mode: getPointerHalf(e) });
        }}
        onDragLeave={() => {
          if (dropHint?.key === col.id) setDropHint(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const payload = readDragPayload(e);
          if (payload) {
            if (payload.kind === 'COL' && payload.id !== col.id) {
              moveItemInActiveTab(payload, {
                kind: 'COL',
                id: col.id,
                position: getPointerHalf(e),
              });
            } else if (payload.kind === 'FOLDER' && col.folderId !== payload.id) {
              moveItemInActiveTab(payload, {
                kind: 'COL',
                id: col.id,
                position: getPointerHalf(e),
              });
            }
          }
          clearDrag();
        }}
        onClick={(e) => {
          if (justResizedRef.current || touchDoubleTap.wasDoubleTapJustHandled()) {
            return;
          }
          e.stopPropagation();
          if (
            !e.shiftKey &&
            !e.metaKey &&
            !e.ctrlKey &&
            touchDoubleTap.handleTouchClick(
              `hdr-col:${col.id}`,
              () => {
                selectEntireColumn(col);
                onEditColumn(col);
              },
              device.isTouch
            )
          ) {
            return;
          }
          selectEntireColumn(col);
        }}
        onDoubleClick={(e) => {
          if (justResizedRef.current || touchDoubleTap.wasDoubleTapJustHandled()) return;
          e.stopPropagation();
          onEditColumn(col);
        }}
        onContextMenu={(e) => {
          if (justResizedRef.current) return;
          e.preventDefault();
          e.stopPropagation();
          selectEntireColumn(col);
          onEditColumn(col);
        }}
        style={{
          height: cellHeight,
          backgroundColor: col.color,
          boxShadow:
            hint === 'BEFORE'
              ? 'inset 3px 0 0 #2563EB'
              : hint === 'AFTER'
                ? 'inset -3px 0 0 #2563EB'
                : undefined,
        }}
        title={`${col.title} — 1 clic: seleccionar columna · Doble clic o clic derecho: editar · Arrastra borde derecho para ancho`}
        className={`border-r border-b border-slate-300 ${
          inExpandedRubricFolder
            ? 'border-t-0'
            : !isStandalone
              ? 'border-t border-t-slate-300/80'
              : ''
        } p-0 relative group cursor-pointer transition-[background-color,border-color,color,filter,opacity,box-shadow] align-middle overflow-hidden hover:brightness-97 ${
          isDraggingThis ? 'opacity-60' : ''
        } ${isColSelected ? 'col-header-selected' : ''}`}
      >
        {/* Fixed-dimension inner layer scaled smoothly so zoom NEVER reflows or shifts header titles */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: col.width,
            height: unzoomedCellH,
            fontSize: `${baseTextFs}px`,
            transform: `scale(${gridZoom})`,
            transformOrigin: 'top left',
          }}
          className="px-1 py-1 relative overflow-hidden"
        >
          {/* Discreet 1-click Educamos status & update button */}
          <button
            type="button"
            data-educamos-col-btn={col.id}
            aria-expanded={isEducamosMenuOpen}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setEducamosMenu((prev) =>
                prev?.colId === col.id
                  ? null
                  : {
                      colId: col.id,
                      rect: {
                        top: r.top,
                        bottom: r.bottom,
                        left: r.left,
                        right: r.right,
                      },
                    }
              );
            }}
            title={
              educamosSummary.state === 'SYNCED'
                ? 'Educamos: columna pasada y al día · Pulsa para opciones'
                : educamosSummary.state === 'OUTDATED'
                  ? `Educamos: ${educamosSummary.dirtyCount} celda(s) modificada(s) desde la última pasada · Pulsa para actualizar`
                  : 'Educamos: pendiente de pasar · Pulsa para marcar como pasada'
            }
            aria-label={
              educamosSummary.state === 'SYNCED'
                ? `Educamos: ${col.title} pasada`
                : educamosSummary.state === 'OUTDATED'
                  ? `Educamos: ${col.title} con ${educamosSummary.dirtyCount} cambios pendientes`
                  : `Educamos: marcar ${col.title}`
            }
            className={`absolute top-1 left-1 z-20 h-5 px-1.5 rounded-md border flex items-center justify-center gap-0.5 text-[10px] font-extrabold leading-none shadow-2xs transition-all ${
              educamosSummary.state === 'SYNCED'
                ? 'bg-emerald-600 border-emerald-700/30 text-white opacity-100 hover:bg-emerald-700'
                : educamosSummary.state === 'OUTDATED'
                  ? 'bg-orange-500 border-orange-600/40 text-white ring-2 ring-orange-200 opacity-100 hover:bg-orange-600'
                  : `bg-white/90 border-slate-300/80 text-slate-600 hover:bg-slate-800 hover:text-white ${
                      isColSelected || isEducamosMenuOpen || device.isTouch
                        ? 'opacity-95'
                        : 'opacity-40 group-hover:opacity-100 focus:opacity-100'
                    }`
            }`}
          >
            <span>E</span>
            {educamosSummary.state === 'SYNCED' && <Check className="w-2.5 h-2.5 stroke-[3]" aria-hidden="true" />}
            {educamosSummary.state === 'OUTDATED' && (
              <span className="tabular-nums">·{educamosSummary.dirtyCount}</span>
            )}
          </button>

          {/* Discreet 1-click Copy Column button (ALWAYS alphabetical by Apellidos!) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              copyColumnAlphabetical({ kind: 'COL', col });
            }}
            title="Copiar columna entera en orden alfabético por apellidos (Apellidos A–Z)"
            aria-label={`Copiar columna ${col.title} por apellidos`}
            className={`absolute top-1 right-1 z-20 w-5 h-5 rounded-md bg-white/90 hover:bg-blue-600 hover:text-white text-slate-700 border border-slate-300/80 flex items-center justify-center shadow-2xs transition-opacity ${
              isColSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
            }`}
          >
            <Copy style={baseSmallIconStyle} />
          </button>

          <div
            style={{
              height: Math.max(24, unzoomedCellH - 8),
              maxHeight: Math.max(24, unzoomedCellH - 8),
            }}
            className="flex flex-col items-center justify-between gap-0.5 overflow-hidden"
          >
            {inExpandedRubricFolder ? (
              <>
                <div className="flex-1 flex flex-col items-center justify-center w-full min-h-0 px-0.5 pt-4 gap-0.5">
                  <span className="text-[0.76em] font-semibold text-purple-950/75 uppercase tracking-wide leading-none">
                    Total
                  </span>
                </div>
                <div className="w-full flex items-center justify-center gap-0.5 text-[0.76em] text-slate-600 shrink-0 min-h-[14px]">
                  {col.date && <span className="truncate">{col.date}</span>}
                  {col.isLocked && (
                    <Lock style={baseSmallIconStyle} className="text-slate-600 shrink-0" />
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden px-0.5">
                  <span
                    style={isVertical ? { maxHeight: Math.max(20, unzoomedCellH - 28) } : undefined}
                    className={`text-[0.88em] font-bold text-slate-900 leading-tight whitespace-normal break-normal [overflow-wrap:normal] [word-break:normal] ${
                      isVertical
                        ? '[writing-mode:vertical-rl] rotate-180 overflow-hidden text-left'
                        : 'text-center w-full'
                    }`}
                  >
                    {col.title}
                  </span>
                </div>

                <div className="w-full flex items-center justify-center gap-0.5 text-[0.76em] text-slate-600 shrink-0 min-h-[14px]">
                  {col.date && !isVertical && <span className="truncate">{col.date}</span>}
                  {col.isLocked && <Lock style={baseSmallIconStyle} className="text-slate-600 shrink-0" />}
                  {col.type === 'AVERAGE' && (
                    <Calculator style={baseSmallIconStyle} className="text-amber-700 shrink-0" />
                  )}
                  {col.type === 'RUBRIC' && !canExpandRubric && (
                    <LayoutGrid style={baseSmallIconStyle} className="text-purple-700 shrink-0" />
                  )}
                  {col.type === 'RUBRIC' && canExpandRubric && colRubric && (
                    <button
                      type="button"
                      data-rubric-expand-btn={col.id}
                      aria-expanded={isRubricExpanded}
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleColumnRubricExpanded(col.id);
                      }}
                      title={
                        isRubricExpanded
                          ? `Plegar subcolumnas de criterios (${colRubric.criteria.length})`
                          : `Abrir rúbrica en ${colRubric.criteria.length} subcolumnas de criterios`
                      }
                      aria-label={
                        isRubricExpanded
                          ? `Plegar criterios de ${col.title}`
                          : `Abrir criterios de ${col.title}`
                      }
                      className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded border text-[9px] font-bold leading-none shadow-2xs transition-colors shrink-0 ${
                        isRubricExpanded
                          ? 'bg-purple-600 border-purple-700 text-white hover:bg-purple-700'
                          : 'bg-white/90 border-purple-300 text-purple-800 hover:bg-purple-600 hover:text-white'
                      }`}
                    >
                      <LayoutGrid className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                      <span>{colRubric.criteria.length}</span>
                      {isRubricExpanded ? (
                        <ChevronsLeft className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <ChevronsRight className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Independent Right-Edge Width Resize Handle (Tablet: only after column is selected!) */}
        {(!device.isTouch || isColSelected) && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Cambiar anchura de ${col.title}`}
            title="Arrastra para ajustar ancho · Doble clic: ajustar al texto más largo"
            style={device.isTouch ? { touchAction: 'none' } : undefined}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => toggleAutoFitColumn(e, col)}
            onPointerDown={(e) => startColumnResize(e, col)}
            className={`absolute top-0 right-0 ${
              device.isTouch ? 'w-3.5 bg-blue-500/20' : 'w-1.5'
            } h-full cursor-col-resize hover:bg-blue-500/60 transition-colors z-20`}
          />
        )}
        {/* Bottom-Edge Header Height Resize Handle (Tablet: only after column is selected!) */}
        {(!device.isTouch || isColSelected) && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Cambiar altura de cabecera"
            title="Arrastra para ajustar altura de cabecera · Doble clic: autoajustar"
            style={device.isTouch ? { touchAction: 'none' } : undefined}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={toggleAutoFitHeaderHeight}
            onPointerDown={startHeaderHeightResize}
            className={`absolute left-0 bottom-0 w-full ${
              device.isTouch ? 'h-3 bg-blue-500/20' : 'h-1.5'
            } cursor-row-resize hover:bg-blue-500/60 transition-colors z-20`}
          />
        )}
      </th>
    );
  };

  return (
    <div className="flex-1 min-h-0 relative flex flex-col bg-slate-50">
      <div className="flex-1 min-h-0 relative flex flex-col">
      <div
        ref={wrapperRef}
        tabIndex={0}
        role="region"
        aria-label={`Cuaderno: ${activeBook.name} - ${activeTab.title}`}
        onScroll={clearCellTooltip}
        onCopy={(e) => {
          if (inlineEdit) return;
          const text = buildSelectionCopyText();
          if (text !== null) {
            e.preventDefault();
            lastCopiedTextRef.current = text;
            e.clipboardData.setData('text/plain', text);
            if (selectedColumnTarget) {
              const title =
                selectedColumnTarget.kind === 'COL'
                  ? selectedColumnTarget.col.title
                  : selectedColumnTarget.folder.title;
              showCopyToast(`«${title}» copiada (${totalActiveStudents} alumnos · Apellidos A–Z)`);
            } else {
              const count = Math.max(1, selectedKeys.size, selectedTargets.length);
              showCopyToast(
                count > 1 ? `${count} celdas copiadas (escala 0–10)` : `Copiado: ${text || 'vacío'}`
              );
            }
          }
        }}
        className="flex-1 min-h-0 overflow-auto bg-slate-50 focus:outline-none relative gradebook-touch-surface"
      >
      <div
        data-grid-scroll-canvas="true"
        style={{
          width: totalTableWidth + 200,
          minWidth: '100%',
          paddingBottom: '82dvh',
          overflow: 'clip',
        }}
      >
      <table
        ref={tableRef}
        style={{
          tableLayout: 'fixed',
          width: totalTableWidth,
          borderCollapse: 'separate',
          borderSpacing: 0,
          fontSize: `${scaledTextFs}px`,
          scale: '1',
        }}
        className="select-none"
      >
        <colgroup>
          <col style={{ width: studentColW }} />
          {displaySlots.map((slot) => (
            <col key={`cg-${slot.key}`} style={{ width: slot.width * gridZoom }} />
          ))}
          <col style={{ width: addColW }} />
        </colgroup>

        {/* STICKY TOP HEADER (iDoceo-style continuous columns & inverted-L folders + LOMLOE row) */}
        <thead className="sticky top-0 z-30 bg-white">
          {/* Row 1: Top-Left Student Header + Standalone cols (rowSpan=2) + Closed Folders + Open Folder Canopies */}
          <tr>
            <th
              rowSpan={totalHeaderRows}
              onClick={(e) => {
                if (!device.isTouch || justResizedRef.current) return;
                const target = e.target as HTMLElement | null;
                if (target?.closest('button, input, select')) return;
                e.stopPropagation();
                selectStudentColHeader();
              }}
              style={{
                width: studentColW,
                backgroundColor: blendWithWhite(activeTab.color, 0.45),
              }}
              className={`sticky left-0 z-40 border-r-2 border-b border-slate-300 px-2 py-1 text-left align-top relative ${
                selectedStudentColHeader ? 'col-header-selected' : ''
              }`}
            >
              <div
                className="flex flex-col justify-between min-w-0"
                style={{
                  minHeight: Math.max(
                    60,
                    canopyH + headerH + (showLomloeBar ? lomloeRowH : 0) - 8
                  ),
                }}
              >
                <div className="flex items-start justify-between gap-1 min-w-0">
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="text-[1.02em] font-bold text-slate-900 truncate flex items-center gap-1">
                      <span className="truncate">{activeTab.title}</span>
                      {activeTab.isLocked && <Lock style={smallIconStyle} className="text-slate-600 shrink-0" />}
                    </div>
                    <div className="text-[0.8em] text-slate-600 truncate">
                      {totalActiveStudents} alumnos
                      {effectiveGroups.length > 0 ? ` · ${effectiveGroups.length} grupos` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {onOpenGroupsManager && (
                      <button
                        type="button"
                        onClick={() => onOpenGroupsManager()}
                        title="Agrupaciones y categorías de grupos"
                        aria-label="Gestionar grupos de alumnos"
                        className="p-1 rounded-lg bg-white/90 border border-slate-300 hover:border-indigo-400 hover:text-indigo-700 text-slate-700 flex items-center justify-center shadow-2xs shrink-0"
                      >
                        <Layers style={iconStyle} />
                      </button>
                    )}
                    {onOpenBulkStudents && (
                      <button
                        type="button"
                        onClick={onOpenBulkStudents}
                        title="Importar y exportar alumnos en masa (Apellidos, Nombre)"
                        aria-label="Importar y exportar alumnos en masa"
                        className="p-1 rounded-lg bg-white/90 border border-slate-300 hover:border-blue-400 hover:text-blue-700 text-slate-700 flex items-center justify-center shadow-2xs shrink-0"
                      >
                        <Users style={iconStyle} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onNewStudent}
                      title="Añadir alumno"
                      aria-label="Añadir alumno"
                      className="p-1 rounded-lg bg-white/90 border border-slate-300 hover:border-blue-400 hover:text-blue-700 text-slate-700 flex items-center justify-center shadow-2xs shrink-0"
                    >
                      <Plus style={iconStyle} />
                    </button>
                  </div>
                </div>

                {/* Separated Sort Menu (Apellidos/Nombre/Nota with explicit A→Z / Z→A + Manual) + Group Mode & Category Switcher */}
                <div className="space-y-0.5 pt-1 border-t border-slate-300/60 min-w-0">
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <div className="relative min-w-0" onMouseDown={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCategoryMenu(false);
                          setShowSortMenu((v) => !v);
                        }}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-white/80 hover:bg-white border border-slate-300/80 text-[0.82em] font-semibold text-slate-700 hover:text-blue-700 transition-colors max-w-full"
                        title="Ordenar alumnado"
                        aria-haspopup="menu"
                        aria-expanded={showSortMenu}
                      >
                        <ArrowDownUp style={smallIconStyle} className="shrink-0" />
                        <span className="truncate max-w-[92px]">{sortShortLabel}</span>
                        <ChevronDown style={smallIconStyle} className="shrink-0 opacity-70" />
                      </button>

                      {showSortMenu && (
                        <div
                          role="menu"
                          aria-label="Ordenar alumnado"
                          className="absolute left-0 top-full mt-1 w-64 rounded-2xl border border-slate-200 bg-white shadow-xl p-2 z-50 text-xs space-y-1.5"
                        >
                          <div className="px-1.5 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Ordenar alumnos por
                          </div>

                          {/* Apellidos: A→Z | Z→A */}
                          <div className="flex items-center justify-between gap-2 px-1.5 py-1 rounded-xl bg-slate-50/80">
                            <span className="font-semibold text-slate-800">Apellidos</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={activeBook.sortMode === 'LAST_ASC'}
                                onClick={() => {
                                  updateBook(activeBook.id, { sortMode: 'LAST_ASC' });
                                  setShowSortMenu(false);
                                }}
                                className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors ${
                                  activeBook.sortMode === 'LAST_ASC'
                                    ? 'bg-blue-600 border-blue-600 text-white'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-blue-50'
                                }`}
                              >
                                A → Z
                              </button>
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={activeBook.sortMode === 'LAST_DESC'}
                                onClick={() => {
                                  updateBook(activeBook.id, { sortMode: 'LAST_DESC' });
                                  setShowSortMenu(false);
                                }}
                                className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors ${
                                  activeBook.sortMode === 'LAST_DESC'
                                    ? 'bg-blue-600 border-blue-600 text-white'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-blue-50'
                                }`}
                              >
                                Z → A
                              </button>
                            </div>
                          </div>

                          {/* Nombre: A→Z | Z→A */}
                          <div className="flex items-center justify-between gap-2 px-1.5 py-1 rounded-xl bg-slate-50/80">
                            <span className="font-semibold text-slate-800">Nombre</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={activeBook.sortMode === 'FIRST_ASC'}
                                onClick={() => {
                                  updateBook(activeBook.id, { sortMode: 'FIRST_ASC' });
                                  setShowSortMenu(false);
                                }}
                                className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors ${
                                  activeBook.sortMode === 'FIRST_ASC'
                                    ? 'bg-blue-600 border-blue-600 text-white'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-blue-50'
                                }`}
                              >
                                A → Z
                              </button>
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={activeBook.sortMode === 'FIRST_DESC'}
                                onClick={() => {
                                  updateBook(activeBook.id, { sortMode: 'FIRST_DESC' });
                                  setShowSortMenu(false);
                                }}
                                className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors ${
                                  activeBook.sortMode === 'FIRST_DESC'
                                    ? 'bg-blue-600 border-blue-600 text-white'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-blue-50'
                                }`}
                              >
                                Z → A
                              </button>
                            </div>
                          </div>

                          {/* Media: Mayor→Menor | Menor→Mayor */}
                          <div className="flex items-center justify-between gap-2 px-1.5 py-1 rounded-xl bg-slate-50/80">
                            <span className="font-semibold text-slate-800">Media</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={activeBook.sortMode === 'GRADE_DESC'}
                                onClick={() => {
                                  updateBook(activeBook.id, { sortMode: 'GRADE_DESC' });
                                  setShowSortMenu(false);
                                }}
                                className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors ${
                                  activeBook.sortMode === 'GRADE_DESC'
                                    ? 'bg-blue-600 border-blue-600 text-white'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-blue-50'
                                }`}
                              >
                                10 → 0
                              </button>
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={activeBook.sortMode === 'GRADE_ASC'}
                                onClick={() => {
                                  updateBook(activeBook.id, { sortMode: 'GRADE_ASC' });
                                  setShowSortMenu(false);
                                }}
                                className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors ${
                                  activeBook.sortMode === 'GRADE_ASC'
                                    ? 'bg-blue-600 border-blue-600 text-white'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-blue-50'
                                }`}
                              >
                                0 → 10
                              </button>
                            </div>
                          </div>

                          {/* Manual (sin dirección) */}
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={activeBook.sortMode === 'MANUAL'}
                            onClick={() => {
                              updateBook(activeBook.id, { sortMode: 'MANUAL' });
                              setShowSortMenu(false);
                            }}
                            className={`w-full px-2 py-1.5 rounded-xl text-left flex items-center justify-between transition-colors ${
                              activeBook.sortMode === 'MANUAL'
                                ? 'bg-blue-600 text-white font-bold'
                                : 'bg-slate-50/80 text-slate-800 hover:bg-blue-50 font-semibold'
                            }`}
                          >
                            <span>Manual (arrastrar filas)</span>
                            {activeBook.sortMode === 'MANUAL' && <Check className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Group mode toggle */}
                    <button
                      type="button"
                      aria-pressed={Boolean(activeBook.groupByGroups)}
                      onClick={() =>
                        updateBook(activeBook.id, { groupByGroups: !activeBook.groupByGroups })
                      }
                      title={
                        activeBook.groupByGroups
                          ? 'Desactivar vista por grupos'
                          : 'Mostrar alumnado agrupado por grupos'
                      }
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg border text-[0.82em] font-semibold transition-colors shrink-0 ${
                        activeBook.groupByGroups
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs'
                          : 'bg-white/80 border-slate-300/80 text-slate-700 hover:bg-white hover:text-indigo-700'
                      }`}
                    >
                      <Layers style={smallIconStyle} className="shrink-0" />
                      <span>Por grupos</span>
                    </button>
                  </div>

                  {/* Active Group Category selector (visible when grouped or when >1 category exists) */}
                  {(activeBook.groupByGroups || groupCategories.length > 1) && activeGroupCategory && (
                    <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSortMenu(false);
                          setShowCategoryMenu((v) => !v);
                        }}
                        className="w-full px-1.5 py-0.5 rounded-md bg-white/75 hover:bg-white border border-indigo-200/80 text-[0.78em] font-semibold text-indigo-900 flex items-center justify-between gap-1"
                        title="Cambiar categoría de agrupación activa"
                      >
                        <span className="truncate">{activeGroupCategory.name}</span>
                        <ChevronDown style={smallIconStyle} className="shrink-0 opacity-70" />
                      </button>

                      {showCategoryMenu && (
                        <div className="absolute left-0 top-full mt-1 w-52 rounded-xl border border-slate-200 bg-white shadow-xl py-1 z-50 text-xs">
                          <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Agrupación activa
                          </div>
                          {groupCategories.map((cat) => {
                            const isAct = cat.id === activeGroupCategory.id;
                            return (
                              <button
                                key={cat.id}
                                type="button"
                                onClick={() => {
                                  selectGroupCategory(cat.id);
                                  setShowCategoryMenu(false);
                                }}
                                className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 ${
                                  isAct
                                    ? 'bg-indigo-50 text-indigo-900 font-bold'
                                    : 'text-slate-700 hover:bg-slate-50 font-medium'
                                }`}
                              >
                                <span className="truncate">{cat.name}</span>
                                {isAct && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </button>
                            );
                          })}
                          {onOpenGroupsManager && (
                            <div className="border-t border-slate-100 mt-1 pt-1 px-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowCategoryMenu(false);
                                  onOpenGroupsManager();
                                }}
                                className="w-full px-2 py-1 text-left rounded-lg text-indigo-700 hover:bg-indigo-50 font-semibold flex items-center gap-1"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Gestionar agrupaciones...</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Resize handle on right edge of student column (Tablet: only after student header is selected!) */}
              {(!device.isTouch || selectedStudentColHeader) && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Redimensionar columna de alumnos"
                  title="Arrastra para ajustar ancho de alumnos · Doble clic: ajustar al nombre más largo"
                  style={device.isTouch ? { touchAction: 'none' } : undefined}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={toggleAutoFitStudentCol}
                  onPointerDown={startStudentColResize}
                  className={`absolute top-0 right-0 ${
                    device.isTouch ? 'w-3.5 bg-blue-500/20' : 'w-1.5'
                  } h-full cursor-col-resize hover:bg-blue-500/50 transition-colors z-20`}
                />
              )}
              {/* Bottom-Edge Header Height Resize Handle */}
              {(!device.isTouch || selectedStudentColHeader) && (
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Redimensionar altura de cabecera"
                  title="Arrastra para ajustar altura de cabecera · Doble clic: autoajustar"
                  style={device.isTouch ? { touchAction: 'none' } : undefined}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={toggleAutoFitHeaderHeight}
                  onPointerDown={startHeaderHeightResize}
                  className={`absolute left-0 bottom-0 w-full ${
                    device.isTouch ? 'h-3 bg-blue-500/20' : 'h-1.5'
                  } cursor-row-resize hover:bg-blue-500/50 transition-colors z-20`}
                />
              )}
            </th>

            {/* Row 1 Dynamic Headers: Standalone Cols (rowSpan=2) + Folder Canopies (BOTH open & closed keep Row 1 + Row 2 so header height NEVER changes!) */}
            {row1Headers.map((item) => {
              if (item.kind === 'COL') {
                return renderColumnHeaderCell(item.col, true);
              }

              if (item.kind === 'RUBRIC_EXPANDED') {
                const { col, rubric, criteria, critWidth } = item;
                const totalUnzoomedW = col.width + criteria.length * critWidth;
                const isColSelected =
                  selectedColumnTarget?.kind === 'COL' && selectedColumnTarget.col.id === col.id;

                return (
                  <th
                    key={`rubric-canopy-${col.id}`}
                    colSpan={1 + criteria.length}
                    onClick={(e) => {
                      if (justResizedRef.current) return;
                      e.stopPropagation();
                      selectEntireColumn(col);
                    }}
                    onDoubleClick={(e) => {
                      if (justResizedRef.current) return;
                      e.stopPropagation();
                      toggleColumnRubricExpanded(col.id);
                    }}
                    onContextMenu={(e) => {
                      if (justResizedRef.current) return;
                      e.preventDefault();
                      e.stopPropagation();
                      selectEntireColumn(col);
                      onEditColumn(col);
                    }}
                    style={{
                      height: canopyH,
                      maxHeight: canopyH,
                      backgroundColor: col.color,
                    }}
                    title={`${col.title} (${rubric.title}) — Doble clic aquí para plegar subcolumnas de criterios`}
                    className={`border-r border-b-0 border-slate-300 p-0 text-center cursor-pointer hover:brightness-97 transition-[background-color,border-color,color,filter,opacity,box-shadow] relative overflow-hidden ${
                      isColSelected ? 'col-header-selected' : ''
                    }`}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: totalUnzoomedW,
                        height: baseCanopyH,
                        fontSize: `${baseTextFs}px`,
                        transform: `scale(${gridZoom})`,
                        transformOrigin: 'top left',
                      }}
                      className="px-2 flex items-center justify-between gap-1 text-[0.84em] font-bold text-slate-900 overflow-hidden"
                    >
                      <span className="inline-flex items-center gap-1 min-w-0 truncate">
                        <LayoutGrid style={baseSmallIconStyle} className="text-purple-700 shrink-0" />
                        <span className="truncate">{col.title}</span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleColumnRubricExpanded(col.id);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        title="Plegar subcolumnas de criterios"
                        aria-label={`Plegar criterios de ${col.title}`}
                        className="px-1.5 py-0.5 rounded bg-white/80 hover:bg-purple-600 hover:text-white border border-purple-300/80 text-purple-800 text-[0.76em] font-bold inline-flex items-center gap-0.5 shrink-0"
                      >
                        <ChevronsLeft className="w-3 h-3" aria-hidden="true" />
                        <span>Plegar</span>
                      </button>
                    </div>
                  </th>
                );
              }

              // Both FOLDER_CLOSED (colSpan=1) and FOLDER_OPEN (colSpan=1+childColSpan) render the top Row 1 canopy!
              // Double-click on this top bar folds/unfolds the folder; clicking ⋮ edits the folder.
              const { folder, childCols } = item;
              const isClosed = item.kind === 'FOLDER_CLOSED';
              const fldKey = isClosed ? `fld-top-${folder.id}` : `fld-hdr-${folder.id}`;
              const hint = dropHint?.key === fldKey ? dropHint.mode : null;
              const isDraggingThis = dragItem?.kind === 'FOLDER' && dragItem.id === folder.id;
              const isFldSelected =
                selectedColumnTarget?.kind === 'FOLDER' &&
                selectedColumnTarget.folder.id === folder.id;
              const unzoomedCanopyW =
                (folder.width ?? 68) + (item.kind === 'FOLDER_OPEN' ? item.childWidthSum : 0);

              return (
                <th
                  key={fldKey}
                  colSpan={item.kind === 'FOLDER_OPEN' ? 1 + item.childColSpan : 1}
                  draggable={!activeTab.isLocked && !device.isTouch}
                  onPointerDown={(e) => {
                    touchDoubleTap.start(e, `hdr-fld:${folder.id}`);
                  }}
                  onPointerMove={touchDoubleTap.move}
                  onPointerUp={(e) => {
                    touchDoubleTap.end(e, `hdr-fld:${folder.id}`, () => {
                      if (justResizedRef.current) return;
                      toggleFolderCollapse(activeTab.id, folder.id);
                    });
                  }}
                  onPointerCancel={touchDoubleTap.cancel}
                  onDragStart={(e) => {
                    const payload: DragItemPayload = { kind: 'FOLDER', id: folder.id };
                    setDragItem({ kind: 'FOLDER', id: folder.id });
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
                    e.dataTransfer.setData('text/plain', folder.id);
                  }}
                  onDragEnd={clearDrag}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!dragItem) return;
                    if (dragItem.kind === 'FOLDER' && dragItem.id !== folder.id) {
                      setDropHint({ key: fldKey, mode: getPointerHalf(e) });
                    } else if (dragItem.kind === 'COL') {
                      setDropHint({ key: fldKey, mode: 'INSIDE' });
                    }
                  }}
                  onDragLeave={() => {
                    if (dropHint?.key === fldKey) setDropHint(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const payload = readDragPayload(e);
                    if (payload) {
                      if (payload.kind === 'FOLDER' && payload.id !== folder.id) {
                        moveItemInActiveTab(payload, {
                          kind: 'FOLDER',
                          id: folder.id,
                          position: getPointerHalf(e),
                        });
                      } else if (payload.kind === 'COL') {
                        moveItemInActiveTab(payload, {
                          kind: 'FOLDER',
                          id: folder.id,
                          position: 'INSIDE',
                        });
                      }
                    }
                    clearDrag();
                  }}
                  onClick={(e) => {
                    if (justResizedRef.current || touchDoubleTap.wasDoubleTapJustHandled()) {
                      return;
                    }
                    e.stopPropagation();
                    if (
                      !e.shiftKey &&
                      !e.metaKey &&
                      !e.ctrlKey &&
                      touchDoubleTap.handleTouchClick(
                        `hdr-fld:${folder.id}`,
                        () => toggleFolderCollapse(activeTab.id, folder.id),
                        device.isTouch
                      )
                    ) {
                      return;
                    }
                    selectFolderSummaryColumn(folder, childCols);
                  }}
                  onDoubleClick={(e) => {
                    if (justResizedRef.current || touchDoubleTap.wasDoubleTapJustHandled()) return;
                    e.stopPropagation();
                    toggleFolderCollapse(activeTab.id, folder.id);
                  }}
                  onContextMenu={(e) => {
                    if (justResizedRef.current) return;
                    e.preventDefault();
                    e.stopPropagation();
                    selectFolderSummaryColumn(folder, childCols);
                    onEditFolder(activeTab.id, folder);
                  }}
                  style={{
                    height: canopyH,
                    maxHeight: canopyH,
                    backgroundColor: folder.color,
                    boxShadow:
                      hint === 'BEFORE'
                        ? 'inset 3px 0 0 #2563EB'
                        : hint === 'AFTER'
                          ? 'inset -3px 0 0 #2563EB'
                          : undefined,
                  }}
                  title={`${folder.title} — Doble clic aquí: ${
                    isClosed ? 'desplegar' : 'plegar'
                  } carpeta · 1 clic: seleccionar · Clic derecho o ⋮: configurar`}
                  className={`border-r border-b-0 border-slate-300 p-0 text-center cursor-pointer hover:brightness-97 transition-[background-color,border-color,color,filter,opacity,box-shadow] relative group overflow-hidden ${
                    hint === 'INSIDE' ? 'ring-2 ring-inset ring-blue-500' : ''
                  } ${isDraggingThis ? 'opacity-60' : ''} ${
                    isFldSelected ? 'col-header-selected' : ''
                  }`}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: unzoomedCanopyW,
                      height: baseCanopyH,
                      fontSize: `${baseTextFs}px`,
                      transform: `scale(${gridZoom})`,
                      transformOrigin: 'top left',
                    }}
                    className="px-1.5 flex items-center justify-between gap-0.5 text-[0.86em] font-bold text-slate-900 overflow-hidden"
                  >
                    {!isClosed && (
                      <GripVertical
                        style={baseSmallIconStyle}
                        className="text-slate-600/60 shrink-0"
                      />
                    )}
                    <span className="truncate flex-1 text-center leading-tight">
                      {!isClosed ? folder.title : (
                        <span className="text-[0.82em] opacity-75">
                          {childCols.length > 0 ? `${childCols.length} col.` : '·'}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditFolder(activeTab.id, folder);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      title="Configurar carpeta"
                      aria-label={`Configurar carpeta ${folder.title}`}
                      className="p-0.5 rounded hover:bg-black/10 text-slate-700 shrink-0"
                    >
                      <MoreVertical style={baseSmallIconStyle} />
                    </button>
                  </div>

                  {isClosed && (!device.isTouch || isFldSelected) && (
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Cambiar anchura de carpeta ${folder.title}`}
                      title="Arrastra para ajustar ancho · Doble clic: ajustar al texto más largo"
                      style={device.isTouch ? { touchAction: 'none' } : undefined}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => toggleAutoFitFolder(e, folder, childCols)}
                      onPointerDown={(e) => startFolderResize(e, folder)}
                      className={`absolute top-0 right-0 ${
                        device.isTouch ? 'w-3.5 bg-blue-500/20' : 'w-1.5'
                      } h-full cursor-col-resize hover:bg-blue-500/60 transition-colors z-20`}
                    />
                  )}
                </th>
              );
            })}

            {/* Add Column / Folder Top-Right Button (also acts as drop zone to pull columns OUT of folders or move to end) */}
            <th
              rowSpan={totalHeaderRows}
              onDragOver={(e) => {
                if (!dragItem) return;
                e.preventDefault();
                setDropHint({ key: 'end-zone', mode: 'OUTSIDE_END' });
              }}
              onDragLeave={() => {
                if (dropHint?.key === 'end-zone') setDropHint(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const payload = readDragPayload(e);
                if (payload) {
                  moveItemInActiveTab(payload, { kind: 'END_OUTSIDE' });
                }
                clearDrag();
              }}
              className={`border-b border-slate-200 px-2 align-middle text-center relative transition-colors ${
                dropHint?.key === 'end-zone'
                  ? 'bg-blue-100 ring-2 ring-inset ring-blue-500'
                  : dragItem?.kind === 'COL' && dragItem.folderId !== null
                    ? 'bg-blue-50 border-l-2 border-dashed border-l-blue-400'
                    : 'bg-slate-100'
              }`}
            >
              {dragItem?.kind === 'COL' && dragItem.folderId !== null ? (
                <div className="flex flex-col items-center justify-center gap-1 text-blue-700 pointer-events-none px-1">
                  <FolderOutput className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] font-bold leading-tight">Sacar de carpeta</span>
                </div>
              ) : dragItem ? (
                <div className="text-[10px] font-semibold text-blue-700 pointer-events-none leading-tight px-1">
                  Mover al final
                </div>
              ) : (
                <button
                  ref={addBtnRef}
                  type="button"
                  disabled={activeTab.isLocked}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!showAddColMenu && addBtnRef.current) {
                      const rect = addBtnRef.current.getBoundingClientRect();
                      const menuW = 248;
                      const left = Math.max(
                        12,
                        Math.min(window.innerWidth - menuW - 12, rect.right - menuW)
                      );
                      const top = Math.min(window.innerHeight - 280, rect.bottom + 8);
                      setAddMenuPos({ top, left });
                    }
                    setShowAddColMenu((v) => !v);
                    setNewFolderMode(false);
                  }}
                  aria-label="Añadir columna o carpeta"
                  className="w-8 h-8 rounded-xl bg-white border border-slate-300 hover:border-blue-400 hover:text-blue-700 text-slate-700 flex items-center justify-center mx-auto shadow-2xs disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}

              {showAddColMenu && (
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{ top: addMenuPos.top, left: addMenuPos.left }}
                  className="fixed w-62 bg-white border border-slate-200 rounded-2xl shadow-2xl py-2 z-50 text-left text-xs font-normal"
                >
                  <div className="px-3.5 py-1.5 font-bold text-slate-900 border-b border-slate-100">
                    Añadir al cuaderno
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddColMenu(false);
                      onNewColumn('NUMERIC', null);
                    }}
                    className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-800"
                  >
                    <Pencil className="w-3.5 h-3.5 text-blue-600" />
                    <span>Columna Nota Numérica</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddColMenu(false);
                      onNewColumn('AVERAGE', null);
                    }}
                    className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-800"
                  >
                    <Calculator className="w-3.5 h-3.5 text-amber-600" />
                    <span>Columna Media / Ponderada</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddColMenu(false);
                      onNewColumn('RUBRIC', null);
                    }}
                    className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-800"
                  >
                    <LayoutGrid className="w-3.5 h-3.5 text-purple-600" />
                    <span>Columna Rúbrica</span>
                  </button>
                  <hr className="my-1.5 border-slate-100" />
                  {!newFolderMode ? (
                    <button
                      type="button"
                      onClick={() => setNewFolderMode(true)}
                      className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 font-semibold text-slate-800"
                    >
                      <FolderPlus className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Nueva Carpeta</span>
                    </button>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const trimmed = newFolderTitle.trim();
                        if (!trimmed) return;
                        addFolder(
                          trimmed,
                          PASTEL_SWATCHES[(activeTab.folders.length + 2) % PASTEL_SWATCHES.length].hex
                        );
                        setNewFolderTitle('');
                        setNewFolderMode(false);
                        setShowAddColMenu(false);
                        requestAnimationFrame(() => {
                          if (wrapperRef.current) {
                            wrapperRef.current.scrollTo({
                              left: wrapperRef.current.scrollWidth,
                              behavior: 'smooth',
                            });
                          }
                        });
                      }}
                      className="px-3 py-1.5 space-y-1.5"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={newFolderTitle}
                        onChange={(e) => setNewFolderTitle(e.target.value)}
                        placeholder="Nombre carpeta..."
                        className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                      />
                      <button
                        type="submit"
                        className="w-full py-1 rounded-lg bg-blue-600 text-white font-semibold text-xs hover:bg-blue-700"
                      >
                        Crear carpeta
                      </button>
                    </form>
                  )}
                </div>
              )}
            </th>
          </tr>

          {/* Row 2: Folder seamless left Summary Columns + Child Column Headers + Child Rubric Canopies */}
          <tr>
            {row2Slots.map((slot) => {
              if (slot.kind === 'FOLDER_SUMMARY') {
                const { folder, childCols, key, isOpen } = slot;
                const fldW = folder.width ?? 68;
                const isVertical = shouldRenderVerticalHeader(folder.title, fldW);
                const isFldSelected =
                  selectedColumnTarget?.kind === 'FOLDER' &&
                  selectedColumnTarget.folder.id === folder.id;
                const unzoomedFldSummaryH = baseHeaderH + (showLomloeBar ? baseLomloeRowH : 0);
                const fldRowSpan = (hasExpandedChildRubric ? 2 : 1) + (showLomloeBar ? 1 : 0);

                return (
                  <th
                    key={key}
                    rowSpan={fldRowSpan > 1 ? fldRowSpan : undefined}
                    onClick={(e) => {
                      if (justResizedRef.current) return;
                      e.stopPropagation();
                      selectFolderSummaryColumn(folder, childCols);
                    }}
                    onDoubleClick={(e) => {
                      if (justResizedRef.current) return;
                      e.stopPropagation();
                      onEditFolder(activeTab.id, folder);
                    }}
                    onContextMenu={(e) => {
                      if (justResizedRef.current) return;
                      e.preventDefault();
                      e.stopPropagation();
                      selectFolderSummaryColumn(folder, childCols);
                      onEditFolder(activeTab.id, folder);
                    }}
                    onDragOver={(e) => {
                      if (!dragItem || dragItem.kind !== 'COL') return;
                      e.preventDefault();
                      setDropHint({ key, mode: 'INSIDE' });
                    }}
                    onDragLeave={() => {
                      if (dropHint?.key === key) setDropHint(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const payload = readDragPayload(e);
                      if (payload?.kind === 'COL') {
                        moveItemInActiveTab(payload, {
                          kind: 'FOLDER',
                          id: folder.id,
                          position: 'INSIDE',
                        });
                      }
                      clearDrag();
                    }}
                    style={{
                      height: headerH + (showLomloeBar ? lomloeRowH : 0),
                      maxHeight: headerH + (showLomloeBar ? lomloeRowH : 0),
                      backgroundColor: folder.color,
                    }}
                    title={`${folder.title} (resumen) — 1 clic: seleccionar · Doble clic o clic derecho aquí: configurar · Doble clic arriba: ${
                      isOpen ? 'plegar' : 'desplegar'
                    }`}
                    className={`border-r border-b border-t-0 border-slate-300 p-0 relative group cursor-pointer align-middle transition-[background-color,border-color,color,filter,opacity,box-shadow] hover:brightness-97 overflow-hidden ${
                      dropHint?.key === key ? 'ring-2 ring-inset ring-blue-500' : ''
                    } ${isFldSelected ? 'col-header-selected' : ''}`}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: fldW,
                        height: unzoomedFldSummaryH,
                        fontSize: `${baseTextFs}px`,
                        transform: `scale(${gridZoom})`,
                        transformOrigin: 'top left',
                      }}
                      className="px-1 py-1 relative overflow-hidden"
                    >
                      {/* 1-click Copy Folder Summary Column button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyColumnAlphabetical({ kind: 'FOLDER', folder, childCols });
                        }}
                        title="Copiar columna resumen de la carpeta en orden alfabético por apellidos"
                        aria-label={`Copiar carpeta ${folder.title} por apellidos`}
                        className={`absolute top-1 right-1 z-20 p-1 rounded-md bg-white/90 hover:bg-blue-600 hover:text-white text-slate-700 border border-slate-300/80 flex items-center justify-center shadow-2xs transition-opacity ${
                          isFldSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                        }`}
                      >
                        <Copy style={baseSmallIconStyle} />
                      </button>

                      <div
                        style={{
                          height: Math.max(24, unzoomedFldSummaryH - 8),
                          maxHeight: Math.max(24, unzoomedFldSummaryH - 8),
                        }}
                        className="flex flex-col items-center justify-center gap-1 overflow-hidden"
                      >
                        {!isOpen ? (
                          <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden px-0.5">
                            <span
                              style={isVertical ? { maxHeight: Math.max(20, baseHeaderH - 14) } : undefined}
                              className={`text-[0.86em] font-bold text-slate-900 leading-tight whitespace-normal break-normal [overflow-wrap:normal] [word-break:normal] ${
                                isVertical
                                  ? '[writing-mode:vertical-rl] rotate-180 overflow-hidden text-left'
                                  : 'text-center w-full'
                              }`}
                            >
                              {folder.title}
                            </span>
                          </div>
                        ) : childCols.length === 0 && !activeTab.isLocked ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onNewColumn('NUMERIC', folder.id);
                            }}
                            title="Añadir primera columna a esta carpeta"
                            className="px-1.5 py-0.5 rounded-md bg-white/85 border border-slate-300 hover:border-blue-400 hover:text-blue-700 text-[0.78em] font-semibold text-slate-700 flex items-center gap-0.5"
                          >
                            <Plus style={baseSmallIconStyle} />
                            <span>Col</span>
                          </button>
                        ) : (
                          <span className="text-[0.76em] font-semibold text-slate-600/85 text-center whitespace-normal break-normal [overflow-wrap:normal] [word-break:normal] leading-tight px-0.5">
                            {folder.summaryMode === 'SUM'
                              ? 'Suma'
                              : folder.summaryMode === 'MAX'
                                ? 'Máx.'
                                : folder.summaryMode === 'MIN'
                                  ? 'Mín.'
                                  : 'Media'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Independent Folder Width Resize Handle (Tablet: only after folder is selected!) */}
                    {(!device.isTouch || isFldSelected) && (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Cambiar anchura de carpeta ${folder.title}`}
                        title="Arrastra para ajustar ancho · Doble clic: ajustar al texto más largo"
                        style={device.isTouch ? { touchAction: 'none' } : undefined}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => toggleAutoFitFolder(e, folder, childCols)}
                        onPointerDown={(e) => startFolderResize(e, folder)}
                        className={`absolute top-0 right-0 ${
                          device.isTouch ? 'w-3.5 bg-blue-500/20' : 'w-1.5'
                        } h-full cursor-col-resize hover:bg-blue-500/60 transition-colors z-20`}
                      />
                    )}
                    {/* Bottom-Edge Header Height Resize Handle */}
                    {(!device.isTouch || isFldSelected) && (
                      <div
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label="Cambiar altura de cabecera"
                        title="Arrastra para ajustar altura de cabecera · Doble clic: autoajustar"
                        style={device.isTouch ? { touchAction: 'none' } : undefined}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={toggleAutoFitHeaderHeight}
                        onPointerDown={startHeaderHeightResize}
                        className={`absolute left-0 bottom-0 w-full ${
                          device.isTouch ? 'h-3 bg-blue-500/20' : 'h-1.5'
                        } cursor-row-resize hover:bg-blue-500/60 transition-colors z-20`}
                      />
                    )}
                  </th>
                );
              }

              if (slot.kind === 'RUBRIC_CRITERION') {
                // If this criterion belongs to an expanded CHILD rubric inside a folder, Row 2 renders the canopy above and Row 3 renders this criterion!
                if (hasExpandedChildRubric && slot.isChild) {
                  return null;
                }
                const { col, rubric, criterion, criterionIndex, key, width } = slot;
                const critUnzoomedH = baseHeaderH + (showLomloeBar ? baseLomloeRowH : 0);
                const critH = headerH + (showLomloeBar ? lomloeRowH : 0);
                const critRowSpan = (hasExpandedChildRubric ? 2 : 1) + (showLomloeBar ? 1 : 0);
                const isCritColSelected =
                  selectedColumnTarget?.kind === 'COL' && selectedColumnTarget.col.id === col.id;
                return (
                  <th
                    key={key}
                    rowSpan={critRowSpan > 1 ? critRowSpan : undefined}
                    data-rubric-crit-header={key}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectEntireColumn(col);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onEditColumn(col);
                    }}
                    style={{
                      height: critH,
                      maxHeight: critH,
                      backgroundColor: blendWithWhite(col.color, 0.34),
                    }}
                    title={`Criterio ${criterionIndex + 1}: ${criterion.title} (Peso: ${criterion.weight}%) · Rúbrica: ${rubric.title}`}
                    className={`border-r border-b border-t border-t-slate-300/80 border-slate-300 p-0 relative cursor-pointer align-middle transition-[background-color,border-color,color,filter,opacity,box-shadow] hover:brightness-97 overflow-hidden ${
                      isCritColSelected ? 'col-header-selected' : ''
                    }`}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width,
                        height: critUnzoomedH,
                        fontSize: `${baseTextFs}px`,
                        transform: `scale(${gridZoom})`,
                        transformOrigin: 'top left',
                      }}
                      className="px-1 py-1 flex flex-col items-center justify-between gap-0.5 overflow-hidden"
                    >
                      <span className="px-1 py-0 rounded bg-purple-100/90 border border-purple-200 text-[0.68em] font-extrabold text-purple-900 leading-tight shrink-0">
                        C{criterionIndex + 1} · {criterion.weight}%
                      </span>
                      <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden px-0.5">
                        <span className="text-[0.8em] font-semibold text-slate-800 leading-tight text-center line-clamp-3 break-words">
                          {criterion.title}
                        </span>
                      </div>
                    </div>
                  </th>
                );
              }

              // Expanded CHILD rubric inside an open folder renders its horizontal folder-style canopy in Row 2!
              const childExpandedRubric =
                hasExpandedChildRubric && slot.isChild && slot.col.rubricExpanded
                  ? resolveColumnRubric(slot.col)
                  : null;
              if (childExpandedRubric && childExpandedRubric.criteria.length > 0) {
                const { col } = slot;
                const critCount = childExpandedRubric.criteria.length;
                const totalUnzoomedW = col.width + critCount * 75;
                const isColSelected =
                  selectedColumnTarget?.kind === 'COL' && selectedColumnTarget.col.id === col.id;
                return (
                  <th
                    key={`rubric-child-canopy-${col.id}`}
                    colSpan={1 + critCount}
                    onClick={(e) => {
                      if (justResizedRef.current) return;
                      e.stopPropagation();
                      selectEntireColumn(col);
                    }}
                    onDoubleClick={(e) => {
                      if (justResizedRef.current) return;
                      e.stopPropagation();
                      toggleColumnRubricExpanded(col.id);
                    }}
                    onContextMenu={(e) => {
                      if (justResizedRef.current) return;
                      e.preventDefault();
                      e.stopPropagation();
                      selectEntireColumn(col);
                      onEditColumn(col);
                    }}
                    style={{
                      height: subCanopyH,
                      maxHeight: subCanopyH,
                      backgroundColor: col.color,
                    }}
                    title={`${col.title} (${childExpandedRubric.title}) — Doble clic para plegar subcolumnas`}
                    className={`border-r border-b-0 border-t border-t-slate-300/80 border-slate-300 p-0 text-center cursor-pointer hover:brightness-97 transition-[background-color,border-color,color,filter,opacity,box-shadow] relative overflow-hidden ${
                      isColSelected ? 'col-header-selected' : ''
                    }`}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: totalUnzoomedW,
                        height: subCanopyBaseH,
                        fontSize: `${baseTextFs}px`,
                        transform: `scale(${gridZoom})`,
                        transformOrigin: 'top left',
                      }}
                      className="px-2 flex items-center justify-between gap-1 text-[0.82em] font-bold text-slate-900 overflow-hidden"
                    >
                      <span className="inline-flex items-center gap-1 min-w-0 truncate">
                        <LayoutGrid style={baseSmallIconStyle} className="text-purple-700 shrink-0" />
                        <span className="truncate">{col.title}</span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleColumnRubricExpanded(col.id);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        title="Plegar subcolumnas de criterios"
                        aria-label={`Plegar criterios de ${col.title}`}
                        className="px-1.5 py-0.5 rounded bg-white/80 hover:bg-purple-600 hover:text-white border border-purple-300/80 text-purple-800 text-[0.74em] font-bold inline-flex items-center gap-0.5 shrink-0"
                      >
                        <ChevronsLeft className="w-3 h-3" aria-hidden="true" />
                        <span>Plegar</span>
                      </button>
                    </div>
                  </th>
                );
              }

              const isStandaloneExpandedRubric =
                !slot.isChild && slot.col.type === 'RUBRIC' && Boolean(slot.col.rubricExpanded);
              return renderColumnHeaderCell(
                slot.col,
                false,
                isStandaloneExpandedRubric,
                hasExpandedChildRubric ? 2 : undefined
              );
            })}
          </tr>

          {/* Row 3 (only when a rubric INSIDE a folder is expanded): overall rubric cell + criterion subcolumns */}
          {hasExpandedChildRubric && (
            <tr>
              {row2Slots.map((slot) => {
                if (slot.kind === 'FOLDER_SUMMARY') return null;
                if (slot.kind === 'COL') {
                  if (!slot.isChild || !slot.col.rubricExpanded) return null;
                  const r = resolveColumnRubric(slot.col);
                  if (!r || r.criteria.length === 0) return null;
                  const subBodyBaseH = Math.max(36, baseHeaderH - subCanopyBaseH);
                  const subBodyH = headerH - subCanopyH;
                  return renderColumnHeaderCell(
                    slot.col,
                    false,
                    true,
                    1,
                    subBodyH,
                    subBodyBaseH
                  );
                }
                if (!slot.isChild) return null;
                const { col, rubric, criterion, criterionIndex, key, width } = slot;
                const subBodyBaseH = Math.max(36, baseHeaderH - subCanopyBaseH);
                const subBodyH = headerH - subCanopyH;
                const critUnzoomedH = subBodyBaseH + (showLomloeBar ? baseLomloeRowH : 0);
                const critH = subBodyH + (showLomloeBar ? lomloeRowH : 0);
                const isCritColSelected =
                  selectedColumnTarget?.kind === 'COL' && selectedColumnTarget.col.id === col.id;
                return (
                  <th
                    key={`r3-${key}`}
                    rowSpan={showLomloeBar ? 2 : undefined}
                    data-rubric-crit-header={key}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectEntireColumn(col);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onEditColumn(col);
                    }}
                    style={{
                      height: critH,
                      maxHeight: critH,
                      backgroundColor: blendWithWhite(col.color, 0.34),
                    }}
                    title={`Criterio ${criterionIndex + 1}: ${criterion.title} (Peso: ${criterion.weight}%) · Rúbrica: ${rubric.title}`}
                    className={`border-r border-b border-t border-t-slate-300/80 border-slate-300 p-0 relative cursor-pointer align-middle transition-[background-color,border-color,color,filter,opacity,box-shadow] hover:brightness-97 overflow-hidden ${
                      isCritColSelected ? 'col-header-selected' : ''
                    }`}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width,
                        height: critUnzoomedH,
                        fontSize: `${baseTextFs}px`,
                        transform: `scale(${gridZoom})`,
                        transformOrigin: 'top left',
                      }}
                      className="px-1 py-1 flex flex-col items-center justify-between gap-0.5 overflow-hidden"
                    >
                      <span className="px-1 py-0 rounded bg-purple-100/90 border border-purple-200 text-[0.68em] font-extrabold text-purple-900 leading-tight shrink-0">
                        C{criterionIndex + 1} · {criterion.weight}%
                      </span>
                      <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden px-0.5">
                        <span className="text-[0.8em] font-semibold text-slate-800 leading-tight text-center line-clamp-3 break-words">
                          {criterion.title}
                        </span>
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          )}

          {/* Row 3: iDoceo-style LOMLOE Criteria Codes, Specific Competence Numbers & Key Competence Badges */}
          {showLomloeBar && activeCurriculum && (
            <tr data-lomloe-row="true">
              {displaySlots.map((slot) => {
                if (slot.kind === 'FOLDER_SUMMARY' || slot.kind === 'RUBRIC_CRITERION') {
                  // Covered seamlessly by FOLDER_SUMMARY / RUBRIC_CRITERION rowSpan={2}
                  return null;
                }
                const { col } = slot;
                const summary = resolveColumnLomloeSummary(
                  col,
                  activeCurriculum,
                  keyCompetencesCatalog
                );
                const isPickerOpen = lomloePicker?.colId === col.id;
                const badgePx = Math.max(12, Math.round(16 * gridZoom));
                const codesText = summary.criteriaCodes.join(' ');
                const ceNumsText = summary.specificNumbers.join(' ');

                return (
                  <th
                    key={`lomloe-${col.id}`}
                    data-lomloe-cell={col.id}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      if (justResizedRef.current) return;
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      setLomloePicker((prev) =>
                        prev?.colId === col.id
                          ? null
                          : {
                              colId: col.id,
                              rect: {
                                top: r.top,
                                left: r.left,
                                width: r.width,
                                bottom: r.bottom,
                              },
                            }
                      );
                    }}
                    onContextMenu={(e) => {
                      if (justResizedRef.current) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      setLomloePicker({
                        colId: col.id,
                        rect: {
                          top: r.top,
                          left: r.left,
                          width: r.width,
                          bottom: r.bottom,
                        },
                      });
                    }}
                    style={{
                      height: lomloeRowH,
                      maxHeight: lomloeRowH,
                      backgroundColor: isPickerOpen
                        ? '#eef2ff'
                        : blendWithWhite(col.color, 0.88),
                    }}
                    title={
                      summary.criteria.length > 0
                        ? summary.criteria
                            .map((cr) => `${cr.code}: ${cr.description}`)
                            .join('\n')
                        : `Conectar criterios LOMLOE a "${col.title}"`
                    }
                    className={`border-r border-b border-t-0 border-slate-300 px-1 py-1 align-middle text-center cursor-pointer relative group transition-colors hover:bg-indigo-50/70 ${
                      isPickerOpen
                        ? 'ring-2 ring-inset ring-indigo-500'
                        : selectedColumnTarget?.kind === 'COL' && selectedColumnTarget.col.id === col.id
                          ? 'col-cell-tint'
                          : ''
                    }`}
                  >
                    {summary.criteria.length === 0 ? (
                      <div className="h-full w-full flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded-md bg-white/90 border border-indigo-200 text-indigo-700 font-semibold text-[0.72em] leading-none shadow-2xs">
                          + Criterios
                        </span>
                      </div>
                    ) : (
                      <div className="h-full w-full flex flex-col items-center justify-center gap-0.5 overflow-hidden leading-none">
                        <div
                          style={{ fontSize: `${Math.max(8, Math.round(9.5 * gridZoom))}px` }}
                          className="font-medium text-slate-600 truncate max-w-full tracking-tight"
                        >
                          {codesText}
                        </div>
                        <div
                          style={{ fontSize: `${Math.max(10, Math.round(11.5 * gridZoom))}px` }}
                          className="font-extrabold text-slate-900 tracking-wider leading-tight"
                        >
                          {ceNumsText}
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-0.5 max-w-full overflow-hidden pt-0.5">
                          {summary.keyCompetences.map((kc) => (
                            <LomloeCompetenceBadge
                              key={kc.id}
                              competence={kc}
                              sizePx={badgePx}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Resize Column Width Handle continued cleanly on LOMLOE cell (Tablet: only when selected) */}
                    {(!device.isTouch ||
                      (selectedColumnTarget?.kind === 'COL' &&
                        selectedColumnTarget.col.id === col.id)) && (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => toggleAutoFitColumn(e, col)}
                        onPointerDown={(e) => startColumnResize(e, col)}
                        style={device.isTouch ? { touchAction: 'none' } : undefined}
                        className={`absolute top-0 right-0 ${
                          device.isTouch ? 'w-3.5 bg-blue-500/20' : 'w-1.5'
                        } h-full cursor-col-resize hover:bg-blue-500/60 transition-colors z-20`}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          )}
        </thead>

        {/* STUDENT ROWS */}
        <tbody>
          {totalActiveStudents === 0 || (visibleStudents.length === 0 && !activeBook.groupByGroups) ? (
            <tr>
              <td
                colSpan={displaySlots.length + 2}
                className="py-12 text-center text-sm text-slate-500 bg-white"
              >
                No hay alumnos visibles. Pulsa <strong>+</strong> en la esquina superior izquierda para añadir alumnado.
              </td>
            </tr>
          ) : (() => {
            let runningRowIdx = 0;
            return groupBuckets.flatMap((bucket, bucketIdx) => {
              const rows: React.ReactNode[] = [];
              if (activeBook.groupByGroups) {
                const groupStudentIds = bucket.students.map((s) => s.id);
                rows.push(
                  <tr
                    key={`grp-hdr-${bucket.key}`}
                    data-group-header={bucket.key}
                    style={{ height: groupRowH }}
                  >
                    <th
                      scope="row"
                      style={{ backgroundColor: blendWithWhite(bucket.color, 0.28), height: groupRowH }}
                      className="sticky left-0 z-20 border-r-2 border-b border-t border-slate-300 px-2 py-0.5 text-left"
                    >
                      <div className="flex items-center justify-between gap-1 h-full">
                        {/* Left chevron button ONLY collapses/expands the group */}
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleGroupCollapsed(bucket.key);
                          }}
                          title={bucket.isCollapsed ? 'Desplegar grupo' : 'Plegar grupo'}
                          aria-label={
                            bucket.isCollapsed
                              ? `Desplegar grupo ${bucket.name}`
                              : `Plegar grupo ${bucket.name}`
                          }
                          className="p-1.5 -ml-1 rounded-lg hover:bg-white/70 text-slate-700 hover:text-slate-950 shrink-0 transition-colors"
                        >
                          {bucket.isCollapsed ? (
                            <ChevronRight style={smallIconStyle} />
                          ) : (
                            <ChevronDown style={smallIconStyle} />
                          )}
                        </button>

                        {/* Center & right area: inline rename on double-click / double-tap */}
                        {editingGroup?.key === bucket.key ? (
                          <input
                            type="text"
                            autoFocus
                            value={editingGroup.draft}
                            aria-label={`Nuevo nombre para el grupo ${bucket.name}`}
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) =>
                              setEditingGroup((prev) =>
                                prev ? { ...prev, draft: e.target.value } : null
                              )
                            }
                            onBlur={() => {
                              const nextName = editingGroup.draft.trim();
                              if (nextName && nextName !== editingGroup.originalName) {
                                upsertStudentGroup(
                                  nextName,
                                  editingGroup.color,
                                  editingGroup.originalName
                                );
                                showCopyToast(`Grupo renombrado a "${nextName}"`);
                              }
                              setEditingGroup(null);
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const nextName = editingGroup.draft.trim();
                                if (nextName && nextName !== editingGroup.originalName) {
                                  upsertStudentGroup(
                                    nextName,
                                    editingGroup.color,
                                    editingGroup.originalName
                                  );
                                  showCopyToast(`Grupo renombrado a "${nextName}"`);
                                }
                                setEditingGroup(null);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingGroup(null);
                              }
                            }}
                            className="flex-1 min-w-0 px-2 py-0.5 rounded-lg border border-blue-500 bg-white text-slate-900 font-bold text-[0.95em] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                          />
                        ) : (
                          <div
                            data-group-rename-area={bucket.key}
                            onPointerDown={(e) => {
                              touchDoubleTap.start(e, `grp-name:${bucket.key}`);
                            }}
                            onPointerMove={touchDoubleTap.move}
                            onPointerUp={(e) => {
                              touchDoubleTap.end(e, `grp-name:${bucket.key}`, () => {
                                if (bucket.isUnassigned) {
                                  onOpenGroupsManager?.();
                                } else {
                                  setEditingGroup({
                                    key: bucket.key,
                                    originalName: bucket.name,
                                    color: bucket.color,
                                    draft: bucket.name,
                                  });
                                }
                              });
                            }}
                            onPointerCancel={touchDoubleTap.cancel}
                            onClick={(e) => {
                              e.stopPropagation();
                              touchDoubleTap.handleTouchClick(
                                `grp-name:${bucket.key}`,
                                () => {
                                  if (bucket.isUnassigned) {
                                    onOpenGroupsManager?.();
                                  } else {
                                    setEditingGroup({
                                      key: bucket.key,
                                      originalName: bucket.name,
                                      color: bucket.color,
                                      draft: bucket.name,
                                    });
                                  }
                                },
                                device.isTouch
                              );
                            }}
                            onDoubleClick={(e) => {
                              if (touchDoubleTap.wasDoubleTapJustHandled()) return;
                              e.stopPropagation();
                              if (bucket.isUnassigned) {
                                onOpenGroupsManager?.();
                              } else {
                                setEditingGroup({
                                  key: bucket.key,
                                  originalName: bucket.name,
                                  color: bucket.color,
                                  draft: bucket.name,
                                });
                              }
                            }}
                            title={
                              bucket.isUnassigned
                                ? 'Doble clic: asignar alumnos a un grupo'
                                : `Doble clic: cambiar nombre de "${bucket.name}" · Pulsa la flecha izquierda para plegar/desplegar`
                            }
                            className="flex-1 min-w-0 h-full flex items-center gap-1.5 cursor-text text-slate-800 font-bold text-[0.98em]"
                          >
                            <span className="font-extrabold text-slate-600 tabular-nums text-[0.92em] shrink-0">
                              {bucketIdx + 1}
                            </span>
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                              style={{ backgroundColor: bucket.color }}
                            />
                            <span className="truncate">{bucket.name}</span>
                            <span className="px-1.5 py-0.2 rounded-full bg-white/80 text-slate-700 text-[0.78em] font-bold tabular-nums shrink-0 border border-black/5">
                              {bucket.students.length}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-0.5 shrink-0">
                          {groupSummaryRows.length === 0 && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setAddGroupSummaryMenu({
                                  top: Math.max(12, Math.min(window.innerHeight - 320, rect.bottom + 6)),
                                  left: Math.min(window.innerWidth - 250, rect.left),
                                });
                              }}
                              title="Añadir fila de estadísticas al final de cada grupo"
                              className="p-1 rounded hover:bg-white/70 text-indigo-700"
                            >
                              <BarChart3 style={smallIconStyle} />
                            </button>
                          )}
                          {!bucket.isUnassigned && onOpenGroupsManager && (
                            <button
                              type="button"
                              onPointerDown={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenGroupsManager(bucket.name);
                              }}
                              title={`Editar grupo "${bucket.name}" y asignar alumnos`}
                              className="p-1 rounded hover:bg-white/70 text-slate-600 hover:text-blue-700 shrink-0"
                            >
                              <Pencil style={smallIconStyle} />
                            </button>
                          )}
                        </div>
                      </div>
                    </th>

                    {/* iDoceo-style per-column Group Action Cells above each group */}
                    {displaySlots.map((slot) => {
                      const isFolder = slot.kind === 'FOLDER_SUMMARY';
                      const isCritSlot = slot.kind === 'RUBRIC_CRITERION';
                      const cellBg = isFolder
                        ? blendWithWhite(slot.folder.color, 0.36)
                        : isCritSlot
                          ? blendWithWhite(bucket.color, 0.56)
                          : blendWithWhite(bucket.color, 0.66);
                      const isActivePopover =
                        groupColAction?.bucketKey === bucket.key &&
                        ((groupColAction.slot.kind === 'COL' &&
                          slot.kind === 'COL' &&
                          groupColAction.slot.col.id === slot.col.id) ||
                          (groupColAction.slot.kind === 'FOLDER' &&
                            slot.kind === 'FOLDER_SUMMARY' &&
                            groupColAction.slot.folder.id === slot.folder.id) ||
                          (groupColAction.slot.kind === 'RUBRIC_CRITERION' &&
                            slot.kind === 'RUBRIC_CRITERION' &&
                            groupColAction.slot.col.id === slot.col.id &&
                            groupColAction.slot.criterion.id === slot.criterion.id));

                      const isSelectedGroupCol =
                        selectedGroupColCell?.bucketKey === bucket.key &&
                        selectedGroupColCell?.slotKey === slot.key;

                      const buildGroupActionPayload = (rect: DOMRect) => ({
                        bucketKey: bucket.key,
                        bucketName: bucket.name,
                        studentIds: groupStudentIds,
                        slot: isFolder
                          ? ({
                              kind: 'FOLDER',
                              folder: slot.folder,
                              childCols: slot.childCols,
                            } as const)
                          : isCritSlot
                            ? ({
                                kind: 'RUBRIC_CRITERION',
                                col: slot.col,
                                rubric: slot.rubric,
                                criterion: slot.criterion,
                                criterionIndex: slot.criterionIndex,
                              } as const)
                            : ({ kind: 'COL', col: slot.col } as const),
                        top: Math.max(12, Math.min(window.innerHeight - 400, rect.bottom + 6)),
                        left: Math.max(12, Math.min(window.innerWidth - 320, rect.left - 80)),
                      });

                      const grpActKey = `grp-act:${bucket.key}::${slot.key}`;
                      return (
                        <td
                          key={`grp-act-${bucket.key}-${slot.key}`}
                          data-group-col-action={`${bucket.key}::${slot.key}`}
                          style={{ backgroundColor: cellBg, height: groupRowH }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => {
                            touchDoubleTap.start(e, grpActKey);
                          }}
                          onPointerMove={touchDoubleTap.move}
                          onPointerUp={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            touchDoubleTap.end(e, grpActKey, () => {
                              setGroupColGradeDraft('');
                              setSummaryCellPicker(null);
                              setAddGroupSummaryMenu(null);
                              setCriterionPicker(null);
                              setSelectedGroupColCell({ bucketKey: bucket.key, slotKey: slot.key });
                              setGroupColAction(buildGroupActionPayload(rect));
                            });
                          }}
                          onPointerCancel={touchDoubleTap.cancel}
                          onClick={(e) => {
                            if (touchDoubleTap.wasDoubleTapJustHandled()) return;
                            e.stopPropagation();
                            setSummaryCellPicker(null);
                            setAddGroupSummaryMenu(null);
                            setCriterionPicker(null);
                            setSelectedGroupColCell({ bucketKey: bucket.key, slotKey: slot.key });
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setGroupColGradeDraft('');
                            setGroupColAction((prev) =>
                              prev?.bucketKey === bucket.key &&
                              ((prev.slot.kind === 'COL' && slot.kind === 'COL' && prev.slot.col.id === slot.col.id) ||
                                (prev.slot.kind === 'FOLDER' && slot.kind === 'FOLDER_SUMMARY' && prev.slot.folder.id === slot.folder.id) ||
                                (prev.slot.kind === 'RUBRIC_CRITERION' &&
                                  slot.kind === 'RUBRIC_CRITERION' &&
                                  prev.slot.col.id === slot.col.id &&
                                  prev.slot.criterion.id === slot.criterion.id))
                                ? null
                                : buildGroupActionPayload(rect)
                            );
                          }}
                          onDoubleClick={(e) => {
                            if (touchDoubleTap.wasDoubleTapJustHandled()) return;
                            e.stopPropagation();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setGroupColGradeDraft('');
                            setSummaryCellPicker(null);
                            setAddGroupSummaryMenu(null);
                            setCriterionPicker(null);
                            setSelectedGroupColCell({ bucketKey: bucket.key, slotKey: slot.key });
                            setGroupColAction(buildGroupActionPayload(rect));
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setGroupColGradeDraft('');
                            setSummaryCellPicker(null);
                            setAddGroupSummaryMenu(null);
                            setCriterionPicker(null);
                            setSelectedGroupColCell({ bucketKey: bucket.key, slotKey: slot.key });
                            setGroupColAction(buildGroupActionPayload(rect));
                          }}
                          title={
                            isFolder
                              ? `Grupo "${bucket.name}" · Doble clic: ver estadísticas en carpeta ${slot.folder.title}`
                              : isCritSlot
                                ? `Grupo "${bucket.name}" · Doble clic: evaluar criterio C${slot.criterionIndex + 1} (${slot.criterion.title}) en todo el grupo`
                                : slot.col.type === 'RUBRIC'
                                  ? `Grupo "${bucket.name}" · Doble clic: evaluar toda la rúbrica "${slot.col.title}" para este grupo`
                                  : `Grupo "${bucket.name}" · Doble clic: modificar notas o ver estadísticas en ${slot.col.title}`
                          }
                          className={`border-r border-b border-t border-slate-300 text-center align-middle cursor-pointer hover:brightness-95 transition-[background-color,border-color,color,filter,opacity,box-shadow] ${
                            isActivePopover || isSelectedGroupCol
                              ? 'ring-2 ring-inset ring-blue-600'
                              : isSlotColumnSelected(slot)
                                ? 'col-cell-tint'
                                : ''
                          }`}
                        >
                          <div className="flex items-center justify-center h-full text-slate-500/80 hover:text-blue-700">
                            {isFolder ? (
                              <Hexagon style={smallIconStyle} />
                            ) : isCritSlot || slot.col.type === 'RUBRIC' ? (
                              <LayoutGrid style={smallIconStyle} className="text-purple-700/80" />
                            ) : (
                              <ChevronsDown style={smallIconStyle} />
                            )}
                          </div>
                        </td>
                      );
                    })}

                    <td
                      style={{ backgroundColor: blendWithWhite(bucket.color, 0.72), height: groupRowH }}
                      className="border-b border-t border-slate-300 px-2 text-center"
                    >
                      {bucket.students.length === 0 && !bucket.isUnassigned && onOpenGroupsManager && (
                        <button
                          type="button"
                          onClick={() => onOpenGroupsManager(bucket.name)}
                          title="Añadir alumnos a este grupo"
                          className="p-1 rounded text-blue-700 hover:bg-white/70"
                        >
                          <UserPlus style={smallIconStyle} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              }

              if (activeBook.groupByGroups && bucket.isCollapsed) {
                return rows;
              }

              for (const student of bucket.students) {
                const rIdx = runningRowIdx++;
                const rowBg = rIdx % 2 === 0 ? '#FFFFFF' : '#F6F8FA';
                const isStudentRowSelected = selectedStudentRowId === student.id;
                const displayName =
                  workspace.settings.nameFormat === 'FIRST_LAST'
                    ? `${student.firstName} ${student.lastName}`
                    : `${student.lastName}, ${student.firstName}`;
                const stGroup = getStudentActiveGroup(student, activeBook);

                rows.push(
                <tr key={student.id} data-student-row={student.id} style={{ height: rowH }}>
                  {/* Sticky Student Name Cell (1 click selects row in iDoceo style, double click / right click opens student card) */}
                  <th
                    scope="row"
                    aria-selected={isStudentRowSelected}
                    draggable={activeBook.sortMode === 'MANUAL'}
                    onDragStart={() => setDragStudentId(student.id)}
                    onDragOver={(e) => {
                      if (activeBook.sortMode === 'MANUAL') e.preventDefault();
                    }}
                    onDrop={() => {
                      if (!dragStudentId || dragStudentId === student.id) return;
                      const ids = visibleStudents.map((s) => s.id);
                      const from = ids.indexOf(dragStudentId);
                      const to = ids.indexOf(student.id);
                      if (from >= 0 && to >= 0) {
                        ids.splice(from, 1);
                        ids.splice(to, 0, dragStudentId);
                        reorderStudents(
                          ids,
                          activeBook.groupByGroups
                            ? { studentId: dragStudentId, group: stGroup }
                            : undefined
                        );
                      }
                      setDragStudentId(null);
                    }}
                    style={{ backgroundColor: rowBg, height: rowH }}
                    onPointerDown={(e) => {
                      touchDoubleTap.start(e, `st:${student.id}`);
                    }}
                    onPointerMove={touchDoubleTap.move}
                    onPointerUp={(e) => {
                      touchDoubleTap.end(e, `st:${student.id}`, () => {
                        selectEntireStudentRow(student.id);
                        onEditStudent(student);
                      });
                    }}
                    onPointerCancel={touchDoubleTap.cancel}
                    onClick={(e) => {
                      if (touchDoubleTap.wasDoubleTapJustHandled()) {
                        return;
                      }
                      e.stopPropagation();
                      if (
                        !e.shiftKey &&
                        !e.metaKey &&
                        !e.ctrlKey &&
                        touchDoubleTap.handleTouchClick(
                          `st:${student.id}`,
                          () => {
                            selectEntireStudentRow(student.id);
                            onEditStudent(student);
                          },
                          device.isTouch
                        )
                      ) {
                        return;
                      }
                      selectEntireStudentRow(student.id);
                    }}
                    onDoubleClick={() => {
                      if (touchDoubleTap.wasDoubleTapJustHandled()) return;
                      onEditStudent(student);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      selectEntireStudentRow(student.id);
                      onEditStudent(student);
                    }}
                    title={`${displayName} — 1 clic: seleccionar fila · Doble clic o clic derecho: abrir ficha del alumno`}
                    className={`sticky left-0 z-20 border-r-2 border-b border-slate-200 px-2.5 py-1 text-left font-normal relative cursor-pointer ${
                      isStudentRowSelected ? 'student-row-selected' : ''
                    }`}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          onEditStudent(student);
                        } else if (e.key === ' ') {
                          e.preventDefault();
                          selectEntireStudentRow(student.id);
                        }
                      }}
                      style={{ height: Math.max(16, rowH - 8), maxHeight: Math.max(16, rowH - 8) }}
                      className="w-full flex items-center justify-between gap-2 text-left hover:text-blue-700 transition-colors overflow-hidden focus:outline-none"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[1em] font-semibold text-slate-900 truncate">
                          {displayName}
                        </div>
                      </div>
                      <span className="text-[0.83em] text-slate-400 tabular-nums shrink-0">
                        {rIdx + 1}
                      </span>
                    </div>
                  </th>

                  {/* Data Cells & Continuous iDoceo Folder Summary Columns (individual cell selection!) */}
                  {displaySlots.map((slot) => {
                    if (slot.kind === 'FOLDER_SUMMARY') {
                      const val = computeFolderSummary(
                        slot.folder,
                        slot.childCols,
                        student.id,
                        activeBook
                      );
                      const fCellKey = cellKey(student.id, slot.key);
                      const fCell = activeBook.cells[cellKey(student.id, slot.folder.id)];
                      const fComment = fCell?.comment ?? '';
                      const isFolderInline =
                        inlineEdit?.studentId === student.id &&
                        inlineEdit?.columnId === slot.key;
                      const isFolderManual = Boolean(fCell?.manualOverride);
                      const isFolderAutoRecalc = Boolean(fCell?.autoRecalcNotice);
                      const isFocusedFolderCell =
                        selectedCoord?.studentId === student.id &&
                        selectedCoord?.columnId === slot.key;
                      const isFolderCellInMulti = selectedKeys.has(fCellKey);
                      const folderColors = resolveCellColors(val, {
                        colorMode: slot.folder.colorMode ?? 'NONE',
                        minValue: 0,
                        maxValue: 10,
                        passThreshold: activeBook.passThreshold,
                      });
                      const defaultFolderBg = blendWithWhite(
                        slot.folder.color,
                        rIdx % 2 === 0 ? 0.34 : 0.46
                      );
                      const formulaValForTooltip =
                        isFolderManual || isFolderAutoRecalc
                          ? computeFolderFormulaValue(
                              slot.folder,
                              slot.childCols,
                              student.id,
                              activeBook
                            )
                          : null;
                      return (
                        <td
                          key={`${student.id}-${slot.key}`}
                          data-cell={fCellKey}
                          aria-selected={isFolderCellInMulti || isFocusedFolderCell}
                          tabIndex={isFocusedFolderCell ? 0 : -1}
                          style={{
                            height: rowH,
                            backgroundColor: isFolderInline
                              ? '#FFFFFF'
                              : (folderColors.bgColor ?? defaultFolderBg),
                            color: folderColors.textColor ?? '#0F172A',
                          }}
                          onMouseDown={(e) => {
                            if (e.shiftKey || e.metaKey || e.ctrlKey) {
                              e.preventDefault();
                            }
                          }}
                          onPointerDown={(e) => {
                            if (isFolderInline) return;
                            touchDoubleTap.start(e, fCellKey);
                          }}
                          onPointerMove={touchDoubleTap.move}
                          onPointerUp={(e) => {
                            if (isFolderInline) {
                              touchDoubleTap.cancel();
                              return;
                            }
                            touchDoubleTap.end(e, fCellKey, () => {
                              clearCellTooltip();
                              selectSingleCell(student.id, slot.key);
                              ensureCellVisible(student.id, slot.key, 'auto');
                              onOpenCellModal(
                                student,
                                makeVirtualFolderCol(slot.folder, slot.childCols)
                              );
                            });
                          }}
                          onPointerCancel={touchDoubleTap.cancel}
                          onClick={(e) => {
                            if (isFolderInline || touchDoubleTap.wasDoubleTapJustHandled()) {
                              return;
                            }
                            clearCellTooltip();
                            const clicked = { studentId: student.id, columnId: slot.key };
                            const isMod =
                              e.metaKey || e.ctrlKey || (device.isTouch && touchMultiSelect);
                            if (
                              !e.shiftKey &&
                              !isMod &&
                              touchDoubleTap.handleTouchClick(
                                fCellKey,
                                () => {
                                  selectSingleCell(student.id, slot.key);
                                  ensureCellVisible(student.id, slot.key, 'auto');
                                  onOpenCellModal(
                                    student,
                                    makeVirtualFolderCol(slot.folder, slot.childCols)
                                  );
                                },
                                device.isTouch
                              )
                            ) {
                              return;
                            }
                            if (e.shiftKey) {
                              const anchor = anchorCoord ?? selectedCoord ?? clicked;
                              selectRangeToCell(anchor, clicked, isMod);
                            } else if (isMod) {
                              setSelectedStudentRowId(null);
                              const next = new Set(selectedKeys);
                              if (next.has(fCellKey)) next.delete(fCellKey);
                              else next.add(fCellKey);
                              setSelectedColumnTarget(null);
                              setSelectedKeys(next);
                              if (next.size === 0) {
                                setSelectedCoord(null);
                                setAnchorCoord(null);
                              } else {
                                setSelectedCoord(clicked);
                                setAnchorCoord(clicked);
                              }
                            } else {
                              selectSingleCell(student.id, slot.key);
                              ensureCellVisible(student.id, slot.key, 'auto');
                            }
                          }}
                          onDoubleClick={(e) => {
                            if (
                              isFolderInline ||
                              e.shiftKey ||
                              e.metaKey ||
                              e.ctrlKey ||
                              touchDoubleTap.wasDoubleTapJustHandled()
                            ) {
                              return;
                            }
                            clearCellTooltip();
                            selectSingleCell(student.id, slot.key);
                            ensureCellVisible(student.id, slot.key, 'auto');
                            onOpenCellModal(
                              student,
                              makeVirtualFolderCol(slot.folder, slot.childCols)
                            );
                          }}
                          onContextMenu={(e) => {
                            if (isFolderInline) return;
                            e.preventDefault();
                            e.stopPropagation();
                            clearCellTooltip();
                            selectSingleCell(student.id, slot.key);
                            ensureCellVisible(student.id, slot.key, 'auto');
                            onOpenCellModal(
                              student,
                              makeVirtualFolderCol(slot.folder, slot.childCols)
                            );
                          }}
                          onMouseEnter={(e) => {
                            if (isFolderInline) return;
                            const parts: string[] = [];
                            if (isFolderAutoRecalc) {
                              parts.push(
                                'Recalculada automáticamente tras modificar una nota de la carpeta'
                              );
                            } else if (isFolderManual && formulaValForTooltip !== null) {
                              parts.push(
                                `Editada manualmente (calculada: ${formatGrade(formulaValForTooltip, 2)})`
                              );
                            }
                            if (fComment.trim()) parts.push(fComment.trim());
                            if (parts.length === 0) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            if (cellTooltipTimerRef.current !== null) {
                              window.clearTimeout(cellTooltipTimerRef.current);
                            }
                            const snapshot = {
                              top: rect.top,
                              bottom: rect.bottom,
                              left: rect.left,
                              width: rect.width,
                            };
                            const txt = parts.join('\n');
                            cellTooltipTimerRef.current = window.setTimeout(() => {
                              cellTooltipTimerRef.current = null;
                              setCellTooltip({ text: txt, rect: snapshot });
                            }, 600);
                          }}
                          onMouseLeave={() => {
                            clearCellTooltip();
                          }}
                          className={`border-r border-b border-slate-200 px-1 py-0.5 text-center align-middle relative cursor-pointer overflow-hidden ${
                            isFocusedFolderCell || isFolderInline
                              ? 'cell-selected z-10'
                              : isFolderCellInMulti
                                ? 'cell-multi-selected z-10'
                                  : isFolderAutoRecalc
                                    ? `${
                                        isStudentRowSelected
                                          ? 'student-row-cell-tint'
                                          : isSlotColumnSelected(slot)
                                            ? 'col-cell-tint'
                                            : 'hover:brightness-98'
                                      } ring-1 ring-inset ring-indigo-500/85`
                                    : isFolderManual
                                      ? `${
                                          isStudentRowSelected
                                            ? 'student-row-cell-tint'
                                            : isSlotColumnSelected(slot)
                                              ? 'col-cell-tint'
                                              : 'hover:brightness-98'
                                        } ring-1 ring-inset ring-amber-500/85`
                                      : isStudentRowSelected
                                        ? 'student-row-cell-tint'
                                        : isSlotColumnSelected(slot)
                                          ? 'col-cell-tint'
                                          : 'hover:brightness-98'
                          }`}
                        >
                          {/* Permanent visual indicator inside cell for auto-recalculated folder notes */}
                          {isFolderAutoRecalc && !isFolderInline && (
                            <span
                              aria-label="Nota de carpeta recalculada automáticamente tras editar una tarea"
                              title="Recalculada automáticamente tras cambiar una nota de la carpeta"
                              className="absolute top-0.5 left-0.5 px-1 py-0 rounded bg-indigo-100/95 border border-indigo-300/90 text-[9px] font-bold leading-[12px] text-indigo-800 pointer-events-none select-none"
                            >
                              ↻
                            </span>
                          )}
                          {/* Permanent visual indicator inside cell for manually modified folder notes */}
                          {isFolderManual && !isFolderInline && (
                            <span
                              aria-label="Nota calculada modificada manualmente"
                              className="absolute top-0.5 right-0.5 px-1 py-0 rounded bg-amber-100/95 border border-amber-300/90 text-[9px] font-bold leading-[12px] text-amber-800 pointer-events-none select-none"
                            >
                              ✎
                            </span>
                          )}

                          <div
                            style={{ height: Math.max(16, rowH - 5), maxHeight: Math.max(16, rowH - 5) }}
                            className="flex flex-col items-center justify-center gap-0 w-full overflow-hidden leading-tight px-0"
                          >
                            {val !== null && (
                              <span
                                style={{ fontSize: `${scaledGradeFs}px` }}
                                className="font-bold tabular-nums leading-[1.08] shrink-0"
                              >
                                {formatGrade(val, 2)}
                              </span>
                            )}
                            {fComment && (
                              <span
                                className={`w-full overflow-hidden text-ellipsis break-words [overflow-wrap:break-word] ${
                                  val !== null
                                    ? `${
                                        rowH >= 60
                                          ? 'line-clamp-3'
                                          : rowH >= 42
                                            ? 'line-clamp-2'
                                            : 'line-clamp-1'
                                      } text-[0.76em] font-normal text-slate-600 leading-[1.12]`
                                    : `${
                                        rowH >= 60
                                          ? 'line-clamp-4'
                                          : rowH >= 42
                                            ? 'line-clamp-3'
                                            : 'line-clamp-2'
                                      } text-[0.82em] font-medium text-slate-700 leading-[1.14]`
                                }`}
                              >
                                {fComment}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    }

                    if (slot.kind === 'RUBRIC_CRITERION') {
                      const { col, rubric, criterion, criterionIndex, key: critSlotKey } = slot;
                      const critCellKey = cellKey(student.id, critSlotKey);
                      const parentCell = activeBook.cells[cellKey(student.id, col.id)];
                      const critRes = computeRubricCriterionResult(
                        rubric,
                        criterion.id,
                        parentCell?.rubricEval
                      );
                      const isFocusedCritCell =
                        selectedCoord?.studentId === student.id &&
                        selectedCoord?.columnId === critSlotKey;
                      const isCritInMulti = selectedKeys.has(critCellKey);
                      const isCritColSelected = isSlotColumnSelected(slot);
                      const showPct = Boolean(
                        col.rubricShowPercentage || workspace.settings.showRubricsAsPercent
                      );
                      const critBg = critRes ? critRes.level.color : blendWithWhite(rowBg, 0.15);

                      const openCritEditor = (rect: DOMRect) => {
                        clearCellTooltip();
                        const selectedInSameSlot = Array.from(selectedKeys)
                          .filter((k) => k.endsWith(`::${critSlotKey}`))
                          .map((k) => k.slice(0, k.indexOf('::')));
                        const targetStudentIds =
                          selectedInSameSlot.length > 1 && selectedKeys.has(critCellKey)
                            ? selectedInSameSlot
                            : [student.id];
                        setGroupColAction(null);
                        setSummaryCellPicker(null);
                        setLomloePicker(null);
                        setEducamosMenu(null);
                        setCriterionPicker({
                          studentIds: targetStudentIds,
                          studentLabel:
                            targetStudentIds.length > 1
                              ? `${targetStudentIds.length} alumnos seleccionados`
                              : `${student.lastName}, ${student.firstName}`,
                          col,
                          rubric,
                          criterion,
                          criterionIndex,
                          currentLevelId:
                            targetStudentIds.length === 1 ? (critRes?.level.id ?? null) : null,
                          top: Math.max(12, Math.min(window.innerHeight - 430, rect.bottom + 6)),
                          left: Math.max(12, Math.min(window.innerWidth - 320, rect.left)),
                        });
                      };

                      return (
                        <td
                          key={`${student.id}-${critSlotKey}`}
                          data-cell={critCellKey}
                          aria-selected={isCritInMulti || isFocusedCritCell}
                          tabIndex={isFocusedCritCell ? 0 : -1}
                          style={{
                            height: rowH,
                            backgroundColor: critBg,
                            color: '#0F172A',
                          }}
                          onMouseDown={(e) => {
                            if (e.shiftKey || e.metaKey || e.ctrlKey) {
                              e.preventDefault();
                            }
                          }}
                          onPointerDown={(e) => {
                            touchDoubleTap.start(e, critCellKey);
                          }}
                          onPointerMove={touchDoubleTap.move}
                          onPointerUp={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            touchDoubleTap.end(e, critCellKey, () => {
                              const keepMulti =
                                selectedKeys.size > 1 && selectedKeys.has(critCellKey);
                              if (!keepMulti) {
                                selectSingleCell(student.id, critSlotKey);
                                ensureCellVisible(student.id, critSlotKey, 'auto');
                              }
                              openCritEditor(rect);
                            });
                          }}
                          onPointerCancel={touchDoubleTap.cancel}
                          onClick={(e) => {
                            if (touchDoubleTap.wasDoubleTapJustHandled()) {
                              return;
                            }
                            clearCellTooltip();
                            const clicked = { studentId: student.id, columnId: critSlotKey };
                            const isMod =
                              e.metaKey || e.ctrlKey || (device.isTouch && touchMultiSelect);
                            if (
                              !e.shiftKey &&
                              !isMod &&
                              touchDoubleTap.handleTouchClick(
                                critCellKey,
                                () => {
                                  const cellEl = getCellNode(student.id, critSlotKey);
                                  const rect = cellEl?.getBoundingClientRect();
                                  const keepMulti =
                                    selectedKeys.size > 1 && selectedKeys.has(critCellKey);
                                  if (!keepMulti) {
                                    selectSingleCell(student.id, critSlotKey);
                                    ensureCellVisible(student.id, critSlotKey, 'auto');
                                  }
                                  if (rect) openCritEditor(rect);
                                },
                                device.isTouch
                              )
                            ) {
                              return;
                            }
                            if (e.shiftKey) {
                              const anchor = anchorCoord ?? selectedCoord ?? clicked;
                              selectRangeToCell(anchor, clicked, isMod);
                            } else if (isMod) {
                              setSelectedStudentRowId(null);
                              const next = new Set(selectedKeys);
                              if (next.has(critCellKey)) next.delete(critCellKey);
                              else next.add(critCellKey);
                              setSelectedKeys(next);
                              if (next.size === 0) {
                                setSelectedCoord(null);
                                setAnchorCoord(null);
                              } else {
                                setSelectedCoord(clicked);
                                setAnchorCoord(clicked);
                              }
                            } else {
                              selectSingleCell(student.id, critSlotKey);
                              ensureCellVisible(student.id, critSlotKey, 'auto');
                            }
                          }}
                          onDoubleClick={(e) => {
                            if (
                              e.shiftKey ||
                              e.metaKey ||
                              e.ctrlKey ||
                              touchDoubleTap.wasDoubleTapJustHandled()
                            ) {
                              return;
                            }
                            const rect = e.currentTarget.getBoundingClientRect();
                            const keepMulti =
                              selectedKeys.size > 1 && selectedKeys.has(critCellKey);
                            if (!keepMulti) {
                              selectSingleCell(student.id, critSlotKey);
                              ensureCellVisible(student.id, critSlotKey, 'auto');
                            }
                            openCritEditor(rect);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            clearCellTooltip();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const keepMulti =
                              selectedKeys.size > 1 && selectedKeys.has(critCellKey);
                            if (!keepMulti) {
                              selectSingleCell(student.id, critSlotKey);
                              ensureCellVisible(student.id, critSlotKey, 'auto');
                            }
                            openCritEditor(rect);
                          }}
                          title={`${criterion.title} · ${
                            critRes
                              ? `${critRes.level.title} (${critRes.percentage}%)`
                              : 'Sin evaluar · Doble clic o Enter para valorar este criterio'
                          }`}
                          className={`border-r border-b border-slate-200 px-1 py-0.5 text-center align-middle relative cursor-pointer overflow-hidden ${
                            isFocusedCritCell
                              ? 'cell-selected z-10'
                              : isCritInMulti
                                ? 'cell-multi-selected z-10'
                                : isStudentRowSelected
                                  ? 'student-row-cell-tint'
                                  : isCritColSelected
                                    ? 'col-cell-tint'
                                    : 'hover:brightness-97'
                          }`}
                        >
                          <div
                            style={{ height: Math.max(16, rowH - 5), maxHeight: Math.max(16, rowH - 5) }}
                            className="flex flex-col items-center justify-center gap-0 w-full overflow-hidden leading-tight px-0"
                          >
                            {critRes ? (
                              <>
                                <span
                                  style={{ fontSize: `${scaledGradeFs}px` }}
                                  className="font-normal tabular-nums leading-[1.08] shrink-0"
                                >
                                  {formatCellDisplayGrade(critRes.grade, col, showPct)}
                                </span>
                                {rowH >= 38 && (
                                  <span className="text-[0.72em] font-medium text-slate-700/90 leading-[1.08] truncate max-w-full">
                                    {critRes.level.title}
                                  </span>
                                )}
                              </>
                            ) : null}
                          </div>
                        </td>
                      );
                    }

                    const col = slot.col;
                    const key = cellKey(student.id, col.id);
                    const cell = activeBook.cells[key];
                    const grade = cell?.grade ?? null;
                    const comment = cell?.comment ?? '';
                    const pendingAdj =
                      typeof cell?.pendingAdjustment === 'number' &&
                      Number.isFinite(cell.pendingAdjustment) &&
                      cell.pendingAdjustment !== 0
                        ? cell.pendingAdjustment
                        : 0;
                    const isFocusedCell =
                      selectedCoord?.studentId === student.id &&
                      selectedCoord?.columnId === col.id;
                    const isInMultiSelection = selectedKeys.has(key);
                    const isInline =
                      inlineEdit?.studentId === student.id &&
                      inlineEdit?.columnId === col.id;
                    const counterStepVal =
                      typeof col.counterStep === 'number' && col.counterStep > 0
                        ? col.counterStep
                        : 1;

                    const colors = resolveCellColors(grade, col);
                    const isStandaloneColored =
                      !col.folderId &&
                      Boolean(col.color) &&
                      col.color.toUpperCase() !== '#FFFFFF' &&
                      col.color.toUpperCase() !== '#F8FAFC';
                    const baseColBg = isStandaloneColored
                      ? blendWithWhite(col.color, rIdx % 2 === 0 ? 0.24 : 0.38)
                      : rowBg;
                    const cellBg = isInline ? '#FFFFFF' : (colors.bgColor ?? baseColBg);

                    const isManualRubricEdit = col.type === 'RUBRIC' && Boolean(cell?.manualOverride);
                    const isEducamosOutdated = isCellOutdatedForEducamos(col, student.id, cell);
                    const isColCellSelected = isSlotColumnSelected(slot);

                    const triggerPrimaryColEdit = () => {
                      clearCellTooltip();
                      if (
                        col.type === 'RUBRIC' &&
                        sameRubricColSelection &&
                        sameRubricColSelection.col.id === col.id &&
                        selectedKeys.has(key)
                      ) {
                        onOpenRubricGrader(null, col, {
                          groupName: `${sameRubricColSelection.studentIds.length} alumnos seleccionados`,
                          studentIds: sameRubricColSelection.studentIds,
                        });
                        return;
                      }
                      selectSingleCell(student.id, col.id);
                      ensureCellVisible(student.id, col.id, 'auto');
                      if (col.type === 'RUBRIC') {
                        onOpenRubricGrader(student, col);
                      } else if (col.type === 'NUMERIC') {
                        const editorMode = col.editorMode ?? 'STANDARD';
                        if (editorMode === 'COUNTER_POS') {
                          stepCellByDelta(student.id, col, counterStepVal);
                        } else if (editorMode === 'COUNTER_NEG') {
                          stepCellByDelta(student.id, col, -counterStepVal);
                        } else if (editorMode === 'QUICK_COUNTER') {
                          if (!activeTab?.isLocked && !col.isLocked) {
                            setQuickCounterColumnId(col.id);
                          }
                        } else {
                          onOpenCellModal(student, col);
                        }
                      } else {
                        onEditColumn(col);
                      }
                    };

                    return (
                      <td
                        key={`${student.id}-${col.id}`}
                        data-cell={key}
                        aria-selected={isInMultiSelection || isFocusedCell}
                        tabIndex={isFocusedCell ? 0 : -1}
                        onMouseDown={(e) => {
                          if (e.shiftKey || e.metaKey || e.ctrlKey) {
                            e.preventDefault();
                          }
                        }}
                        onPointerDown={(e) => {
                          if (isInline) return;
                          touchDoubleTap.start(e, key);
                        }}
                        onPointerMove={touchDoubleTap.move}
                        onPointerUp={(e) => {
                          if (isInline) {
                            touchDoubleTap.cancel();
                            return;
                          }
                          touchDoubleTap.end(e, key, () => {
                            triggerPrimaryColEdit();
                          });
                        }}
                        onPointerCancel={touchDoubleTap.cancel}
                        onClick={(e) => {
                          if (isInline || touchDoubleTap.wasDoubleTapJustHandled()) {
                            return;
                          }
                          clearCellTooltip();
                          const clicked = { studentId: student.id, columnId: col.id };
                          const isMod =
                            e.metaKey || e.ctrlKey || (device.isTouch && touchMultiSelect);
                          if (
                            !e.shiftKey &&
                            !isMod &&
                            touchDoubleTap.handleTouchClick(
                              key,
                              () => {
                                triggerPrimaryColEdit();
                              },
                              device.isTouch
                            )
                          ) {
                            return;
                          }
                          if (e.shiftKey) {
                            const anchor = anchorCoord ?? selectedCoord ?? clicked;
                            selectRangeToCell(anchor, clicked, isMod);
                          } else if (isMod) {
                            setSelectedStudentRowId(null);
                            const next = new Set(selectedKeys);
                            if (next.has(key)) {
                              next.delete(key);
                            } else {
                              next.add(key);
                            }
                            setSelectedKeys(next);
                            if (next.size === 0) {
                              setSelectedCoord(null);
                              setAnchorCoord(null);
                            } else {
                              setSelectedCoord(clicked);
                              setAnchorCoord(clicked);
                            }
                          } else {
                            // Plain single click ONLY selects this cell
                            selectSingleCell(student.id, col.id);
                            ensureCellVisible(student.id, col.id, 'auto');
                          }
                        }}
                        onDoubleClick={(e) => {
                          if (
                            isInline ||
                            e.shiftKey ||
                            e.metaKey ||
                            e.ctrlKey ||
                            touchDoubleTap.wasDoubleTapJustHandled()
                          ) {
                            return;
                          }
                          triggerPrimaryColEdit();
                        }}
                        onContextMenu={(e) => {
                          if (isInline) return;
                          e.preventDefault();
                          e.stopPropagation();
                          clearCellTooltip();
                          const keepMulti = selectedKeys.size > 1 && selectedKeys.has(key);
                          if (!keepMulti) {
                            selectSingleCell(student.id, col.id);
                            ensureCellVisible(student.id, col.id, 'auto');
                          }
                          if (col.type === 'RUBRIC') {
                            onOpenRubricGrader(student, col);
                          } else if (col.type === 'AVERAGE') {
                            onEditColumn(col);
                          } else {
                            onOpenCellModal(student, col);
                          }
                        }}
                        onMouseEnter={(e) => {
                          if (isInline || (!comment.trim() && pendingAdj === 0)) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          if (cellTooltipTimerRef.current !== null) {
                            window.clearTimeout(cellTooltipTimerRef.current);
                          }
                          const snapshot = {
                            top: rect.top,
                            bottom: rect.bottom,
                            left: rect.left,
                            width: rect.width,
                          };
                          const pendingPrefix =
                            pendingAdj !== 0
                              ? `${grade !== null ? 'Ajuste aplicado' : 'Ajuste pendiente'}: ${
                                  pendingAdj > 0 ? '+' : ''
                                }${String(pendingAdj).replace('.', ',')} pt`
                              : '';
                          const cleanCmt = comment.trim();
                          const txt =
                            pendingPrefix && cleanCmt
                              ? `${pendingPrefix}\n${cleanCmt}`
                              : pendingPrefix || cleanCmt;
                          cellTooltipTimerRef.current = window.setTimeout(() => {
                            cellTooltipTimerRef.current = null;
                            setCellTooltip({ text: txt, rect: snapshot });
                          }, 600);
                        }}
                        onMouseLeave={() => {
                          clearCellTooltip();
                        }}
                        style={{
                          height: rowH,
                          backgroundColor: cellBg,
                          color: colors.textColor ?? '#0F172A',
                        }}
                        className={`border-r border-b border-slate-200 px-1 py-0.5 text-center align-middle relative cursor-pointer overflow-hidden ${
                          isFocusedCell || isInline
                            ? 'cell-selected z-10'
                            : isInMultiSelection
                              ? 'cell-multi-selected z-10'
                              : isEducamosOutdated
                                ? `${
                                    isStudentRowSelected
                                      ? 'student-row-cell-tint'
                                      : isColCellSelected
                                        ? 'col-cell-tint'
                                        : 'hover:brightness-98'
                                  } ring-1 ring-inset ring-orange-500/80`
                                : isManualRubricEdit
                                  ? `${
                                      isStudentRowSelected
                                        ? 'student-row-cell-tint'
                                        : isColCellSelected
                                          ? 'col-cell-tint'
                                          : 'hover:brightness-98'
                                    } ring-1 ring-inset ring-amber-500/80`
                                  : isStudentRowSelected
                                    ? 'student-row-cell-tint'
                                    : isColCellSelected
                                      ? 'col-cell-tint'
                                      : 'hover:brightness-98'
                        }`}
                      >
                        {/* Discreet corner indicator for cells changed after passing to Educamos */}
                        {isEducamosOutdated && !isInline && (
                          <span
                            aria-label="Nota modificada desde el último paso a Educamos"
                            title="Nota modificada desde que se pasó a Educamos"
                            className="absolute top-0 left-0 w-0 h-0 border-t-[9px] border-r-[9px] border-t-orange-500 border-r-transparent pointer-events-none"
                          />
                        )}
                        {/* Permanent in-cell indicator for manually-edited rubric cells (zero hover tooltip) */}
                        {isManualRubricEdit && !isInline && (
                          <span
                            aria-label="Nota editada manualmente"
                            className="absolute top-0.5 right-0.5 px-1 py-0 rounded bg-amber-100/95 border border-amber-300/90 text-[9px] font-bold leading-[12px] text-amber-800 pointer-events-none select-none"
                          >
                            ✎
                          </span>
                        )}

                        <div
                          style={{ height: Math.max(16, rowH - 5), maxHeight: Math.max(16, rowH - 5) }}
                          className="flex flex-col items-center justify-center gap-0 w-full overflow-hidden leading-tight px-0"
                        >
                          {grade !== null ? (
                            <span
                              style={{ fontSize: `${scaledGradeFs}px` }}
                              className="font-normal tabular-nums leading-[1.08] shrink-0"
                            >
                              {formatCellDisplayGrade(
                                grade,
                                col,
                                Boolean(
                                  col.rubricShowPercentage ||
                                    workspace.settings.showRubricsAsPercent
                                )
                              )}
                            </span>
                          ) : pendingAdj !== 0 ? (
                            <span
                              data-pending-adjustment-badge="true"
                              className={`px-1.5 py-0 rounded-full text-[9.5px] font-bold tabular-nums leading-[13px] shrink-0 ${
                                pendingAdj < 0
                                  ? 'bg-rose-100/90 text-rose-800 border border-rose-200/80'
                                  : 'bg-emerald-100/90 text-emerald-800 border border-emerald-200/80'
                              }`}
                            >
                              {pendingAdj > 0 ? '+' : ''}
                              {String(pendingAdj).replace('.', ',')} pend.
                            </span>
                          ) : null}
                          {comment && (
                            <span
                              className={`w-full overflow-hidden text-ellipsis break-words [overflow-wrap:break-word] ${
                                grade !== null
                                  ? `${
                                      rowH >= 60
                                        ? 'line-clamp-3'
                                        : rowH >= 42
                                          ? 'line-clamp-2'
                                          : 'line-clamp-1'
                                    } text-[0.76em] font-normal text-slate-600 leading-[1.12]`
                                  : `${
                                      rowH >= 60
                                        ? 'line-clamp-4'
                                        : rowH >= 42
                                          ? 'line-clamp-3'
                                          : 'line-clamp-2'
                                    } text-[0.82em] font-medium text-slate-700 leading-[1.14]`
                              }`}
                            >
                              {comment}
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}

                  <td
                    className={`border-b border-slate-200 bg-slate-50/40 ${
                      isStudentRowSelected ? 'student-row-cell-tint' : ''
                    }`}
                  />
                </tr>
                );
              }

              // Per-Group Bottom Summary Rows (up to 5 rows; configuring ONE group configures ALL groups!)
              if (activeBook.groupByGroups && groupSummaryRows.length > 0) {
                groupSummaryRows.forEach((globalGrpMetric, gRowIdx) => {
                  const globalOpt =
                    COLUMN_SUMMARY_OPTIONS.find((o) => o.metric === globalGrpMetric) ??
                    COLUMN_SUMMARY_OPTIONS[0];
                  const isLastGrpSummaryRow = gRowIdx === groupSummaryRows.length - 1;

                  rows.push(
                    <tr
                      key={`grp-sum-${bucket.key}-${gRowIdx}`}
                      data-group-summary-row={`${bucket.key}::${gRowIdx}`}
                      style={{ height: summaryRowH }}
                      className="bg-white"
                    >
                      <th
                        scope="row"
                        style={{ height: summaryRowH }}
                        className={`sticky left-0 z-20 bg-slate-50/95 border-r-2 border-b border-slate-200 px-2 py-0.5 text-left font-normal ${
                          selectedSummaryCell === `group::${bucket.key}::header::${gRowIdx}`
                            ? 'ring-2 ring-inset ring-blue-600'
                            : ''
                        }`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setGroupColAction(null);
                          setAddGroupSummaryMenu(null);
                          setSummaryCellPicker(null);
                          setSelectedGroupColCell(null);
                          setSelectedCoord(null);
                          setSelectedKeys(new Set());
                          setSelectedColumnTarget(null);
                          setSelectedSummaryCell(`group::${bucket.key}::header::${gRowIdx}`);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setGroupColAction(null);
                          setAddGroupSummaryMenu(null);
                          setSelectedSummaryCell(`group::${bucket.key}::header::${gRowIdx}`);
                          setSummaryCellPicker({
                            scope: 'GROUP',
                            rowIndex: gRowIdx,
                            target: { kind: 'GLOBAL' },
                            top: Math.max(12, Math.min(window.innerHeight - 320, rect.top - 90)),
                            left: Math.min(window.innerWidth - 250, rect.left),
                          });
                        }}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setGroupColAction(null);
                              setAddGroupSummaryMenu(null);
                              setSummaryCellPicker(null);
                              setSelectedGroupColCell(null);
                              setSelectedCoord(null);
                              setSelectedKeys(new Set());
                              setSelectedColumnTarget(null);
                              setSelectedSummaryCell(`group::${bucket.key}::header::${gRowIdx}`);
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setGroupColAction(null);
                              setAddGroupSummaryMenu(null);
                              setSelectedSummaryCell(`group::${bucket.key}::header::${gRowIdx}`);
                              setSummaryCellPicker({
                                scope: 'GROUP',
                                rowIndex: gRowIdx,
                                target: { kind: 'GLOBAL' },
                                top: Math.max(12, Math.min(window.innerHeight - 320, rect.top - 90)),
                                left: Math.min(window.innerWidth - 250, rect.left),
                              });
                            }}
                            title="Doble clic para cambiar estadística de grupo (se aplica a todos los grupos)"
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white hover:bg-indigo-50 border border-slate-200 text-[0.8em] font-bold text-slate-700 hover:text-indigo-700 truncate max-w-[148px]"
                          >
                            <Sigma style={smallIconStyle} className="text-indigo-600 shrink-0" />
                            <span className="truncate">{globalOpt.shortLabel}</span>
                            <ChevronDown style={smallIconStyle} className="opacity-60 shrink-0" />
                          </button>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {isLastGrpSummaryRow && (
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  setSummaryCellPicker(null);
                                  setGroupColAction(null);
                                  setAddGroupSummaryMenu({
                                    top: Math.max(12, Math.min(window.innerHeight - 320, rect.top - 180)),
                                    left: Math.min(window.innerWidth - 250, rect.left),
                                  });
                                }}
                                title="Añadir estadística al final de todos los grupos"
                                aria-label="Añadir estadística de grupo"
                                className="p-0.5 rounded text-indigo-600 hover:bg-indigo-100"
                              >
                                <Plus style={smallIconStyle} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeGroupSummaryRow(gRowIdx)}
                              title="Eliminar esta fila de estadística en todos los grupos"
                              aria-label={`Eliminar fila de estadística de grupo ${globalOpt.label}`}
                              className="p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            >
                              <X style={smallIconStyle} />
                            </button>
                          </div>
                        </div>
                      </th>

                      {displaySlots.map((slot) => {
                        const isFolder = slot.kind === 'FOLDER_SUMMARY';
                        const isCritSlot = slot.kind === 'RUBRIC_CRITERION';
                        const overrideMetric = isFolder
                          ? slot.folder.groupSummaryRowOverrides?.[gRowIdx]
                          : isCritSlot
                            ? undefined
                            : slot.col.groupSummaryRowOverrides?.[gRowIdx];
                        const effectiveMetric = overrideMetric ?? globalGrpMetric;
                        const metricOpt = COLUMN_SUMMARY_OPTIONS.find(
                          (o) => o.metric === effectiveMetric
                        );

                        const grpGrades = bucket.students.map((st) => {
                          if (isFolder) {
                            return computeFolderSummary(slot.folder, slot.childCols, st.id, activeBook);
                          }
                          if (isCritSlot) {
                            const pCell = activeBook.cells[cellKey(st.id, slot.col.id)];
                            return (
                              computeRubricCriterionResult(
                                slot.rubric,
                                slot.criterion.id,
                                pCell?.rubricEval
                              )?.grade ?? null
                            );
                          }
                          return activeBook.cells[cellKey(st.id, slot.col.id)]?.grade ?? null;
                        });
                        const threshold = isFolder ? activeBook.passThreshold : slot.col.passThreshold;
                        const decimals = isFolder ? 2 : slot.col.decimals;
                        const formatted = computeColumnSummaryMetric(
                          effectiveMetric,
                          grpGrades,
                          threshold,
                          decimals
                        );
                        const isSelectedGrpCell =
                          selectedSummaryCell === `group::${bucket.key}::${gRowIdx}::${slot.key}`;

                        return (
                          <td
                            key={`grp-sum-cell-${bucket.key}-${gRowIdx}-${slot.key}`}
                            style={{
                              height: summaryRowH,
                              backgroundColor: isFolder
                                ? blendWithWhite(slot.folder.color, 0.5)
                                : overrideMetric
                                  ? '#EEF2FF'
                                  : '#FFFFFF',
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setGroupColAction(null);
                              setAddGroupSummaryMenu(null);
                              setSummaryCellPicker(null);
                              setSelectedGroupColCell(null);
                              setSelectedCoord(null);
                              setSelectedKeys(new Set());
                              setSelectedColumnTarget(null);
                              setSelectedSummaryCell(`group::${bucket.key}::${gRowIdx}::${slot.key}`);
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setGroupColAction(null);
                              setAddGroupSummaryMenu(null);
                              setSelectedSummaryCell(`group::${bucket.key}::${gRowIdx}::${slot.key}`);
                              setSummaryCellPicker({
                                scope: 'GROUP',
                                rowIndex: gRowIdx,
                                target: isFolder
                                  ? {
                                      kind: 'FOLDER',
                                      tabId: activeTab.id,
                                      id: slot.folder.id,
                                      title: slot.folder.title,
                                    }
                                  : { kind: 'COL', id: slot.col.id, title: slot.col.title },
                                top: Math.max(12, Math.min(window.innerHeight - 340, rect.top - 120)),
                                left: Math.max(12, Math.min(window.innerWidth - 250, rect.left)),
                              });
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setGroupColAction(null);
                              setAddGroupSummaryMenu(null);
                              setSelectedSummaryCell(`group::${bucket.key}::${gRowIdx}::${slot.key}`);
                              setSummaryCellPicker({
                                scope: 'GROUP',
                                rowIndex: gRowIdx,
                                target: isFolder
                                  ? {
                                      kind: 'FOLDER',
                                      tabId: activeTab.id,
                                      id: slot.folder.id,
                                      title: slot.folder.title,
                                    }
                                  : { kind: 'COL', id: slot.col.id, title: slot.col.title },
                                top: Math.max(12, Math.min(window.innerHeight - 340, rect.top - 120)),
                                left: Math.max(12, Math.min(window.innerWidth - 250, rect.left)),
                              });
                            }}
                            title={`${bucket.name} · ${metricOpt?.label ?? ''}: ${formatted || '—'} · Doble clic para cambiar (se aplica a todos los grupos)`}
                            className={`border-r border-b border-slate-200 px-1 py-0.5 text-center align-middle cursor-pointer hover:brightness-95 transition-[background-color,border-color,color,filter,opacity,box-shadow] ${
                              isSelectedGrpCell
                                ? 'ring-2 ring-inset ring-blue-600 z-10'
                                : isSlotColumnSelected(slot)
                                  ? 'col-cell-tint'
                                  : ''
                            }`}
                          >
                            <div className="font-bold text-slate-900 tabular-nums text-[0.88em] leading-tight truncate">
                              {formatted || '—'}
                            </div>
                            {effectiveMetric !== 'NONE' && metricOpt && (
                              <div
                                data-group-summary-metric-hint={effectiveMetric}
                                style={{ fontSize: `${Math.max(8, Math.round(9 * gridZoom))}px` }}
                                className={`leading-none truncate mt-0.5 select-none ${
                                  overrideMetric && overrideMetric !== globalGrpMetric
                                    ? 'font-semibold text-indigo-600/85'
                                    : 'font-normal text-slate-400'
                                }`}
                              >
                                {metricOpt.symbol && (
                                  <span className="opacity-85 mr-0.5">{metricOpt.symbol}</span>
                                )}
                                <span>{metricOpt.shortLabel}</span>
                              </div>
                            )}
                          </td>
                        );
                      })}

                      <td className="border-b border-slate-200 bg-slate-50/40" />
                    </tr>
                  );
                });
              }

              // Empty visual separator row(s) after each uncollapsed group (configurable height!)
              if (activeBook.groupByGroups && groupSpacerRows > 0) {
                for (let sp = 0; sp < groupSpacerRows; sp++) {
                  rows.push(
                    <tr
                      key={`grp-spacer-${bucket.key}-${sp}`}
                      data-group-spacer={`${bucket.key}-${sp}`}
                      style={{ height: groupSpacerH }}
                      className="bg-slate-100/55"
                    >
                      <th
                        scope="row"
                        style={{ height: groupSpacerH }}
                        className="sticky left-0 z-20 bg-slate-100/90 border-r-2 border-b border-slate-200/80"
                      />
                      <td
                        colSpan={displaySlots.length + 1}
                        style={{ height: groupSpacerH }}
                        className="border-b border-slate-200/80 bg-slate-50/70"
                      />
                    </tr>
                  );
                }
              }

              return rows;
            });
          })()}
        </tbody>

        {/* BOTTOM SUMMARY ROWS (up to 5 per column, individually editable or globally extensible) */}
        {workspace.settings.showStatsRow && (
        <tfoot className="bg-slate-50">
          {summaryRows.map((globalMetric, rowIdx) => {
            const globalOpt =
              COLUMN_SUMMARY_OPTIONS.find((o) => o.metric === globalMetric) ??
              COLUMN_SUMMARY_OPTIONS[0];
            const sumRowH = summaryRowH;

            return (
              <tr
                key={`sum-row-${rowIdx}`}
                data-summary-row={rowIdx}
                style={{ height: sumRowH }}
                className="bg-slate-50"
              >
                <th
                  scope="row"
                  style={{ height: sumRowH }}
                  className={`sticky left-0 z-20 bg-slate-100 border-r-2 border-b border-slate-300 ${
                    rowIdx === 0 ? 'border-t-2 border-t-slate-300' : ''
                  } px-2 py-0.5 text-left font-normal ${
                    selectedSummaryCell === `table::header::${rowIdx}`
                      ? 'ring-2 ring-inset ring-blue-600'
                      : ''
                  }`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSummaryCellPicker(null);
                    setGroupColAction(null);
                    setAddGroupSummaryMenu(null);
                    setSelectedGroupColCell(null);
                    setSelectedCoord(null);
                    setSelectedKeys(new Set());
                    setSelectedColumnTarget(null);
                    setSelectedSummaryCell(`table::header::${rowIdx}`);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setSelectedSummaryCell(`table::header::${rowIdx}`);
                    setSummaryCellPicker({
                      scope: 'TABLE',
                      rowIndex: rowIdx,
                      target: { kind: 'GLOBAL' },
                      top: Math.max(12, Math.min(window.innerHeight - 320, rect.top - 120)),
                      left: Math.min(window.innerWidth - 240, rect.left),
                    });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setSelectedSummaryCell(`table::header::${rowIdx}`);
                    setSummaryCellPicker({
                      scope: 'TABLE',
                      rowIndex: rowIdx,
                      target: { kind: 'GLOBAL' },
                      top: Math.max(12, Math.min(window.innerHeight - 320, rect.top - 120)),
                      left: Math.min(window.innerWidth - 240, rect.left),
                    });
                  }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setGroupColAction(null);
                        setAddGroupSummaryMenu(null);
                        setSelectedGroupColCell(null);
                        setSelectedCoord(null);
                        setSelectedKeys(new Set());
                        setSelectedColumnTarget(null);
                        setSelectedSummaryCell(`table::header::${rowIdx}`);
                        setSummaryCellPicker((prev) =>
                          prev &&
                          prev.scope === 'TABLE' &&
                          prev.target.kind === 'GLOBAL' &&
                          prev.rowIndex === rowIdx
                            ? null
                            : {
                                scope: 'TABLE',
                                rowIndex: rowIdx,
                                target: { kind: 'GLOBAL' },
                                top: Math.max(12, Math.min(window.innerHeight - 320, rect.top - 120)),
                                left: Math.min(window.innerWidth - 240, rect.left),
                              }
                        );
                      }}
                      title="Cambiar estadística de esta fila en todas las clases y pestañas"
                      className="inline-flex items-center gap-1 px-1.5 py-0 rounded-md bg-white/90 hover:bg-white border border-slate-200 text-[0.84em] font-bold text-slate-700 hover:text-blue-700 truncate max-w-[165px]"
                    >
                      <Sigma style={smallIconStyle} className="text-blue-600 shrink-0" />
                      <span className="truncate">{globalOpt.label}</span>
                      <ChevronDown style={smallIconStyle} className="opacity-60 shrink-0" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSummaryRow(rowIdx);
                      }}
                      title="Eliminar esta fila de resumen"
                      aria-label={`Eliminar fila de resumen ${globalOpt.label}`}
                      className="p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                    >
                      <X style={smallIconStyle} />
                    </button>
                  </div>
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Cambiar altura de filas de estadísticas y medias en toda la app"
                    title="Arrastra verticalmente para ajustar la altura de las filas de medias/resumen en toda la app"
                    style={device.isTouch ? { touchAction: 'none' } : undefined}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      beginAspectChange();
                      updateSettings({ summaryRowHeight: 32 });
                    }}
                    onPointerDown={startSummaryRowHeightResize}
                    className="absolute left-0 bottom-0 w-full h-1.5 cursor-row-resize hover:bg-indigo-500/50 transition-colors z-20"
                  />
                </th>

                {displaySlots.map((slot) => {
                  const isFolder = slot.kind === 'FOLDER_SUMMARY';
                  const isCritSlot = slot.kind === 'RUBRIC_CRITERION';
                  const overrideMetric = isFolder
                    ? slot.folder.summaryRowOverrides?.[rowIdx]
                    : isCritSlot
                      ? undefined
                      : slot.col.summaryRowOverrides?.[rowIdx];
                  const effectiveMetric = overrideMetric ?? globalMetric;
                  const metricOpt = COLUMN_SUMMARY_OPTIONS.find(
                    (o) => o.metric === effectiveMetric
                  );

                  const gradesForSlot = visibleStudents.map((st) => {
                    if (isFolder) {
                      return computeFolderSummary(slot.folder, slot.childCols, st.id, activeBook);
                    }
                    if (isCritSlot) {
                      const pCell = activeBook.cells[cellKey(st.id, slot.col.id)];
                      return (
                        computeRubricCriterionResult(
                          slot.rubric,
                          slot.criterion.id,
                          pCell?.rubricEval
                        )?.grade ?? null
                      );
                    }
                    return activeBook.cells[cellKey(st.id, slot.col.id)]?.grade ?? null;
                  });
                  const threshold = isFolder ? activeBook.passThreshold : slot.col.passThreshold;
                  const decimals = isFolder ? 2 : slot.col.decimals;
                  const formatted = computeColumnSummaryMetric(
                    effectiveMetric,
                    gradesForSlot,
                    threshold,
                    decimals
                  );
                  const isSelectedCell = selectedSummaryCell === `table::${rowIdx}::${slot.key}`;

                  return (
                    <td
                      key={`sum-${rowIdx}-${slot.key}`}
                      style={{
                        height: sumRowH,
                        backgroundColor: isFolder
                          ? blendWithWhite(slot.folder.color, 0.52)
                          : overrideMetric
                            ? '#EFF6FF'
                            : '#F8FAFC',
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSummaryCellPicker(null);
                        setGroupColAction(null);
                        setAddGroupSummaryMenu(null);
                        setSelectedGroupColCell(null);
                        setSelectedCoord(null);
                        setSelectedKeys(new Set());
                        setSelectedColumnTarget(null);
                        setSelectedSummaryCell(`table::${rowIdx}::${slot.key}`);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSelectedSummaryCell(`table::${rowIdx}::${slot.key}`);
                        setSummaryCellPicker({
                          scope: 'TABLE',
                          rowIndex: rowIdx,
                          target: isFolder
                            ? {
                                kind: 'FOLDER',
                                tabId: activeTab.id,
                                id: slot.folder.id,
                                title: slot.folder.title,
                              }
                            : { kind: 'COL', id: slot.col.id, title: slot.col.title },
                          top: Math.max(12, Math.min(window.innerHeight - 340, rect.top - 140)),
                          left: Math.max(12, Math.min(window.innerWidth - 250, rect.left)),
                        });
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSelectedSummaryCell(`table::${rowIdx}::${slot.key}`);
                        setSummaryCellPicker({
                          scope: 'TABLE',
                          rowIndex: rowIdx,
                          target: isFolder
                            ? {
                                kind: 'FOLDER',
                                tabId: activeTab.id,
                                id: slot.folder.id,
                                title: slot.folder.title,
                              }
                            : { kind: 'COL', id: slot.col.id, title: slot.col.title },
                          top: Math.max(12, Math.min(window.innerHeight - 340, rect.top - 140)),
                          left: Math.max(12, Math.min(window.innerWidth - 250, rect.left)),
                        });
                      }}
                      title={`${metricOpt?.label ?? ''}: ${formatted || '—'} · Doble clic para cambiar resumen de esta columna`}
                      className={`border-r border-b border-slate-300 ${
                        rowIdx === 0 ? 'border-t-2 border-t-slate-300' : ''
                      } px-1 py-0.5 text-center font-bold text-slate-800 tabular-nums cursor-pointer hover:brightness-95 transition-[background-color,border-color,color,filter,opacity,box-shadow] text-[0.9em] ${
                        isSelectedCell
                          ? 'ring-2 ring-inset ring-blue-600 z-10'
                          : isSlotColumnSelected(slot)
                            ? 'col-cell-tint'
                            : ''
                      }`}
                    >
                      <div className="flex flex-col items-center justify-center leading-tight min-w-0">
                        <div className="truncate leading-none">{formatted || '—'}</div>
                        {effectiveMetric !== 'NONE' && metricOpt && (
                          <div
                            data-summary-metric-hint={effectiveMetric}
                            style={{ fontSize: `${Math.max(8, Math.round(9 * gridZoom))}px` }}
                            className={`leading-none truncate max-w-full mt-0.5 select-none ${
                              overrideMetric && overrideMetric !== globalMetric
                                ? 'font-semibold text-blue-600/85'
                                : 'font-normal text-slate-400'
                            }`}
                          >
                            {metricOpt.symbol && (
                              <span className="opacity-85 mr-0.5">{metricOpt.symbol}</span>
                            )}
                            <span>{metricOpt.shortLabel}</span>
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}

                <td
                  className={`border-b border-slate-300 bg-slate-100/70 ${
                    rowIdx === 0 ? 'border-t-2 border-t-slate-300' : ''
                  }`}
                />
              </tr>
            );
          })}

          {/* Last row below last student: Global Summary Rows Menu (all summary options supported) */}
          <tr
            data-summary-controls="true"
            style={{ height: summaryRowH }}
            className="bg-slate-100/80"
          >
            <th
              scope="row"
              style={{ height: summaryRowH }}
              className={`sticky left-0 z-20 bg-slate-100 border-r-2 border-b border-slate-300 ${
                summaryRows.length === 0 ? 'border-t-2 border-t-slate-300' : ''
              } px-2 py-0 text-left font-normal`}
            >
              <div className="relative flex items-center justify-between gap-1" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  data-add-summary-row-btn="true"
                  onClick={() => setShowAddSummaryMenu((v) => !v)}
                  title="Añadir fila de resumen global para todas las clases y pestañas"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white hover:bg-blue-50 border border-slate-300 hover:border-blue-400 text-[11px] font-semibold text-slate-700 hover:text-blue-700 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>Resumen ({summaryRows.length})</span>
                </button>

                {showAddSummaryMenu && (
                  <div
                    role="menu"
                    aria-label="Añadir fila de resumen para todas las columnas"
                    className="absolute bottom-full left-0 mb-1.5 w-64 rounded-2xl border border-slate-200 bg-white shadow-2xl py-1.5 z-50 text-xs"
                  >
                    <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 flex items-center justify-between">
                      <span>Añadir fila resumen</span>
                      <button
                        type="button"
                        onClick={() => {
                          for (const opt of COLUMN_SUMMARY_OPTIONS) {
                            if (opt.metric === 'NONE') continue;
                            if (!summaryRows.includes(opt.metric)) {
                              addSummaryRow(opt.metric);
                            }
                          }
                          setShowAddSummaryMenu(false);
                        }}
                        className="text-blue-600 hover:underline font-bold normal-case"
                      >
                        Añadir todas
                      </button>
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1">
                      {COLUMN_SUMMARY_OPTIONS.filter((o) => o.metric !== 'NONE').map((opt) => {
                        const isAdded = summaryRows.includes(opt.metric);
                        return (
                          <button
                            key={opt.metric}
                            type="button"
                            onClick={() => {
                              addSummaryRow(opt.metric);
                              setShowAddSummaryMenu(false);
                            }}
                            className="w-full px-3 py-1.5 text-left hover:bg-blue-50 text-slate-700 hover:text-blue-800 font-medium flex items-center justify-between gap-2"
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              {isAdded && <Check className="w-3 h-3 text-emerald-600 shrink-0" />}
                              <span>{opt.label}</span>
                            </span>
                            <span className="text-[10px] text-slate-400 font-semibold shrink-0">
                              {opt.shortLabel}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </th>
            <td
              colSpan={displaySlots.length + 1}
              className={`border-b border-slate-300 bg-slate-100/50 px-3 py-1 text-[10.5px] text-slate-500 ${
                summaryRows.length === 0 ? 'border-t-2 border-t-slate-300' : ''
              }`}
            >
              Pulsa en el selector izquierdo para cambiar estas filas en todas las clases y pestañas, o doble clic en una celda para personalizar esa columna.
            </td>
          </tr>
        </tfoot>
        )}
      </table>
      </div>

      {/* Floating Quick-Counter +/- popup strip anchored to the RIGHT of the active column */}
      {quickCounterPopup && (
        <div
          data-quick-counter-popup={quickCounterPopup.col.id}
          style={{
            position: 'absolute',
            top: 0,
            left: quickCounterPopup.left,
            width: 0,
            height: 0,
            zIndex: 19,
            pointerEvents: 'none',
          }}
        >
          {quickCounterPopup.rows.map(({ student, top, height }) => {
            const stepVal =
              typeof quickCounterPopup.col.counterStep === 'number' &&
              quickCounterPopup.col.counterStep > 0
                ? quickCounterPopup.col.counterStep
                : 1;
            const dName =
              workspace.settings.nameFormat === 'FIRST_LAST'
                ? `${student.firstName} ${student.lastName}`
                : `${student.lastName}, ${student.firstName}`;
            const pillH = device.isTouch
              ? Math.max(36, Math.min(44, Math.round(height - 2)))
              : Math.max(24, Math.min(34, Math.round(height - 6)));
            const pillTop = Math.round(top + (height - pillH) / 2);
            const btnSize = device.isTouch ? Math.max(32, pillH - 4) : Math.max(22, pillH - 4);
            const btnH = device.isTouch ? Math.max(30, pillH - 6) : Math.max(20, pillH - 6);

            return (
              <div
                key={`qc-pop-${student.id}`}
                style={{
                  position: 'absolute',
                  top: pillTop,
                  left: 0,
                  height: pillH,
                  pointerEvents: 'auto',
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 px-1 rounded-xl bg-white/95 backdrop-blur-xs border border-slate-300 shadow-lg"
              >
                <button
                  type="button"
                  data-quick-counter-btn="minus"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectSingleCell(student.id, quickCounterPopup.col.id);
                    stepCellByDelta(student.id, quickCounterPopup.col, -stepVal);
                  }}
                  title={`Restar ${stepVal} a ${dName}`}
                  aria-label={`Restar ${stepVal} a ${dName}`}
                  style={{ width: btnSize, height: btnH }}
                  className="rounded-lg bg-rose-50 hover:bg-rose-100 active:scale-95 border border-rose-200 text-rose-700 flex items-center justify-center shadow-2xs transition-all"
                >
                  <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-quick-counter-btn="plus"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectSingleCell(student.id, quickCounterPopup.col.id);
                    stepCellByDelta(student.id, quickCounterPopup.col, stepVal);
                  }}
                  title={`Sumar ${stepVal} a ${dName}`}
                  aria-label={`Sumar ${stepVal} a ${dName}`}
                  style={{ width: btnSize, height: btnH }}
                  className="rounded-lg bg-emerald-50 hover:bg-emerald-100 active:scale-95 border border-emerald-200 text-emerald-700 flex items-center justify-center shadow-2xs transition-all"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      </div>

      {/* Floating Summary Metric Picker Popover (Table Footer OR Per-Group Footer) */}
      {summaryCellPicker && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{ top: summaryCellPicker.top, left: summaryCellPicker.left }}
          className="fixed w-64 rounded-2xl border border-slate-200 bg-white shadow-2xl py-1.5 z-50 text-xs"
        >
          <div className="px-3 py-1.5 border-b border-slate-100">
            <div className="font-bold text-slate-900 truncate">
              {summaryCellPicker.scope === 'GROUP' ? (
                summaryCellPicker.target.kind === 'GLOBAL'
                  ? `Estadística de grupo ${summaryCellPicker.rowIndex + 1} (Todos)`
                  : `Grupo · ${summaryCellPicker.target.title}`
              ) : summaryCellPicker.target.kind === 'GLOBAL' ? (
                `Fila resumen ${summaryCellPicker.rowIndex + 1} (Todas las clases)`
              ) : (
                `Resumen · ${summaryCellPicker.target.title}`
              )}
            </div>
            <div className="text-[10px] text-slate-500">
              {summaryCellPicker.scope === 'GROUP'
                ? 'Se configura igual en todos los grupos'
                : summaryCellPicker.target.kind === 'GLOBAL'
                  ? 'Se aplica globalmente a todas las clases y pestañas'
                  : 'Personaliza esta columna o aplícalo a toda la app'}
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {COLUMN_SUMMARY_OPTIONS.map((opt) => (
              <div
                key={opt.metric}
                className="flex items-center justify-between px-2 py-0.5 hover:bg-blue-50/70"
              >
                <button
                  type="button"
                  onClick={() => {
                    const isGrp = summaryCellPicker.scope === 'GROUP';
                    if (summaryCellPicker.target.kind === 'GLOBAL') {
                      if (isGrp) {
                        updateGlobalGroupSummaryRow(summaryCellPicker.rowIndex, opt.metric, true);
                      } else {
                        updateGlobalSummaryRow(summaryCellPicker.rowIndex, opt.metric, true);
                      }
                    } else if (summaryCellPicker.target.kind === 'COL') {
                      if (isGrp) {
                        setColumnGroupSummaryOverride(
                          { kind: 'COL', id: summaryCellPicker.target.id },
                          summaryCellPicker.rowIndex,
                          opt.metric
                        );
                      } else {
                        setColumnSummaryOverride(
                          { kind: 'COL', id: summaryCellPicker.target.id },
                          summaryCellPicker.rowIndex,
                          opt.metric
                        );
                      }
                    } else {
                      const folderTarget = {
                        kind: 'FOLDER' as const,
                        tabId: summaryCellPicker.target.tabId,
                        id: summaryCellPicker.target.id,
                      };
                      if (isGrp) {
                        setColumnGroupSummaryOverride(
                          folderTarget,
                          summaryCellPicker.rowIndex,
                          opt.metric
                        );
                      } else {
                        setColumnSummaryOverride(
                          folderTarget,
                          summaryCellPicker.rowIndex,
                          opt.metric
                        );
                      }
                    }
                    setSummaryCellPicker(null);
                  }}
                  className="flex-1 text-left px-1.5 py-1 font-medium text-slate-800 hover:text-blue-800"
                >
                  {opt.label}
                </button>
                {summaryCellPicker.target.kind !== 'GLOBAL' && opt.metric !== 'NONE' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (summaryCellPicker.scope === 'GROUP') {
                        updateGlobalGroupSummaryRow(summaryCellPicker.rowIndex, opt.metric, true);
                      } else {
                        updateGlobalSummaryRow(summaryCellPicker.rowIndex, opt.metric, true);
                      }
                      setSummaryCellPicker(null);
                    }}
                    title="Aplicar esta métrica a todas las columnas, clases y pestañas en esta fila"
                    className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-blue-600 hover:text-white text-[10px] font-semibold text-slate-600 shrink-0"
                  >
                    Todas
                  </button>
                )}
              </div>
            ))}
          </div>

          {summaryCellPicker.target.kind !== 'GLOBAL' && (
            <div className="border-t border-slate-100 mt-1 pt-1 px-2">
              <button
                type="button"
                onClick={() => {
                  const isGrp = summaryCellPicker.scope === 'GROUP';
                  if (summaryCellPicker.target.kind === 'COL') {
                    if (isGrp) {
                      setColumnGroupSummaryOverride(
                        { kind: 'COL', id: summaryCellPicker.target.id },
                        summaryCellPicker.rowIndex,
                        null
                      );
                    } else {
                      setColumnSummaryOverride(
                        { kind: 'COL', id: summaryCellPicker.target.id },
                        summaryCellPicker.rowIndex,
                        null
                      );
                    }
                  } else if (summaryCellPicker.target.kind === 'FOLDER') {
                    const folderTarget = {
                      kind: 'FOLDER' as const,
                      tabId: summaryCellPicker.target.tabId,
                      id: summaryCellPicker.target.id,
                    };
                    if (isGrp) {
                      setColumnGroupSummaryOverride(folderTarget, summaryCellPicker.rowIndex, null);
                    } else {
                      setColumnSummaryOverride(folderTarget, summaryCellPicker.rowIndex, null);
                    }
                  }
                  setSummaryCellPicker(null);
                }}
                className="w-full px-2 py-1 rounded-lg text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
              >
                Usar resumen general de la fila
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating Add Per-Group Summary Row Menu (applies to ALL groups) */}
      {addGroupSummaryMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{ top: addGroupSummaryMenu.top, left: addGroupSummaryMenu.left }}
          role="menu"
          aria-label="Añadir estadística al final de todos los grupos"
          className="fixed w-60 rounded-2xl border border-indigo-200 bg-white shadow-2xl py-1.5 z-50 text-xs"
        >
          <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700 border-b border-slate-100">
            Añadir fila en todos los grupos ({groupSummaryRows.length})
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {COLUMN_SUMMARY_OPTIONS.filter((o) => o.metric !== 'NONE').map((opt) => (
              <button
                key={opt.metric}
                type="button"
                onClick={() => {
                  addGroupSummaryRow(opt.metric);
                  setAddGroupSummaryMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-indigo-50 text-slate-700 hover:text-indigo-800 font-medium flex items-center justify-between"
              >
                <span className="flex items-center gap-1.5 truncate">
                  {groupSummaryRows.includes(opt.metric) && (
                    <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                  )}
                  <span>{opt.label}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-semibold">{opt.shortLabel}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Floating iDoceo-style Group Column Header Action Popover (batch grade, rubric, criterion + group stats!) */}
      {groupColAction && (() => {
        const actSlot = groupColAction.slot;
        const isCol = actSlot.kind === 'COL';
        const isCrit = actSlot.kind === 'RUBRIC_CRITERION';
        const colEntity = actSlot.kind === 'COL' ? actSlot.col : null;
        const critColEntity = actSlot.kind === 'RUBRIC_CRITERION' ? actSlot.col : null;
        const folderSlot = actSlot.kind === 'FOLDER' ? actSlot : null;
        const canBatchEditCol = Boolean(
          colEntity && !activeTab.isLocked && !colEntity.isLocked && colEntity.type !== 'AVERAGE'
        );
        const canBatchEditCrit = Boolean(
          critColEntity && !activeTab.isLocked && !critColEntity.isLocked
        );

        const groupGrades = groupColAction.studentIds.map((sid) => {
          if (colEntity) {
            return activeBook.cells[cellKey(sid, colEntity.id)]?.grade ?? null;
          }
          if (actSlot.kind === 'RUBRIC_CRITERION') {
            const pCell = activeBook.cells[cellKey(sid, actSlot.col.id)];
            return (
              computeRubricCriterionResult(
                actSlot.rubric,
                actSlot.criterion.id,
                pCell?.rubricEval
              )?.grade ?? null
            );
          }
          if (folderSlot) {
            return computeFolderSummary(folderSlot.folder, folderSlot.childCols, sid, activeBook);
          }
          return null;
        });
        const threshold =
          colEntity?.passThreshold ?? critColEntity?.passThreshold ?? activeBook.passThreshold;
        const decimals = colEntity?.decimals ?? critColEntity?.decimals ?? 2;
        const title = colEntity
          ? colEntity.title
          : isCrit
            ? `C${actSlot.criterionIndex + 1}: ${actSlot.criterion.title}`
            : (folderSlot?.folder.title ?? '');

        const targets = colEntity
          ? groupColAction.studentIds.map((studentId) => ({ studentId, columnId: colEntity.id }))
          : [];

        return (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              top: groupColAction.top,
              left: groupColAction.left,
              maxHeight: `calc(100dvh - ${groupColAction.top + 12}px)`,
            }}
            role="dialog"
            aria-label={`Acciones del grupo ${groupColAction.bucketName} en ${title}`}
            className="fixed w-[min(304px,calc(100dvw-24px))] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-2xl p-3 z-50 text-xs space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
              <div className="min-w-0">
                <div className="font-bold text-slate-900 truncate">{groupColAction.bucketName}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {isCol
                    ? title
                    : isCrit
                      ? `${actSlot.col.title} · ${title}`
                      : `Carpeta: ${title}`}{' '}
                  · {groupColAction.studentIds.length} alumnos
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGroupColAction(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {isCrit && canBatchEditCrit && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-purple-950 flex items-center justify-between gap-2">
                  <span>Valorar criterio para todo el grupo</span>
                  <span className="text-[10px] font-bold text-purple-700">
                    Peso {actSlot.criterion.weight}%
                  </span>
                </div>
                <div className="space-y-1 max-h-56 overflow-y-auto pr-0.5">
                  {actSlot.rubric.levels.map((lvl) => {
                    const converted =
                      actSlot.rubric.minScore +
                      (lvl.percentage / 100) * (actSlot.rubric.maxScore - actSlot.rubric.minScore);
                    const scoreStr = formatCellDisplayGrade(
                      converted,
                      actSlot.col,
                      Boolean(
                        actSlot.col.rubricShowPercentage || workspace.settings.showRubricsAsPercent
                      )
                    );
                    const desc =
                      actSlot.rubric.descriptors[`${actSlot.criterion.id}::${lvl.id}`] ?? '';
                    return (
                      <button
                        key={lvl.id}
                        type="button"
                        disabled={groupColAction.studentIds.length === 0}
                        onClick={() => {
                          setRubricCriterionForStudents(
                            groupColAction.studentIds,
                            actSlot.col.id,
                            actSlot.rubric.id,
                            actSlot.criterion.id,
                            lvl.id
                          );
                          showCopyToast(
                            `Criterio "${actSlot.criterion.title}" → "${lvl.title}" aplicado a ${groupColAction.studentIds.length} alumnos de "${groupColAction.bucketName}"`
                          );
                          setGroupColAction(null);
                        }}
                        style={{ backgroundColor: blendWithWhite(lvl.color, 0.2) }}
                        className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 hover:border-purple-400 text-left flex items-start justify-between gap-2 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 truncate">{lvl.title}</div>
                          {desc && (
                            <div className="text-[10px] text-slate-600 line-clamp-2">{desc}</div>
                          )}
                        </div>
                        <span className="font-bold text-slate-900 tabular-nums shrink-0">
                          {scoreStr}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={groupColAction.studentIds.length === 0}
                  onClick={() => {
                    setRubricCriterionForStudents(
                      groupColAction.studentIds,
                      actSlot.col.id,
                      actSlot.rubric.id,
                      actSlot.criterion.id,
                      null
                    );
                    showCopyToast(
                      `Criterio "${actSlot.criterion.title}" borrado en "${groupColAction.bucketName}"`
                    );
                    setGroupColAction(null);
                  }}
                  className="w-full px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-700 font-semibold flex items-center justify-center gap-1 text-[11px]"
                >
                  <Eraser className="w-3 h-3" />
                  <span>Borrar criterio en todo el grupo</span>
                </button>
              </div>
            )}

            {canBatchEditCol && colEntity && colEntity.type === 'RUBRIC' && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  disabled={groupColAction.studentIds.length === 0}
                  onClick={() => {
                    const grpName = groupColAction.bucketName;
                    const sids = groupColAction.studentIds;
                    setGroupColAction(null);
                    onOpenRubricGrader(null, colEntity, {
                      groupName: grpName,
                      studentIds: sids,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-semibold flex items-center justify-center gap-1.5 shadow-2xs"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Evaluar toda la rúbrica para el grupo</span>
                </button>
              </div>
            )}

            {canBatchEditCol && colEntity && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!groupColGradeDraft.trim() || targets.length === 0) return;
                  const parsed = parseMixedInput(groupColGradeDraft);
                  setMultipleCellsData(targets, parsed.grade, parsed.comment);
                  showCopyToast(
                    `Nota aplicada a ${targets.length} alumnos de "${groupColAction.bucketName}"`
                  );
                  setGroupColGradeDraft('');
                  setGroupColAction(null);
                }}
                className="space-y-2"
              >
                <label className="block font-semibold text-slate-700 text-[11px]">
                  {colEntity.type === 'RUBRIC'
                    ? 'O poner nota manual / texto al grupo'
                    : 'Poner nota / texto a todo el grupo a la vez'}
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    autoFocus={colEntity.type !== 'RUBRIC'}
                    value={groupColGradeDraft}
                    onChange={(e) => setGroupColGradeDraft(e.target.value)}
                    placeholder="Ej: 8.5 buen trabajo"
                    className="flex-1 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                  />
                  <button
                    type="submit"
                    disabled={!groupColGradeDraft.trim() || targets.length === 0}
                    className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold shrink-0"
                  >
                    Aplicar
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <button
                    type="button"
                    disabled={targets.length === 0}
                    onClick={() => {
                      clearMultipleCells(targets);
                      showCopyToast(
                        `Notas borradas en "${groupColAction.bucketName}" (${title})`
                      );
                      setGroupColAction(null);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-700 font-semibold flex items-center gap-1 text-[11px]"
                  >
                    <Eraser className="w-3 h-3" />
                    <span>Borrar notas del grupo</span>
                  </button>
                  <button
                    type="button"
                    data-group-batch-adjust-btn="true"
                    disabled={targets.length === 0}
                    onClick={() => {
                      const grpName = groupColAction.bucketName;
                      const colTitle = colEntity.title;
                      const batchTargets = [...targets];
                      setGroupColAction(null);
                      setBatchAdjustState({
                        title: 'Ajustar notas del grupo',
                        subtitle: `${grpName} · ${colTitle} · ${batchTargets.length} alumnos`,
                        targets: batchTargets,
                      });
                    }}
                    className="px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50/80 hover:bg-blue-100 text-blue-800 font-semibold flex items-center gap-1 text-[11px]"
                  >
                    <ArrowDownUp className="w-3 h-3" />
                    <span>± Nota y comentario</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedColumnTarget(null);
                      const keys = new Set(
                        targets.map((t) => cellKey(t.studentId, t.columnId))
                      );
                      setSelectedKeys(keys);
                      if (targets[0]) {
                        setSelectedCoord(targets[0]);
                        setAnchorCoord(targets[0]);
                      }
                      setGroupColAction(null);
                    }}
                    className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-[11px]"
                  >
                    Seleccionar celdas
                  </button>
                </div>
              </form>
            )}

            {/* Instant Group Statistics Card */}
            <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/80 space-y-1.5">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <BarChart3 className="w-3 h-3 text-indigo-600" />
                <span>Estadísticas del grupo</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                {[
                  {
                    label: 'Media',
                    val: computeColumnSummaryMetric('MEAN', groupGrades, threshold, decimals),
                  },
                  {
                    label: '% Aprob.',
                    val: computeColumnSummaryMetric('PASS_PCT', groupGrades, threshold, decimals),
                  },
                  {
                    label: 'Aprob./Susp.',
                    val: `${computeColumnSummaryMetric(
                      'PASS_COUNT',
                      groupGrades,
                      threshold,
                      decimals
                    )} / ${computeColumnSummaryMetric(
                      'FAIL_COUNT',
                      groupGrades,
                      threshold,
                      decimals
                    )}`,
                  },
                  {
                    label: 'Máxima',
                    val: computeColumnSummaryMetric('MAX', groupGrades, threshold, decimals),
                  },
                  {
                    label: 'Mínima',
                    val: computeColumnSummaryMetric('MIN', groupGrades, threshold, decimals),
                  },
                  {
                    label: 'Vacías',
                    val: computeColumnSummaryMetric('EMPTY_COUNT', groupGrades, threshold, decimals),
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-white rounded-lg border border-slate-200/80 px-1.5 py-1"
                  >
                    <div className="text-[9.5px] text-slate-500 font-medium">{stat.label}</div>
                    <div className="font-bold text-slate-900 tabular-nums text-[12px]">
                      {stat.val}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Floating Single-Criterion Level Picker Popover (1 student or multi-selected students) */}
      {criterionPicker && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            top: criterionPicker.top,
            left: criterionPicker.left,
            maxHeight: `calc(100dvh - ${criterionPicker.top + 12}px)`,
          }}
          role="dialog"
          aria-label={`Valorar criterio ${criterionPicker.criterion.title}`}
          className="fixed w-[min(320px,calc(100dvw-24px))] flex flex-col rounded-2xl border border-purple-200 bg-white shadow-2xl overflow-hidden z-50 text-xs"
        >
          <div className="bg-slate-100/90 px-3.5 py-2.5 border-b border-slate-200 flex items-start justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <div className="font-extrabold text-slate-900 uppercase tracking-tight truncate">
                {criterionPicker.studentLabel}
              </div>
              <div className="text-[11px] text-slate-600 truncate mt-0.5">
                {criterionPicker.col.title}
              </div>
              <div className="text-xs text-purple-950 font-bold leading-snug mt-0.5">
                {criterionPicker.criterion.title} ({criterionPicker.criterion.weight}%)
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCriterionPicker(null)}
              aria-label="Cerrar selector de criterio"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-2 space-y-1.5 overflow-y-auto overscroll-contain flex-1 min-h-0">
            {criterionPicker.rubric.levels.map((lvl) => {
              const isSelectedLvl = criterionPicker.currentLevelId === lvl.id;
              const converted =
                criterionPicker.rubric.minScore +
                (lvl.percentage / 100) *
                  (criterionPicker.rubric.maxScore - criterionPicker.rubric.minScore);
              const scoreStr = formatCellDisplayGrade(
                converted,
                criterionPicker.col,
                Boolean(
                  criterionPicker.col.rubricShowPercentage ||
                    workspace.settings.showRubricsAsPercent
                )
              );
              const desc =
                criterionPicker.rubric.descriptors[
                  `${criterionPicker.criterion.id}::${lvl.id}`
                ] ?? '';
              return (
                <button
                  key={lvl.id}
                  type="button"
                  disabled={activeTab.isLocked || Boolean(criterionPicker.col.isLocked)}
                  onClick={() => {
                    setRubricCriterionForStudents(
                      criterionPicker.studentIds,
                      criterionPicker.col.id,
                      criterionPicker.rubric.id,
                      criterionPicker.criterion.id,
                      isSelectedLvl ? null : lvl.id
                    );
                    setCriterionPicker(null);
                  }}
                  style={{ backgroundColor: lvl.color }}
                  className={`w-full px-3 py-2.5 rounded-xl border text-left flex items-center justify-between gap-2.5 transition-all disabled:opacity-50 ${
                    isSelectedLvl
                      ? 'border-blue-600 ring-2 ring-inset ring-blue-600/80 shadow-xs'
                      : 'border-slate-300/70 hover:brightness-97'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {desc ? (
                      <>
                        <div className="text-[11.5px] font-medium text-slate-900 leading-snug flex items-start gap-1.5">
                          {isSelectedLvl && (
                            <Check className="w-3.5 h-3.5 text-blue-700 shrink-0 mt-0.5" />
                          )}
                          <span>{desc}</span>
                        </div>
                        <div className="text-[10px] font-bold text-slate-700/80 mt-0.5">
                          {lvl.title}
                        </div>
                      </>
                    ) : (
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        {isSelectedLvl && (
                          <Check className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                        )}
                        <span>{lvl.title}</span>
                      </div>
                    )}
                  </div>
                  <span className="font-extrabold text-sm text-slate-900 tabular-nums shrink-0">
                    {scoreStr}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="p-2 border-t border-slate-200 bg-slate-50/90 flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={activeTab.isLocked || Boolean(criterionPicker.col.isLocked)}
              onClick={() => {
                setRubricCriterionForStudents(
                  criterionPicker.studentIds,
                  criterionPicker.col.id,
                  criterionPicker.rubric.id,
                  criterionPicker.criterion.id,
                  null
                );
                setCriterionPicker(null);
              }}
              title="Quitar valoración"
              aria-label="Quitar valoración de este criterio"
              className="px-2.5 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold flex items-center gap-1 text-[11px] disabled:opacity-40 shrink-0"
            >
              <Eraser className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                const targetSt =
                  visibleStudents.find((s) => s.id === criterionPicker.studentIds[0]) ?? null;
                const col = criterionPicker.col;
                const ids = criterionPicker.studentIds;
                setCriterionPicker(null);
                if (ids.length > 1) {
                  onOpenRubricGrader(null, col, {
                    groupName: `${ids.length} alumnos seleccionados`,
                    studentIds: ids,
                  });
                } else {
                  onOpenRubricGrader(targetSt, col);
                }
              }}
              className="px-2.5 py-2 rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-800 font-semibold text-[11px] shrink-0"
            >
              Rúbrica
            </button>
            <button
              type="button"
              onClick={() => setCriterionPicker(null)}
              className="flex-1 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs text-center shadow-2xs"
            >
              Ok
            </button>
          </div>
        </div>
      )}

      {/* Touch-only Contextual Action Bar (Tablet/iPad & Mobile — zero footprint on Desktop!) */}
      {device.isTouch && !inlineEdit && (() => {
        // 1. Selected Column or Folder Header
        if (selectedColumnTarget) {
          if (selectedColumnTarget.kind === 'COL') {
            const col = selectedColumnTarget.col;
            const canFillNP =
              col.type !== 'AVERAGE' && !col.isLocked && !activeTab.isLocked;
            const emptyNpCount = canFillNP
              ? countEmptyGradesInColumns(activeBook, [col.id])
              : 0;
            const colRubric =
              col.type === 'RUBRIC' && col.rubricId
                ? workspace.rubrics.find((r) => r.id === col.rubricId) ?? null
                : null;
            const firstGrpBucket = groupBuckets.find((b) => b.key !== '__UNGROUPED__' && b.students.length > 0) ?? groupBuckets[0];
            return (
              <div
                data-touch-action-bar="column"
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  bottom: 'calc(0.75rem + var(--safe-bottom))',
                  left: 'max(0.75rem, var(--safe-left))',
                  maxWidth: 'calc(100dvw - 170px)',
                }}
                className="absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xs shadow-lg overflow-x-auto no-scrollbar text-xs font-semibold text-slate-700"
              >
                <button
                  type="button"
                  onClick={() => onEditColumn(col)}
                  className="min-h-[38px] px-2.5 rounded-xl bg-blue-600 text-white flex items-center gap-1 shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Editar</span>
                </button>
                {col.type === 'RUBRIC' && colRubric && colRubric.criteria.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleColumnRubricExpanded(col.id)}
                    className={`min-h-[38px] px-2.5 rounded-xl border flex items-center gap-1 shrink-0 ${
                      col.rubricExpanded
                        ? 'border-purple-700 bg-purple-600 text-white'
                        : 'border-purple-200 bg-purple-50 text-purple-900'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{col.rubricExpanded ? 'Plegar criterios' : `Subcolumnas (${colRubric.criteria.length})`}</span>
                  </button>
                )}
                {col.type === 'RUBRIC' && effectiveGroups.length > 0 && firstGrpBucket && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenRubricGrader(null, col, {
                        groupName: firstGrpBucket.name,
                        studentIds: firstGrpBucket.students.map((s) => s.id),
                      })
                    }
                    className="min-h-[38px] px-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-900 flex items-center gap-1 shrink-0"
                  >
                    <Users className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Grupo ({firstGrpBucket.name})</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => copyColumnAlphabetical({ kind: 'COL', col })}
                  className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center gap-1 shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Copiar</span>
                </button>
                {canFillNP && (
                  <>
                    <button
                      type="button"
                      data-col-batch-adjust-btn="true"
                      disabled={visibleStudents.length === 0}
                      onClick={() =>
                        setBatchAdjustState({
                          title: 'Ajustar notas y comentar',
                          subtitle: `Columna: ${col.title} · ${visibleStudents.length} alumnos`,
                          targets: visibleStudents.map((s) => ({
                            studentId: s.id,
                            columnId: col.id,
                          })),
                        })
                      }
                      title="Subir o bajar nota y añadir comentario a esta columna"
                      className="min-h-[38px] px-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 disabled:opacity-40 flex items-center gap-1 shrink-0"
                    >
                      <ArrowDownUp className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>± Nota</span>
                    </button>
                    {visibleStudents.some((s) =>
                      canCellRestoreOriginalGrade(activeBook.cells[cellKey(s.id, col.id)])
                    ) && (
                      <button
                        type="button"
                        data-col-restore-original-btn="true"
                        onClick={() =>
                          handleRestoreOriginalSelection(
                            visibleStudents.map((s) => ({
                              studentId: s.id,
                              columnId: col.id,
                            }))
                          )
                        }
                        title="Restaura las notas originales de esta columna (sin subidas/bajadas)"
                        className="min-h-[38px] px-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 flex items-center gap-1 shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Restaurar</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={emptyNpCount === 0}
                      onClick={() => triggerFillEmptyWithNP([col.id], col.title)}
                      title="Rellenar celdas sin nota con 0 y NP"
                      className="min-h-[38px] px-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-900 disabled:opacity-40 flex items-center gap-1 shrink-0"
                    >
                      <FileX2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>0 NP ({emptyNpCount})</span>
                    </button>
                  </>
                )}
                {!activeTab.isLocked && (
                  <>
                    <button
                      type="button"
                      onClick={() => stepColumn(col.id, 'LEFT')}
                      aria-label="Mover columna a la izquierda"
                      className="w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0"
                    >
                      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => stepColumn(col.id, 'RIGHT')}
                      aria-label="Mover columna a la derecha"
                      className="w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0"
                    >
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => resizeColumn(col.id, Math.max(36, col.width - 14))}
                      aria-label="Estrechar columna"
                      className="min-h-[38px] px-2 rounded-xl border border-slate-200 bg-slate-50 shrink-0"
                    >
                      −Ancho
                    </button>
                    <button
                      type="button"
                      onClick={() => resizeColumn(col.id, Math.min(360, col.width + 14))}
                      aria-label="Ensanchar columna"
                      className="min-h-[38px] px-2 rounded-xl border border-slate-200 bg-slate-50 shrink-0"
                    >
                      +Ancho
                    </button>
                  </>
                )}
              </div>
            );
          }

          const { folder, childCols } = selectedColumnTarget;
          const editableFolderColIds = activeTab.isLocked
            ? []
            : childCols
                .filter((c) => c.type !== 'AVERAGE' && !c.isLocked)
                .map((c) => c.id);
          const emptyFolderNpCount =
            editableFolderColIds.length > 0
              ? countEmptyGradesInColumns(activeBook, editableFolderColIds)
              : 0;
          const folderOverrideStats = countFolderOverridesAndNotices(activeBook, folder.id);
          return (
            <div
              data-touch-action-bar="folder"
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                bottom: 'calc(0.75rem + var(--safe-bottom))',
                left: 'max(0.75rem, var(--safe-left))',
                maxWidth: 'calc(100dvw - 170px)',
              }}
              className="absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xs shadow-lg overflow-x-auto no-scrollbar text-xs font-semibold text-slate-700"
            >
              <button
                type="button"
                onClick={() => onEditFolder(activeTab.id, folder)}
                className="min-h-[38px] px-2.5 rounded-xl bg-blue-600 text-white flex items-center gap-1 shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Carpeta</span>
              </button>
              <button
                type="button"
                onClick={() => toggleFolderCollapse(activeTab.id, folder.id)}
                className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 shrink-0"
              >
                {folder.isCollapsed ? 'Desplegar' : 'Plegar'}
              </button>
              <button
                type="button"
                onClick={() => copyColumnAlphabetical({ kind: 'FOLDER', folder, childCols })}
                className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center gap-1 shrink-0"
              >
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copiar</span>
              </button>
              {editableFolderColIds.length > 0 && (
                <button
                  type="button"
                  disabled={emptyFolderNpCount === 0}
                  onClick={() => triggerFillEmptyWithNP(editableFolderColIds, folder.title)}
                  title="Rellenar celdas sin nota de las tareas de esta carpeta con 0 y NP"
                  className="min-h-[38px] px-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-900 disabled:opacity-40 flex items-center gap-1 shrink-0"
                >
                  <FileX2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>0 NP ({emptyFolderNpCount})</span>
                </button>
              )}
              {!activeTab.isLocked && folderOverrideStats.totalCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const count = restoreFolderCalculation(folder.id);
                    if (count > 0) {
                      showCopyToast(`Cálculo restituido en ${count} celda(s) de «${folder.title}»`);
                    }
                  }}
                  title="Restituir el cálculo automático en todas las celdas modificadas de esta carpeta"
                  className="min-h-[38px] px-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 flex items-center gap-1 shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Restituir ({folderOverrideStats.totalCount})</span>
                </button>
              )}
              {!activeTab.isLocked && (
                <>
                  <button
                    type="button"
                    onClick={() => stepFolder(activeTab.id, folder.id, 'LEFT')}
                    aria-label="Mover carpeta a la izquierda"
                    className="w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0"
                  >
                    <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepFolder(activeTab.id, folder.id, 'RIGHT')}
                    aria-label="Mover carpeta a la derecha"
                    className="w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0"
                  >
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      resizeFolder(activeTab.id, folder.id, Math.max(38, (folder.width ?? 68) - 14))
                    }
                    aria-label="Estrechar carpeta"
                    className="min-h-[38px] px-2 rounded-xl border border-slate-200 bg-slate-50 shrink-0"
                  >
                    −Ancho
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      resizeFolder(activeTab.id, folder.id, Math.min(280, (folder.width ?? 68) + 14))
                    }
                    aria-label="Ensanchar carpeta"
                    className="min-h-[38px] px-2 rounded-xl border border-slate-200 bg-slate-50 shrink-0"
                  >
                    +Ancho
                  </button>
                </>
              )}
            </div>
          );
        }

        // 1b. Selected Student Column Header (Tablet width/header-height resize)
        if (selectedStudentColHeader) {
          return (
            <div
              data-touch-action-bar="student-col"
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                bottom: 'calc(0.75rem + var(--safe-bottom))',
                left: 'max(0.75rem, var(--safe-left))',
                maxWidth: 'calc(100dvw - 170px)',
              }}
              className="absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xs shadow-lg overflow-x-auto no-scrollbar text-xs font-semibold text-slate-700"
            >
              <button
                type="button"
                onClick={() => {
                  beginAspectChange();
                  updateSettings({
                    studentColWidth: Math.max(150, workspace.settings.studentColWidth - 16),
                  });
                }}
                aria-label="Estrechar columna de alumnos"
                className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 shrink-0"
              >
                −Ancho
              </button>
              <button
                type="button"
                onClick={() => {
                  beginAspectChange();
                  updateSettings({
                    studentColWidth: Math.min(460, workspace.settings.studentColWidth + 16),
                  });
                }}
                aria-label="Ensanchar columna de alumnos"
                className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 shrink-0"
              >
                +Ancho
              </button>
              <button
                type="button"
                onClick={() => {
                  beginAspectChange();
                  updateSettings({
                    headerHeight: Math.max(52, workspace.settings.headerHeight - 8),
                  });
                }}
                aria-label="Reducir altura de cabecera"
                className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 shrink-0"
              >
                −Cabecera
              </button>
              <button
                type="button"
                onClick={() => {
                  beginAspectChange();
                  updateSettings({
                    headerHeight: Math.min(220, workspace.settings.headerHeight + 8),
                  });
                }}
                aria-label="Aumentar altura de cabecera"
                className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 shrink-0"
              >
                +Cabecera
              </button>
            </div>
          );
        }

        // 2. Selected Student Row
        if (selectedStudentRowId) {
          const st = visibleStudents.find((s) => s.id === selectedStudentRowId);
          if (!st) return null;
          const idx = visibleStudents.findIndex((s) => s.id === st.id);
          const moveStudentBy = (delta: -1 | 1) => {
            const nextIdx = idx + delta;
            if (nextIdx < 0 || nextIdx >= visibleStudents.length) return;
            const ids = visibleStudents.map((s) => s.id);
            const [moved] = ids.splice(idx, 1);
            ids.splice(nextIdx, 0, moved);
            reorderStudents(
              ids,
              activeBook.groupByGroups
                ? { studentId: st.id, group: getStudentActiveGroup(st, activeBook) }
                : undefined
            );
          };
          return (
            <div
              data-touch-action-bar="student"
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                bottom: 'calc(0.75rem + var(--safe-bottom))',
                left: 'max(0.75rem, var(--safe-left))',
                maxWidth: 'calc(100dvw - 170px)',
              }}
              className="absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xs shadow-lg overflow-x-auto no-scrollbar text-xs font-semibold text-slate-700"
            >
              <button
                type="button"
                onClick={() => onEditStudent(st)}
                className="min-h-[38px] px-3 rounded-xl bg-blue-600 text-white flex items-center gap-1.5 shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Ficha de {st.firstName}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  beginAspectChange();
                  updateSettings({ rowHeight: Math.max(36, workspace.settings.rowHeight - 4) });
                }}
                aria-label="Reducir altura de filas"
                className="min-h-[38px] px-2 rounded-xl border border-slate-200 bg-slate-50 shrink-0"
              >
                −Alto
              </button>
              <button
                type="button"
                onClick={() => {
                  beginAspectChange();
                  updateSettings({ rowHeight: Math.min(88, workspace.settings.rowHeight + 4) });
                }}
                aria-label="Aumentar altura de filas"
                className="min-h-[38px] px-2 rounded-xl border border-slate-200 bg-slate-50 shrink-0"
              >
                +Alto
              </button>
              {activeBook.sortMode === 'MANUAL' && (
                <>
                  <button
                    type="button"
                    disabled={idx <= 0}
                    onClick={() => moveStudentBy(-1)}
                    aria-label="Subir alumno"
                    className="w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 disabled:opacity-35 flex items-center justify-center shrink-0"
                  >
                    <ArrowUp className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={idx >= visibleStudents.length - 1}
                    onClick={() => moveStudentBy(1)}
                    aria-label="Bajar alumno"
                    className="w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 disabled:opacity-35 flex items-center justify-center shrink-0"
                  >
                    <ArrowDown className="w-4 h-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          );
        }

        // 3. Multi-cell Selection Bar on Touch (e.g., evaluate multiple rubric cells at once!)
        if (selectedKeys.size > 1) {
          return (
            <div
              data-touch-action-bar="multi"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                bottom: 'calc(0.75rem + var(--safe-bottom))',
                left: 'max(0.75rem, var(--safe-left))',
                maxWidth: 'calc(100dvw - 170px)',
              }}
              className="absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-2xl border border-purple-200 bg-white/95 backdrop-blur-xs shadow-lg overflow-x-auto no-scrollbar text-xs font-semibold text-slate-700"
            >
              <span className="px-2 text-[11px] font-bold text-slate-900 shrink-0">
                {selectedKeys.size} sel.
              </span>

              {sameRubricColSelection && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenRubricGrader(null, sameRubricColSelection.col, {
                      groupName: `${sameRubricColSelection.studentIds.length} alumnos seleccionados`,
                      studentIds: sameRubricColSelection.studentIds,
                    })
                  }
                  className="min-h-[38px] px-3 rounded-xl bg-purple-600 text-white flex items-center gap-1.5 shrink-0"
                >
                  <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Evaluar rúbrica ({sameRubricColSelection.studentIds.length})</span>
                </button>
              )}

              {sameCriterionSelection && (
                <button
                  type="button"
                  onClick={() => {
                    const { critSlot, studentIds } = sameCriterionSelection;
                    const firstSid = studentIds[0];
                    const cellEl = getCellNode(firstSid, critSlot.key);
                    const rect = cellEl?.getBoundingClientRect() ?? {
                      bottom: 180,
                      left: 60,
                    };
                    setCriterionPicker({
                      studentIds,
                      studentLabel: `${studentIds.length} alumnos seleccionados`,
                      col: critSlot.col,
                      rubric: critSlot.rubric,
                      criterion: critSlot.criterion,
                      criterionIndex: critSlot.criterionIndex,
                      currentLevelId: null,
                      top: Math.max(12, Math.min(window.innerHeight - 430, rect.bottom + 6)),
                      left: Math.max(12, Math.min(window.innerWidth - 320, rect.left)),
                    });
                  }}
                  className="min-h-[38px] px-3 rounded-xl bg-purple-600 text-white flex items-center gap-1.5 shrink-0"
                >
                  <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    Valorar C{sameCriterionSelection.critSlot.criterionIndex + 1} (
                    {sameCriterionSelection.studentIds.length})
                  </span>
                </button>
              )}

              {adjustableSelectionTargets.length > 0 && (
                <button
                  type="button"
                  data-multi-batch-adjust-btn="true"
                  onClick={openBatchAdjustForSelection}
                  className="min-h-[38px] px-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 flex items-center gap-1 shrink-0"
                >
                  <ArrowDownUp className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>± Nota</span>
                </button>
              )}

              {restorableSelectionTargets.length > 0 && (
                <button
                  type="button"
                  data-restore-original-grade-btn="true"
                  onClick={() => handleRestoreOriginalSelection(restorableSelectionTargets)}
                  title="Restaurar nota original (sin subidas ni bajadas)"
                  className="min-h-[38px] px-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 flex items-center gap-1 shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Restaurar</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setTouchMultiSelect((v) => !v)}
                aria-pressed={touchMultiSelect}
                className={`min-h-[38px] px-2.5 rounded-xl border shrink-0 ${
                  touchMultiSelect
                    ? 'bg-blue-600 border-blue-700 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                {touchMultiSelect ? 'Añadiendo ✓' : '+ Varias'}
              </button>

              {clearableTargets.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    clearMultipleCells(clearableTargets);
                    showCopyToast(`${clearableTargets.length} celdas borradas`);
                  }}
                  aria-label="Vaciar celdas seleccionadas"
                  className="w-9 h-9 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 flex items-center justify-center shrink-0"
                >
                  <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setTouchMultiSelect(false);
                  setSelectedKeys(new Set());
                  setSelectedCoord(null);
                  setAnchorCoord(null);
                }}
                aria-label="Quitar selección múltiple"
                className="w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 flex items-center justify-center shrink-0"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        }

        // 4. Selected Cell (Column, Folder Summary, or Rubric Criterion)
        if (selectedCoord) {
          const st = visibleStudents.find((s) => s.id === selectedCoord.studentId);
          if (!st) return null;
          const critSlotSelected = displaySlots.find(
            (s): s is Extract<DisplaySlot, { kind: 'RUBRIC_CRITERION' }> =>
              s.kind === 'RUBRIC_CRITERION' && s.key === selectedCoord.columnId
          );
          if (critSlotSelected) {
            return (
              <div
                data-touch-action-bar="cell"
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  bottom: 'calc(0.75rem + var(--safe-bottom))',
                  left: 'max(0.75rem, var(--safe-left))',
                  maxWidth: 'calc(100dvw - 170px)',
                }}
                className="absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xs shadow-lg overflow-x-auto no-scrollbar text-xs font-semibold text-slate-700"
              >
                <button
                  type="button"
                  onClick={() => {
                    const cellEl = getCellNode(st.id, critSlotSelected.key);
                    const rect = cellEl?.getBoundingClientRect() ?? { bottom: 180, left: 60 };
                    const pCell = activeBook.cells[cellKey(st.id, critSlotSelected.col.id)];
                    const curLvlId =
                      pCell?.rubricEval?.selections?.[critSlotSelected.criterion.id]?.levelId ??
                      null;
                    setCriterionPicker({
                      studentIds: [st.id],
                      studentLabel: `${st.lastName}, ${st.firstName}`,
                      col: critSlotSelected.col,
                      rubric: critSlotSelected.rubric,
                      criterion: critSlotSelected.criterion,
                      criterionIndex: critSlotSelected.criterionIndex,
                      currentLevelId: curLvlId,
                      top: Math.max(12, Math.min(window.innerHeight - 430, rect.bottom + 6)),
                      left: Math.max(12, Math.min(window.innerWidth - 320, rect.left)),
                    });
                  }}
                  className="min-h-[38px] px-3 rounded-xl bg-purple-600 text-white flex items-center gap-1.5 shrink-0"
                >
                  <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Valorar C{critSlotSelected.criterionIndex + 1}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTouchMultiSelect((v) => !v)}
                  aria-pressed={touchMultiSelect}
                  className={`min-h-[38px] px-2.5 rounded-xl border shrink-0 ${
                    touchMultiSelect
                      ? 'bg-blue-600 border-blue-700 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  {touchMultiSelect ? 'Añadiendo ✓' : '+ Varias'}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenRubricGrader(st, critSlotSelected.col)}
                  className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 shrink-0"
                >
                  Rúbrica
                </button>
              </div>
            );
          }
          const folderEntry = folderSlotById.get(selectedCoord.columnId);
          if (folderEntry) {
            const fCell = activeBook.cells[cellKey(st.id, folderEntry.folder.id)];
            const fCommentTxt = fCell?.comment?.trim() ?? '';
            const vCol = makeVirtualFolderCol(folderEntry.folder, folderEntry.childCols);
            return (
              <div
                data-touch-action-bar="cell"
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  bottom: 'calc(0.75rem + var(--safe-bottom))',
                  left: 'max(0.75rem, var(--safe-left))',
                  maxWidth: 'calc(100dvw - 170px)',
                }}
                className="absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xs shadow-lg overflow-x-auto no-scrollbar text-xs font-semibold text-slate-700"
              >
                <button
                  type="button"
                  onClick={() => onOpenCellModal(st, vCol)}
                  className="min-h-[38px] px-3 rounded-xl bg-blue-600 text-white flex items-center gap-1.5 shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Editar nota</span>
                </button>

                {(fCell?.manualOverride || fCell?.autoRecalcNotice) && (
                  <button
                    type="button"
                    onClick={() => {
                      restoreFolderCellCalculation(st.id, folderEntry.folder.id);
                      showCopyToast(
                        fCell.manualOverride
                          ? 'Cálculo automático restituido'
                          : 'Aviso de recálculo ocultado'
                      );
                    }}
                    className="min-h-[38px] px-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 flex items-center gap-1 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{fCell.manualOverride ? 'Restituir cálculo' : 'Quitar aviso'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onEditFolder(activeTab.id, folderEntry.folder)}
                  className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 shrink-0"
                >
                  Carpeta
                </button>

                {!activeTab.isLocked && (fCell?.manualOverride || fCommentTxt || fCell?.autoRecalcNotice) && (
                  <button
                    type="button"
                    onClick={() => clearCell(st.id, folderEntry.folder.id)}
                    aria-label="Restituir y vaciar comentario"
                    className="w-9 h-9 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 flex items-center justify-center shrink-0"
                  >
                    <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          }

          const col = activeTab.columns.find((c) => c.id === selectedCoord.columnId);
          if (!col) return null;
          const cell = activeBook.cells[cellKey(st.id, col.id)];
          const commentTxt = cell?.comment?.trim() ?? '';
          const edMode = col.editorMode ?? 'STANDARD';
          const stepVal =
            typeof col.counterStep === 'number' && col.counterStep > 0 ? col.counterStep : 1;

          return (
            <div
              data-touch-action-bar="cell"
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                bottom: 'calc(0.75rem + var(--safe-bottom))',
                left: 'max(0.75rem, var(--safe-left))',
                maxWidth: 'calc(100dvw - 170px)',
              }}
              className="absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xs shadow-lg overflow-x-auto no-scrollbar text-xs font-semibold text-slate-700"
            >
              <button
                type="button"
                onClick={() => {
                  if (col.type === 'RUBRIC') onOpenRubricGrader(st, col);
                  else if (col.type === 'AVERAGE') onEditColumn(col);
                  else onOpenCellModal(st, col);
                }}
                className="min-h-[38px] px-3 rounded-xl bg-blue-600 text-white flex items-center gap-1.5 shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{col.type === 'RUBRIC' ? 'Rúbrica' : 'Editar'}</span>
              </button>

              {!activeTab.isLocked && !col.isLocked && col.type !== 'AVERAGE' && (
                <>
                  <button
                    type="button"
                    data-single-batch-adjust-btn="true"
                    onClick={openBatchAdjustForSelection}
                    title="Subir o bajar nota y añadir comentario"
                    className="min-h-[38px] px-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 flex items-center gap-1 shrink-0"
                  >
                    <ArrowDownUp className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>± Nota</span>
                  </button>
                  {canCellRestoreOriginalGrade(cell) && (
                    <button
                      type="button"
                      data-restore-original-grade-btn="true"
                      onClick={() =>
                        handleRestoreOriginalSelection([
                          { studentId: st.id, columnId: col.id },
                        ])
                      }
                      title="Restaurar nota original (sin subidas ni bajadas)"
                      className="min-h-[38px] px-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 flex items-center gap-1 shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Restaurar</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setTouchMultiSelect((v) => !v)}
                    aria-pressed={touchMultiSelect}
                    title="Activa para seleccionar varios alumnos tocando sus celdas"
                    className={`min-h-[38px] px-2.5 rounded-xl border shrink-0 ${
                      touchMultiSelect
                        ? 'bg-blue-600 border-blue-700 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700'
                    }`}
                  >
                    {touchMultiSelect ? 'Añadiendo ✓' : '+ Varias'}
                  </button>
                </>
              )}

              {col.type === 'RUBRIC' && !col.isLocked && !activeTab.isLocked && (
                <button
                  type="button"
                  onClick={() => onOpenCellModal(st, col)}
                  title="Cambiar manualmente la nota de la rúbrica"
                  className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 flex items-center gap-1 shrink-0"
                >
                  <span>Nota</span>
                </button>
              )}

              {isCellOutdatedForEducamos(col, st.id, cell) && (
                <button
                  type="button"
                  onClick={() => {
                    markCellEducamosUpdated(st.id, col.id);
                    showCopyToast('Celda marcada como actualizada en Educamos');
                  }}
                  title="Marcar esta celda como actualizada en Educamos"
                  className="min-h-[38px] px-2.5 rounded-xl border border-orange-300 bg-orange-50 text-orange-800 flex items-center gap-1 shrink-0"
                >
                  <Check className="w-3.5 h-3.5 text-orange-600" aria-hidden="true" />
                  <span>Educamos</span>
                </button>
              )}

              {col.type === 'NUMERIC' && edMode === 'COUNTER_POS' && !col.isLocked && !activeTab.isLocked && (
                <button
                  type="button"
                  onClick={() => stepCellByDelta(st.id, col, -stepVal)}
                  className="min-h-[38px] px-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-1 shrink-0"
                >
                  <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{stepVal}</span>
                </button>
              )}

              {col.type === 'NUMERIC' && edMode === 'COUNTER_NEG' && !col.isLocked && !activeTab.isLocked && (
                <button
                  type="button"
                  onClick={() => stepCellByDelta(st.id, col, stepVal)}
                  className="min-h-[38px] px-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{stepVal}</span>
                </button>
              )}

              {commentTxt && (
                <button
                  type="button"
                  onClick={() => {
                    const cellEl = wrapperRef.current?.querySelector(
                      `[data-cell="${cellKey(st.id, col.id)}"]`
                    ) as HTMLElement | null;
                    const r = cellEl?.getBoundingClientRect();
                    if (r) {
                      setCellTooltip((prev) =>
                        prev?.text === commentTxt
                          ? null
                          : {
                              text: commentTxt,
                              rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
                            }
                      );
                    }
                  }}
                  className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 flex items-center gap-1 shrink-0"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                  <span>Ver texto</span>
                </button>
              )}

              {col.type !== 'AVERAGE' && !col.isLocked && !activeTab.isLocked && (cell?.grade !== null || commentTxt) && (
                <button
                  type="button"
                  onClick={() => clearCell(st.id, col.id)}
                  aria-label="Vaciar celda"
                  className="w-9 h-9 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 flex items-center justify-center shrink-0"
                >
                  <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        }

        return null;
      })()}

      {/* Desktop quick action pill when one or more cells are selected */}
      {!device.isTouch &&
        !inlineEdit &&
        selectedKeys.size >= 1 &&
        (sameRubricColSelection || sameCriterionSelection || adjustableSelectionTargets.length > 0) && (
        <div
          data-desktop-multi-rubric-bar="true"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            bottom: 'calc(0.75rem + var(--safe-bottom))',
            left: 'max(0.75rem, var(--safe-left))',
          }}
          className="absolute z-30 flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xs shadow-lg text-xs font-semibold text-slate-700"
        >
          {sameRubricColSelection ? (
            <>
              <span className="font-bold text-slate-900 pr-1">
                {sameRubricColSelection.col.title} · {sameRubricColSelection.studentIds.length} alumnos
              </span>
              <button
                type="button"
                onClick={() =>
                  onOpenRubricGrader(null, sameRubricColSelection.col, {
                    groupName: `${sameRubricColSelection.studentIds.length} alumnos seleccionados`,
                    studentIds: sameRubricColSelection.studentIds,
                  })
                }
                className="px-3 py-1 rounded-xl bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Evaluar rúbrica ({sameRubricColSelection.studentIds.length})</span>
              </button>
              <button
                type="button"
                data-multi-batch-adjust-btn="true"
                onClick={openBatchAdjustForSelection}
                title="Subir o bajar nota y añadir comentario a las celdas seleccionadas"
                className="px-2.5 py-1 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 flex items-center gap-1 shrink-0 transition-colors"
              >
                <ArrowDownUp className="w-3.5 h-3.5" aria-hidden="true" />
                <span>± Nota</span>
              </button>
              {restorableSelectionTargets.length > 0 && (
                <button
                  type="button"
                  data-restore-original-grade-btn="true"
                  onClick={() => handleRestoreOriginalSelection(restorableSelectionTargets)}
                  title="Restaurar nota original (sin subidas ni bajadas)"
                  className="px-2.5 py-1 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 flex items-center gap-1 shrink-0 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Restaurar nota</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  clearMultipleCells(
                    sameRubricColSelection.studentIds.map((studentId) => ({
                      studentId,
                      columnId: sameRubricColSelection.col.id,
                    }))
                  );
                  showCopyToast(
                    `${sameRubricColSelection.studentIds.length} celdas de rúbrica borradas`
                  );
                }}
                className="px-2.5 py-1 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 flex items-center gap-1 shrink-0 transition-colors"
              >
                <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Borrar</span>
              </button>
            </>
          ) : sameCriterionSelection ? (
            <>
              <span className="font-bold text-slate-900 pr-1">
                C{sameCriterionSelection.critSlot.criterionIndex + 1} ·{' '}
                {sameCriterionSelection.studentIds.length} alumnos
              </span>
              <button
                type="button"
                onClick={() => {
                  const { critSlot, studentIds } = sameCriterionSelection;
                  const cellEl = getCellNode(studentIds[0], critSlot.key);
                  const rect = cellEl?.getBoundingClientRect() ?? { bottom: 200, left: 100 };
                  setCriterionPicker({
                    studentIds,
                    studentLabel: `${studentIds.length} alumnos seleccionados`,
                    col: critSlot.col,
                    rubric: critSlot.rubric,
                    criterion: critSlot.criterion,
                    criterionIndex: critSlot.criterionIndex,
                    currentLevelId: null,
                    top: Math.max(12, Math.min(window.innerHeight - 430, rect.bottom + 6)),
                    left: Math.max(12, Math.min(window.innerWidth - 320, rect.left)),
                  });
                }}
                className="px-3 py-1 rounded-xl bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Valorar criterio ({sameCriterionSelection.studentIds.length})</span>
              </button>
            </>
          ) : (
            <>
              <span className="font-bold text-slate-900 pr-1 truncate max-w-[170px]">
                {adjustableSelectionTargets.length === 1
                  ? (() => {
                      const t = adjustableSelectionTargets[0];
                      const st = visibleStudents.find((s) => s.id === t.studentId);
                      return st ? st.lastName : '1 sel.';
                    })()
                  : `${adjustableSelectionTargets.length} sel.`}
              </span>
              <button
                type="button"
                data-multi-batch-adjust-btn="true"
                onClick={openBatchAdjustForSelection}
                title="Subir o bajar nota y añadir comentario"
                className="px-2.5 py-1 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 flex items-center gap-1 shrink-0 transition-colors"
              >
                <ArrowDownUp className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {adjustableSelectionTargets.length === 1
                    ? '± Nota'
                    : `± Nota (${adjustableSelectionTargets.length})`}
                </span>
              </button>
              {restorableSelectionTargets.length > 0 && (
                <button
                  type="button"
                  data-restore-original-grade-btn="true"
                  onClick={() => handleRestoreOriginalSelection(restorableSelectionTargets)}
                  title="Restaurar nota original (sin subidas ni bajadas)"
                  className="px-2.5 py-1 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 flex items-center gap-1 shrink-0 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {restorableSelectionTargets.length === 1
                      ? 'Restaurar nota'
                      : `Restaurar (${restorableSelectionTargets.length})`}
                  </span>
                </button>
              )}
              {clearableTargets.length >= 1 &&
                clearableTargets.some(({ studentId, columnId }) =>
                  Boolean(activeBook.cells[cellKey(studentId, columnId)])
                ) && (
                <button
                  type="button"
                  onClick={() => {
                    clearMultipleCells(clearableTargets);
                    showCopyToast(
                      clearableTargets.length === 1
                        ? 'Celda borrada'
                        : `${clearableTargets.length} celdas borradas`
                    );
                  }}
                  className="px-2.5 py-1 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 flex items-center gap-1 shrink-0 transition-colors"
                >
                  <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Borrar</span>
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setSelectedKeys(new Set());
              setSelectedCoord(null);
              setAnchorCoord(null);
            }}
            aria-label="Quitar selección"
            className="p-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Desktop quick action pill when a column/task or folder header is selected */}
      {!device.isTouch && !inlineEdit && selectedColumnTarget && (() => {
        if (selectedColumnTarget.kind === 'COL') {
          const col = selectedColumnTarget.col;
          const canFillNP =
            col.type !== 'AVERAGE' && !col.isLocked && !activeTab.isLocked;
          const emptyNpCount = canFillNP
            ? countEmptyGradesInColumns(activeBook, [col.id])
            : 0;
          const colRubric =
            col.type === 'RUBRIC' && col.rubricId
              ? workspace.rubrics.find((r) => r.id === col.rubricId) ?? null
              : null;
          return (
            <div
              data-desktop-column-bar="column"
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                bottom: 'calc(0.75rem + var(--safe-bottom))',
                left: 'max(0.75rem, var(--safe-left))',
              }}
              className="absolute z-30 flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xs shadow-lg text-xs font-semibold text-slate-700"
            >
              <span className="font-bold text-slate-900 truncate max-w-[180px] pr-1">
                {col.title}
              </span>
              <button
                type="button"
                onClick={() => onEditColumn(col)}
                className="px-2.5 py-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 shrink-0 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Editar</span>
              </button>
              {col.type === 'RUBRIC' && colRubric && colRubric.criteria.length > 0 && (
                <button
                  type="button"
                  onClick={() => toggleColumnRubricExpanded(col.id)}
                  className={`px-2.5 py-1 rounded-xl border flex items-center gap-1 shrink-0 transition-colors ${
                    col.rubricExpanded
                      ? 'border-purple-700 bg-purple-600 hover:bg-purple-700 text-white'
                      : 'border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-900'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {col.rubricExpanded
                      ? 'Plegar criterios'
                      : `Subcolumnas (${colRubric.criteria.length})`}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => copyColumnAlphabetical({ kind: 'COL', col })}
                className="px-2.5 py-1 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center gap-1 shrink-0 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copiar</span>
              </button>
              {canFillNP && (
                <>
                  <button
                    type="button"
                    data-col-batch-adjust-btn="true"
                    disabled={visibleStudents.length === 0}
                    onClick={() =>
                      setBatchAdjustState({
                        title: 'Ajustar notas y comentar',
                        subtitle: `Columna: ${col.title} · ${visibleStudents.length} alumnos`,
                        targets: visibleStudents.map((s) => ({
                          studentId: s.id,
                          columnId: col.id,
                        })),
                      })
                    }
                    title="Subir o bajar nota y añadir comentario a toda la columna"
                    className="px-2.5 py-1 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 disabled:opacity-40 text-amber-900 flex items-center gap-1 shrink-0 transition-colors"
                  >
                    <ArrowDownUp className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>± Nota</span>
                  </button>
                  {visibleStudents.some((s) =>
                    canCellRestoreOriginalGrade(activeBook.cells[cellKey(s.id, col.id)])
                  ) && (
                    <button
                      type="button"
                      data-col-restore-original-btn="true"
                      onClick={() =>
                        handleRestoreOriginalSelection(
                          visibleStudents.map((s) => ({
                            studentId: s.id,
                            columnId: col.id,
                          }))
                        )
                      }
                      title="Restaura las notas originales de esta columna (sin subidas ni bajadas)"
                      className="px-2.5 py-1 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 flex items-center gap-1 shrink-0 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Restaurar notas</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={emptyNpCount === 0}
                    onClick={() => triggerFillEmptyWithNP([col.id], col.title)}
                    title="Rellena las celdas sin nota con 0 y el texto NP (las celdas que ya tienen nota no se modifican)"
                    className="px-2.5 py-1 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 text-indigo-900 flex items-center gap-1 shrink-0 transition-colors"
                  >
                    <FileX2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Rellenar vacías: 0 NP ({emptyNpCount})</span>
                  </button>
                </>
              )}
            </div>
          );
        }

        const { folder, childCols } = selectedColumnTarget;
        const editableFolderColIds = activeTab.isLocked
          ? []
          : childCols
              .filter((c) => c.type !== 'AVERAGE' && !c.isLocked)
              .map((c) => c.id);
        const emptyFolderNpCount =
          editableFolderColIds.length > 0
            ? countEmptyGradesInColumns(activeBook, editableFolderColIds)
            : 0;
        const folderOverrideStats = countFolderOverridesAndNotices(activeBook, folder.id);
        return (
          <div
            data-desktop-column-bar="folder"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              bottom: 'calc(0.75rem + var(--safe-bottom))',
              left: 'max(0.75rem, var(--safe-left))',
            }}
            className="absolute z-30 flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xs shadow-lg text-xs font-semibold text-slate-700"
          >
            <span className="font-bold text-slate-900 truncate max-w-[180px] pr-1">
              {folder.title}
            </span>
            <button
              type="button"
              onClick={() => onEditFolder(activeTab.id, folder)}
              className="px-2.5 py-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 shrink-0 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Carpeta</span>
            </button>
            <button
              type="button"
              onClick={() => toggleFolderCollapse(activeTab.id, folder.id)}
              className="px-2.5 py-1 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 shrink-0 transition-colors"
            >
              {folder.isCollapsed ? 'Desplegar' : 'Plegar'}
            </button>
            <button
              type="button"
              onClick={() => copyColumnAlphabetical({ kind: 'FOLDER', folder, childCols })}
              className="px-2.5 py-1 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center gap-1 shrink-0 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Copiar</span>
            </button>
            {editableFolderColIds.length > 0 && (
              <button
                type="button"
                disabled={emptyFolderNpCount === 0}
                onClick={() => triggerFillEmptyWithNP(editableFolderColIds, folder.title)}
                title="Rellena con 0 y NP las celdas sin nota de las tareas de esta carpeta"
                className="px-2.5 py-1 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 text-indigo-900 flex items-center gap-1 shrink-0 transition-colors"
              >
                <FileX2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Rellenar vacías: 0 NP ({emptyFolderNpCount})</span>
              </button>
            )}
            {!activeTab.isLocked && (
              <button
                type="button"
                disabled={folderOverrideStats.totalCount === 0}
                onClick={() => {
                  const count = restoreFolderCalculation(folder.id);
                  if (count > 0) {
                    showCopyToast(
                      `Cálculo restituido en ${count} ${count === 1 ? 'celda' : 'celdas'} de «${folder.title}»`
                    );
                  }
                }}
                title="Restituye el cálculo automático en todas las celdas de esta carpeta editadas manualmente o con aviso"
                className="px-2.5 py-1 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 disabled:opacity-40 text-amber-900 flex items-center gap-1 shrink-0 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Restituir cálculo ({folderOverrideStats.totalCount})</span>
              </button>
            )}
          </div>
        );
      })()}

      {/* Desktop quick action pill when a single folder cell has manual override or auto-recalc notice */}
      {!device.isTouch && !inlineEdit && selectedCoord && selectedKeys.size <= 1 && (() => {
        const st = visibleStudents.find((s) => s.id === selectedCoord.studentId);
        const folderEntry = folderSlotById.get(selectedCoord.columnId);
        if (!st || !folderEntry) return null;
        const fCell = activeBook.cells[cellKey(st.id, folderEntry.folder.id)];
        if (!fCell?.manualOverride && !fCell?.autoRecalcNotice) return null;
        const formulaVal = computeFolderFormulaValue(
          folderEntry.folder,
          folderEntry.childCols,
          st.id,
          activeBook
        );
        const formulaLabel = formulaVal !== null ? formatGrade(formulaVal, 2) : '—';
        return (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              bottom:
                adjustableSelectionTargets.length > 0
                  ? 'calc(3.75rem + var(--safe-bottom))'
                  : 'calc(0.75rem + var(--safe-bottom))',
              left: 'max(0.75rem, var(--safe-left))',
            }}
            className={`absolute z-30 flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-2xl border backdrop-blur-xs shadow-lg text-xs ${
              fCell.manualOverride
                ? 'border-amber-200 bg-amber-50/95 text-amber-950'
                : 'border-indigo-200 bg-indigo-50/95 text-indigo-950'
            }`}
          >
            <span className="font-medium truncate max-w-[260px]">
              <strong className="font-semibold">{st.lastName}:</strong>{' '}
              {fCell.manualOverride ? (
                <>
                  nota manual · calculada:{' '}
                  <span className="font-bold tabular-nums">{formulaLabel}</span>
                </>
              ) : (
                <>recalculada automáticamente ({formulaLabel})</>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                restoreFolderCellCalculation(st.id, folderEntry.folder.id);
                showCopyToast(
                  fCell.manualOverride
                    ? 'Cálculo automático restituido en la celda'
                    : 'Aviso de recálculo ocultado'
                );
              }}
              className={`px-2.5 py-1 rounded-xl text-white font-semibold flex items-center gap-1 shrink-0 transition-colors ${
                fCell.manualOverride
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{fCell.manualOverride ? 'Restituir cálculo' : 'Quitar aviso'}</span>
            </button>
          </div>
        );
      })()}

      {/* Desktop quick Educamos action pill when a single outdated cell is selected */}
      {!device.isTouch && !inlineEdit && selectedCoord && selectedKeys.size <= 1 && (() => {
        const st = visibleStudents.find((s) => s.id === selectedCoord.studentId);
        const col = activeTab.columns.find((c) => c.id === selectedCoord.columnId);
        if (!st || !col) return null;
        const cell = activeBook.cells[cellKey(st.id, col.id)];
        if (!isCellOutdatedForEducamos(col, st.id, cell)) return null;
        const prev = getEducamosSnappedGrade(col, st.id);
        const prevLabel = prev !== null ? formatGrade(prev, col.decimals) : '—';
        return (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              bottom:
                adjustableSelectionTargets.length > 0
                  ? 'calc(3.75rem + var(--safe-bottom))'
                  : 'calc(0.75rem + var(--safe-bottom))',
              left: 'max(0.75rem, var(--safe-left))',
            }}
            className="absolute z-30 flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-2xl border border-orange-200 bg-orange-50/95 backdrop-blur-xs shadow-lg text-xs text-orange-950"
          >
            <span className="font-medium truncate max-w-[230px]">
              <strong className="font-semibold">{st.lastName}:</strong> en Educamos era{' '}
              <span className="font-bold tabular-nums">{prevLabel}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                markCellEducamosUpdated(st.id, col.id);
                showCopyToast('Celda marcada como actualizada en Educamos');
              }}
              className="px-2.5 py-1 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold flex items-center gap-1 shrink-0 transition-colors"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Actualizar celda</span>
            </button>
          </div>
        );
      })()}

      {/* Floating iDoceo-style Zoom Controls (affects ONLY the gradebook grid) */}
      <div
        style={{
          bottom: 'calc(0.75rem + var(--safe-bottom))',
          right: 'max(1rem, var(--safe-right))',
        }}
        className="absolute z-30"
      >
        <GradebookZoomBar
          ref={zoomBarRef}
          zoom={gridZoom}
          min={0.5}
          max={1.8}
          onChangeZoom={commitSteppedZoom}
        />
      </div>
      </div>

      {/* Copy confirmation toast */}
      {copyToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-16 right-5 z-50 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold shadow-lg pointer-events-none"
        >
          {copyToast}
        </div>
      )}

      {/* iDoceo-style LOMLOE Criteria Picker Popover */}
      {lomloePicker && (() => {
        const targetCol = activeTab.columns.find((c) => c.id === lomloePicker.colId);
        if (!targetCol) return null;
        return (
          <LomloeCriteriaPickerPopover
            column={targetCol}
            curriculum={activeCurriculum}
            keyCompetences={keyCompetencesCatalog}
            anchorRect={lomloePicker.rect}
            clipboardCriteriaIds={copiedLomloeCriteria}
            onChangeCriteria={(ids) => setColumnLomloeCriteria(targetCol.id, ids)}
            onCopyCriteria={(ids) => setCopiedLomloeCriteria([...ids])}
            onOpenLomloeManager={() => onOpenLomloeManager?.()}
            onClose={() => setLomloePicker(null)}
          />
        );
      })()}

      {/* Educamos column status & individual cell sync popover */}
      {educamosMenu && (() => {
        const targetCol = activeTab.columns.find((c) => c.id === educamosMenu.colId);
        if (!targetCol) return null;
        const summary = getColumnEducamosSummary(
          targetCol,
          activeBook.students,
          activeBook.cells
        );
        const sortedDirty = [...summary.dirtyStudents].sort(
          (a, b) =>
            a.student.lastName.localeCompare(b.student.lastName, 'es') ||
            a.student.firstName.localeCompare(b.student.firstName, 'es')
        );
        const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
        const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
        const cardWidth = Math.min(312, viewportW - 16);
        const left = Math.min(Math.max(8, educamosMenu.rect.left), viewportW - cardWidth - 8);
        const spaceBelow = viewportH - educamosMenu.rect.bottom - 12;
        const spaceAbove = educamosMenu.rect.top - 12;
        const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
        const maxHeight = Math.max(180, openAbove ? spaceAbove : spaceBelow);

        return createPortal(
          <div
            data-educamos-menu="true"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left,
              width: cardWidth,
              top: openAbove ? undefined : Math.min(educamosMenu.rect.bottom + 6, viewportH - 24),
              bottom: openAbove ? viewportH - educamosMenu.rect.top + 6 : undefined,
              maxHeight,
              zIndex: 80,
            }}
            className="rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden text-xs"
          >
            <div className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/90 flex items-center justify-between gap-2 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-slate-900">Educamos</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      summary.state === 'SYNCED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : summary.state === 'OUTDATED'
                          ? 'bg-orange-100 text-orange-800'
                          : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {summary.state === 'SYNCED'
                      ? 'Pasada'
                      : summary.state === 'OUTDATED'
                        ? `${summary.dirtyCount} ${summary.dirtyCount === 1 ? 'cambio' : 'cambios'}`
                        : 'Pendiente'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 truncate">{targetCol.title}</div>
              </div>
              <button
                type="button"
                onClick={() => setEducamosMenu(null)}
                aria-label="Cerrar menú Educamos"
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 flex items-center justify-center shrink-0"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="p-3 space-y-2.5 overflow-y-auto">
              {summary.state === 'PENDING' && (
                <button
                  type="button"
                  onClick={() => {
                    setColumnEducamosStatus(targetCol.id, 'DONE');
                    setEducamosMenu(null);
                    showCopyToast('Columna marcada como pasada a Educamos');
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Check className="w-4 h-4" aria-hidden="true" />
                  <span>Marcar columna como pasada</span>
                </button>
              )}

              {summary.state === 'SYNCED' && (
                <button
                  type="button"
                  onClick={() => {
                    setColumnEducamosStatus(targetCol.id, 'PENDING');
                    setEducamosMenu(null);
                    showCopyToast('Columna marcada como no pasada a Educamos');
                  }}
                  className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold transition-colors"
                >
                  Quitar marca de pasada (Pendiente)
                </button>
              )}

              {summary.state === 'OUTDATED' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setColumnEducamosStatus(targetCol.id, 'DONE');
                      setEducamosMenu(null);
                      showCopyToast('Columna marcada como actualizada en Educamos');
                    }}
                    className="w-full py-2 px-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Check className="w-4 h-4" aria-hidden="true" />
                    <span>Marcar toda la columna actualizada</span>
                  </button>

                  <div className="space-y-1.5 pt-1">
                    <div className="text-[11px] font-semibold text-slate-500">
                      Celdas modificadas desde el último paso ({sortedDirty.length}):
                    </div>
                    <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
                      {sortedDirty.map(({ student: dirtyStudent, previousGrade, currentGrade }) => {
                        const prevStr =
                          previousGrade !== null ? formatGrade(previousGrade, targetCol.decimals) : '—';
                        const currStr =
                          currentGrade !== null ? formatGrade(currentGrade, targetCol.decimals) : '—';
                        return (
                          <div
                            key={dirtyStudent.id}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border border-orange-200/80 bg-orange-50/70"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 truncate">
                                {dirtyStudent.lastName}, {dirtyStudent.firstName}
                              </div>
                              <div className="text-[11px] text-orange-800 tabular-nums">
                                {prevStr} → <span className="font-bold">{currStr}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                markCellEducamosUpdated(dirtyStudent.id, targetCol.id);
                                showCopyToast(`${dirtyStudent.lastName} actualizado en Educamos`);
                              }}
                              title="Marcar esta celda como actualizada en Educamos"
                              className="shrink-0 px-2 py-1 rounded-lg bg-white border border-orange-300 hover:bg-orange-600 hover:text-white hover:border-orange-600 text-orange-800 font-semibold flex items-center gap-1 transition-colors"
                            >
                              <Check className="w-3 h-3" aria-hidden="true" />
                              <span>Actualizar</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setColumnEducamosStatus(targetCol.id, 'PENDING');
                      setEducamosMenu(null);
                      showCopyToast('Columna marcada como no pasada a Educamos');
                    }}
                    className="w-full py-1.5 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
                  >
                    Marcar columna como no pasada
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body
        );
      })()}

      {/* Expanded Inline Cell Editor Portal (shows 100% of text + real cursor navigation across all text) */}
      {inlineEdit && inlineEditRect && (() => {
        const targetInfo = resolveEditableTarget(inlineEdit.columnId);
        if (!targetInfo) return null;
        const col = targetInfo.col;
        const liveSplit = parseLiveMixedInput(inlineEdit.draft);
        const editorWidth = Math.max(
          inlineEditRect.width + 6,
          Math.min(340, window.innerWidth - 24)
        );
        const left = Math.max(
          12,
          Math.min(window.innerWidth - editorWidth - 12, inlineEditRect.left - 3)
        );
        const top = Math.max(
          12,
          Math.min(window.innerHeight - 150, inlineEditRect.top - 3)
        );

        const badgeGrade =
          inlineEdit.preserveRubricGrade && !liveSplit.gradeText
            ? inlineEdit.initialGrade !== null && inlineEdit.initialGrade !== undefined
              ? `${formatGrade(inlineEdit.initialGrade, col.decimals)} (${
                  targetInfo.isFolder ? 'carpeta' : 'rúbrica'
                })`
              : ''
            : liveSplit.gradeText ||
              (inlineEdit.mode === 'TYPE_OVER' &&
              inlineEdit.initialGrade !== null &&
              inlineEdit.initialGrade !== undefined
                ? formatGrade(inlineEdit.initialGrade, col.decimals)
                : '');

        return createPortal(
          <div
            data-inline-cell-editor="true"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).tagName !== 'TEXTAREA') {
                e.preventDefault();
              }
            }}
            style={{
              position: 'fixed',
              top,
              left,
              width: editorWidth,
              zIndex: 90,
            }}
            className="rounded-xl border-2 border-blue-600 bg-white shadow-2xl p-1.5 space-y-1"
          >
            <div className="flex items-center justify-between gap-2 px-1 text-[10px] font-semibold text-slate-500">
              <span className="truncate">
                {inlineEdit.applyToSelection
                  ? `${editableNumericTargets.length} celdas`
                  : col.title}
              </span>
              {badgeGrade && (
                <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold tabular-nums shrink-0">
                  Nota: {badgeGrade}
                </span>
              )}
            </div>

            <textarea
              ref={inlineInputRef}
              rows={1}
              aria-label={
                inlineEdit.applyToSelection
                  ? `Editar nota para ${editableNumericTargets.length} celdas`
                  : 'Editar nota y comentario'
              }
              value={inlineEdit.draft}
              onChange={(e) =>
                setInlineEdit((prev) =>
                  prev ? { ...prev, draft: e.target.value } : null
                )
              }
              onBlur={() => {
                if (skipNextBlurRef.current) {
                  skipNextBlurRef.current = false;
                  return;
                }
                commitInlineEdit('STAY');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const isMod = e.metaKey || e.ctrlKey;
                  if (e.shiftKey && isMod) {
                    commitInlineEdit('RIGHT');
                  } else if (e.shiftKey) {
                    commitInlineEdit('DOWN');
                  } else {
                    commitInlineEdit('STAY');
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelInlineEdit();
                } else if (e.key === 'Tab') {
                  e.preventDefault();
                  e.stopPropagation();
                  commitInlineEdit('RIGHT');
                }
              }}
              className="w-full min-h-[38px] max-h-[200px] overflow-y-auto resize-none rounded-lg border border-slate-200 bg-slate-50/60 focus:bg-white px-2 py-1.5 text-sm font-medium text-slate-900 leading-snug focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>,
          document.body
        );
      })()}

      {/* 0.6s Interest-Triggered Full Comment Tooltip */}
      {cellTooltip &&
        createPortal(
          <div
            role="tooltip"
            data-cell-comment-tooltip="true"
            style={{
              position: 'fixed',
              left: Math.min(window.innerWidth - 316, Math.max(12, cellTooltip.rect.left)),
              top:
                cellTooltip.rect.bottom + 96 < window.innerHeight
                  ? cellTooltip.rect.bottom + 6
                  : Math.max(12, cellTooltip.rect.top - 8),
              transform:
                cellTooltip.rect.bottom + 96 < window.innerHeight
                  ? undefined
                  : 'translateY(-100%)',
              zIndex: 95,
            }}
            className="max-w-[300px] px-3 py-2 rounded-xl bg-slate-900/95 text-white text-xs font-medium shadow-xl border border-slate-700/80 whitespace-pre-wrap break-normal leading-snug pointer-events-none"
          >
            {cellTooltip.text}
          </div>,
          document.body
        )}

      <BatchAdjustGradeModal
        targetState={batchAdjustState}
        book={activeBook}
        columns={visibleColumns}
        onClose={() => setBatchAdjustState(null)}
        onApply={(entries) => {
          applyCellsBatch(entries);
          const pendingCnt = entries.filter((e) => e.grade === null && e.pendingAdjustment).length;
          showCopyToast(
            pendingCnt > 0
              ? `${entries.length} celdas actualizadas (${pendingCnt} con ajuste pendiente)`
              : entries.length === 1
                ? '1 celda actualizada'
                : `${entries.length} celdas actualizadas`
          );
        }}
        onRestoreOriginal={(targets) => handleRestoreOriginalSelection(targets)}
      />
    </div>
  );
};
