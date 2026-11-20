import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  BarChart3,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  Copy,
  Eraser,
  FolderOutput,
  FolderPlus,
  GripVertical,
  Hexagon,
  Layers,
  LayoutGrid,
  Lock,
  MoreVertical,
  Pencil,
  Plus,
  Sigma,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  blendWithWhite,
  getAvatarBg,
  getGroupDefaultColor,
  getInitials,
  PASTEL_SWATCHES,
} from '../../constants/colors';
import { DEFAULT_LOMLOE_KEY_COMPETENCES } from '../../data/lomloeReligion';
import { useGradebook } from '../../context/GradebookContext';
import {
  buildAlphabeticalColumnCopyText,
  clampGradeForColumn,
  COLUMN_SUMMARY_OPTIONS,
  computeColumnSummaryMetric,
  computeFolderSummary,
  ensureGroupCategories,
  formatCellCopyValue,
  formatCellDisplayGrade,
  formatGrade,
  getEffectiveBookGroups,
  getStudentActiveGroup,
  organizeStudentsForGrid,
  parseLiveMixedInput,
  parseMixedInput,
  resolveCellColors,
  shouldRenderVerticalHeader,
} from '../../engine/gradeMath';
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
  type StudentEntity,
} from '../../types/gradebook';
import { clampZoom, usePinchZoom, ZoomControls } from '../common/ZoomControls';
import { LomloeCompetenceBadge } from '../lomloe/LomloeCompetenceBadge';
import { LomloeCriteriaPickerPopover } from '../lomloe/LomloeCriteriaPickerPopover';

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
  onOpenRubricGrader: (student: StudentEntity, col: ColumnEntity) => void;
  onOpenLomloeManager?: () => void;
}

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
      kind: 'FOLDER_SUMMARY';
      key: string;
      folder: FolderEntity;
      childCols: ColumnEntity[];
      width: number;
      isOpen: boolean;
    };

type Row1HeaderItem =
  | { kind: 'COL'; col: ColumnEntity }
  | { kind: 'FOLDER_CLOSED'; folder: FolderEntity; childCols: ColumnEntity[] }
  | { kind: 'FOLDER_OPEN'; folder: FolderEntity; childCols: ColumnEntity[] };

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
  const {
    workspace,
    activeBook,
    activeTab,
    updateBook,
    updateSettings,
    resizeColumn,
    resizeFolder,
    moveItemInActiveTab,
    addFolder,
    toggleFolderCollapse,
    setColumnLomloeCriteria,
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
    assignStudentsToGroup,
    toggleGroupCollapsed,
    setCellData,
    setMultipleCellsData,
    applyCellsBatch,
    clearCell,
    clearMultipleCells,
    undo,
  } = useGradebook();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
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
  const [selectedColumnTarget, setSelectedColumnTarget] = useState<SelectedColumnTarget | null>(null);
  const [batchDraft, setBatchDraft] = useState('');
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
  } | null>(null);

  const [showAddColMenu, setShowAddColMenu] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState<{ top: number; left: number }>({ top: 120, left: 200 });
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showBatchGroupMenu, setShowBatchGroupMenu] = useState(false);
  const [batchNewGroupDraft, setBatchNewGroupDraft] = useState('');
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
  const [groupColAction, setGroupColAction] = useState<{
    bucketKey: string;
    bucketName: string;
    studentIds: string[];
    slot:
      | { kind: 'COL'; col: ColumnEntity }
      | { kind: 'FOLDER'; folder: FolderEntity; childCols: ColumnEntity[] };
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
  const [copiedLomloeCriteria, setCopiedLomloeCriteria] = useState<string[]>([]);

  const gridZoom = workspace.settings.gridZoom ?? 1;
  usePinchZoom(
    wrapperRef,
    gridZoom,
    (next) => updateSettings({ gridZoom: next }),
    { min: 0.5, max: 1.8 }
  );

  // Close menus on outside click
  useEffect(() => {
    const close = () => {
      setShowAddColMenu(false);
      setShowSortMenu(false);
      setShowCategoryMenu(false);
      setShowBatchGroupMenu(false);
      setShowAddSummaryMenu(false);
      setAddGroupSummaryMenu(null);
      setSummaryCellPicker(null);
      setGroupColAction(null);
      setSelectedGroupColCell(null);
      setLomloePicker(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  // Clear selection/edit when switching class or tab
  useEffect(() => {
    setSelectedCoord(null);
    setAnchorCoord(null);
    setSelectedKeys(new Set());
    setSelectedColumnTarget(null);
    setSelectedGroupColCell(null);
    setBatchDraft('');
    setInlineEdit(null);
    setLomloePicker(null);
  }, [activeBook?.id, activeTab?.id]);

  // Synchronous focus on mount so fast keystrokes immediately enter the inline input
  useLayoutEffect(() => {
    if (!inlineEdit) return;
    const el = inlineInputRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      // ignore
    }
  }, [inlineEdit?.studentId, inlineEdit?.columnId]);

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

  // Build iDoceo-style continuous horizontal slots + Row 1/Row 2 header topology
  const { visibleColumns, displaySlots, row1Headers, row2Slots } = useMemo(() => {
    if (!activeTab) {
      return {
        visibleColumns: [] as ColumnEntity[],
        displaySlots: [] as DisplaySlot[],
        row1Headers: [] as Row1HeaderItem[],
        row2Slots: [] as DisplaySlot[],
      };
    }

    const topItems = getTabDisplayOrder(activeTab);
    const visCols: ColumnEntity[] = [];
    const slots: DisplaySlot[] = [];
    const r1: Row1HeaderItem[] = [];
    const r2: DisplaySlot[] = [];

    for (const item of topItems) {
      if (item.kind === 'COL') {
        visCols.push(item.col);
        slots.push({
          kind: 'COL',
          key: item.col.id,
          col: item.col,
          width: item.col.width,
          isChild: false,
        });
        r1.push({ kind: 'COL', col: item.col });
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
        r1.push({ kind: 'FOLDER_OPEN', folder, childCols });
        r2.push(sumSlot);

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
        }
      }
    }

    return { visibleColumns: visCols, displaySlots: slots, row1Headers: r1, row2Slots: r2 };
  }, [activeTab]);

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

  const canTypeInline = useCallback(
    (col: ColumnEntity) =>
      Boolean(!activeTab?.isLocked && !col.isLocked && (col.type === 'NUMERIC' || col.type === 'RUBRIC')),
    [activeTab?.isLocked]
  );

  // Resolve active visible selected cells from selectedKeys
  const selectedTargets = useMemo(() => {
    const visStSet = new Set(visibleStudents.map((s) => s.id));
    const visColMap = new Map(visibleColumns.map((c) => [c.id, c]));
    const list: Array<{ studentId: string; columnId: string; col: ColumnEntity }> = [];
    for (const key of selectedKeys) {
      const sep = key.indexOf('::');
      if (sep < 0) continue;
      const studentId = key.slice(0, sep);
      const columnId = key.slice(sep + 2);
      const col = visColMap.get(columnId);
      if (col && visStSet.has(studentId)) {
        list.push({ studentId, columnId, col });
      }
    }
    return list;
  }, [selectedKeys, visibleStudents, visibleColumns]);

  const editableNumericTargets = useMemo(
    () =>
      activeTab?.isLocked
        ? []
        : selectedTargets
            .filter((t) => !t.col.isLocked && (t.col.type === 'NUMERIC' || t.col.type === 'RUBRIC'))
            .map(({ studentId, columnId }) => ({ studentId, columnId })),
    [activeTab?.isLocked, selectedTargets]
  );

  const clearableTargets = useMemo(
    () =>
      activeTab?.isLocked
        ? []
        : selectedTargets
            .filter((t) => !t.col.isLocked && t.col.type !== 'AVERAGE')
            .map(({ studentId, columnId }) => ({ studentId, columnId })),
    [activeTab?.isLocked, selectedTargets]
  );

  const slotIdsInOrder = useMemo(
    () => displaySlots.map((s) => (s.kind === 'FOLDER_SUMMARY' ? s.key : s.col.id)),
    [displaySlots]
  );

  const selectSingleCell = useCallback((studentId: string, columnId: string) => {
    const k = cellKey(studentId, columnId);
    setSelectedColumnTarget(null);
    setSelectedGroupColCell(null);
    setSelectedCoord({ studentId, columnId });
    setAnchorCoord({ studentId, columnId });
    setSelectedKeys(new Set([k]));
  }, []);

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
      setSelectedColumnTarget(null);
      setSelectedGroupColCell(null);
      setAnchorCoord(anchor);
      setSelectedCoord(target);
      setSelectedKeys(next);
    },
    [visibleStudents, slotIdsInOrder, selectedKeys]
  );

  // Clicking a column or folder header selects ONLY the header itself (no body cells highlighted)
  const selectEntireColumn = useCallback((col: ColumnEntity) => {
    setSelectedColumnTarget({ kind: 'COL', col });
    setSelectedGroupColCell(null);
    setSelectedKeys(new Set());
    setSelectedCoord(null);
    setAnchorCoord(null);
    wrapperRef.current?.focus({ preventScroll: true });
  }, []);

  const selectFolderSummaryColumn = useCallback(
    (folder: FolderEntity, childCols: ColumnEntity[]) => {
      setSelectedColumnTarget({ kind: 'FOLDER', folder, childCols });
      setSelectedGroupColCell(null);
      setSelectedKeys(new Set());
      setSelectedCoord(null);
      setAnchorCoord(null);
      wrapperRef.current?.focus({ preventScroll: true });
    },
    []
  );

  const selectEntireStudentRow = useCallback(
    (studentId: string) => {
      const next = new Set<string>();
      for (const col of visibleColumns) {
        next.add(cellKey(studentId, col.id));
      }
      setSelectedColumnTarget(null);
      setSelectedGroupColCell(null);
      setSelectedKeys(next);
      if (visibleColumns.length > 0) {
        const first = { studentId, columnId: visibleColumns[0].id };
        setSelectedCoord(first);
        setAnchorCoord(first);
      }
    },
    [visibleColumns]
  );

  const clearAllSelection = useCallback(() => {
    setSelectedCoord(null);
    setAnchorCoord(null);
    setSelectedKeys(new Set());
    setSelectedColumnTarget(null);
    setSelectedGroupColCell(null);
    setBatchDraft('');
  }, []);

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    if (copyToastTimerRef.current) window.clearTimeout(copyToastTimerRef.current);
    copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 2400);
  }, []);

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
      slotMap.set(slot.kind === 'FOLDER_SUMMARY' ? slot.key : slot.col.id, { idx, slot });
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
  }, [activeBook, selectedColumnTarget, selectedKeys, selectedCoord, visibleStudents, displaySlots]);

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
        startCol = visibleColumns.findIndex((c) => c.id === selectedCoord.columnId);
      }
      if (selectedTargets.length > 1) {
        const rIdxs = selectedTargets
          .map((t) => visibleStudents.findIndex((s) => s.id === t.studentId))
          .filter((i) => i >= 0);
        const cIdxs = selectedTargets
          .map((t) => visibleColumns.findIndex((c) => c.id === t.columnId))
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
          const col = visibleColumns[startCol + dc];
          if (!col) break;
          if (!canTypeInline(col)) continue;
          const parsed = parseMixedInput(matrix[dr][dc]);
          entries.push({
            studentId: st.id,
            columnId: col.id,
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
      visibleColumns,
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
      const col = visibleColumns.find((c) => c.id === columnId);
      if (!col || !canTypeInline(col)) return;

      const existing = activeBook.cells[cellKey(studentId, columnId)];
      const initialGrade = existing?.grade ?? null;
      const initialComment = existing?.comment ?? null;

      let baseDraft = '';
      let mode: 'TYPE_OVER' | 'FULL_EDIT' = 'TYPE_OVER';

      if (initialChar !== null) {
        baseDraft = initialChar;
        mode = 'TYPE_OVER';
      } else if (!applyToSelection && existing) {
        mode = 'FULL_EDIT';
        const numPart =
          existing.grade !== null && existing.grade !== undefined
            ? String(existing.grade)
            : '';
        baseDraft = [numPart, existing.comment].filter(Boolean).join(' ');
      }

      skipNextBlurRef.current = false;
      if (!applyToSelection) {
        selectSingleCell(studentId, columnId);
      } else {
        setSelectedCoord({ studentId, columnId });
      }
      setInlineEdit({
        studentId,
        columnId,
        draft: baseDraft,
        applyToSelection,
        initialGrade,
        initialComment,
        mode,
      });
      ensureCellVisible(studentId, columnId, 'auto');
    },
    [activeBook, visibleColumns, canTypeInline, selectSingleCell, ensureCellVisible]
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
      if (startInlineAfter && nextSlot.kind === 'COL' && canTypeInline(nextSlot.col)) {
        startInlineEditForCell(nextSt.id, nextSlot.col.id, null, false);
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
      canTypeInline,
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
      } = inlineEdit;
      const col = visibleColumns.find((c) => c.id === columnId);

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
      setCellData(studentId, columnId, clamped, finalComment);
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
      visibleColumns,
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
          updateSettings({ gridZoom: clampZoom(gridZoom + 0.1, 0.5, 1.8) });
          return;
        }
        if (e.key === '-') {
          e.preventDefault();
          updateSettings({ gridZoom: clampZoom(gridZoom - 0.1, 0.5, 1.8) });
          return;
        }
        if (e.key === '0') {
          e.preventDefault();
          updateSettings({ gridZoom: 1 });
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
        e.preventDefault();
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
          startInlineEditForCell(studentId, columnId, null, false);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (clearableTargets.length > 1) {
          e.preventDefault();
          clearMultipleCells(clearableTargets);
        } else if (clearableTargets.length === 1) {
          e.preventDefault();
          clearCell(clearableTargets[0].studentId, clearableTargets[0].columnId);
        } else {
          const col = visibleColumns.find((c) => c.id === columnId);
          if (col && canTypeInline(col)) {
            e.preventDefault();
            clearCell(studentId, columnId);
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setLomloePicker(null);
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
        const col = visibleColumns.find((c) => c.id === columnId);
        if (col && canTypeInline(col)) {
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
    selectedTargets.length,
    editableNumericTargets,
    clearableTargets,
    visibleStudents,
    visibleColumns,
    slotIdsInOrder,
    canTypeInline,
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
    updateSettings,
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

  const baseGradeFs = workspace.settings.gradeFontSize ?? 15;
  const baseTextFs = workspace.settings.textFontSize ?? 13.5;
  const baseIconSz = workspace.settings.iconSize ?? 15;

  // Individual column width resize (does NOT touch other columns; never triggers click/modal on release)
  const startColumnResize = (e: React.PointerEvent, col: ColumnEntity) => {
    e.preventDefault();
    e.stopPropagation();
    justResizedRef.current = true;
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

  // Student row height resize by dragging the bottom border of any student row
  const startRowHeightResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    justResizedRef.current = true;
    const startY = e.clientY;
    const startH = workspace.settings.rowHeight;

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) > 2) {
        prevAutoFitSizesRef.current.delete('rowHeight');
      }
      const clamped = Math.max(
        34,
        Math.min(140, Math.round(startH + (ev.clientY - startY) / gridZoom))
      );
      updateSettings({ rowHeight: clamped });
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

  const toggleAutoFitRowHeight = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeBook) return;
    const currentH = workspace.settings.rowHeight;
    const saved = prevAutoFitSizesRef.current.get('rowHeight');
    if (saved && Math.abs(currentH - saved.fitted) <= 2) {
      prevAutoFitSizesRef.current.delete('rowHeight');
      updateSettings({ rowHeight: saved.prev });
      return;
    }

    let hasGradeAndComment = false;
    let hasGroupBadge = false;
    for (const st of visibleStudents) {
      if (!activeBook.groupByGroups && getStudentActiveGroup(st, activeBook)) {
        hasGroupBadge = true;
      }
      for (const col of visibleColumns) {
        const cell = activeBook.cells[cellKey(st.id, col.id)];
        if (cell?.grade !== null && cell?.grade !== undefined && cell?.comment?.trim()) {
          hasGradeAndComment = true;
          break;
        }
      }
      if (hasGradeAndComment) break;
    }

    const gradeCommentNeed = hasGradeAndComment
      ? Math.ceil(baseGradeFs * 1.25 + baseTextFs * 0.85 * 1.25 + 14)
      : Math.ceil(baseGradeFs * 1.35 + 16);
    const studentNeed = hasGroupBadge
      ? Math.ceil(baseTextFs * 2.3 + 16)
      : Math.ceil(baseTextFs * 1.6 + 18);
    const fitted = Math.max(38, Math.min(120, Math.max(gradeCommentNeed, studentNeed)));

    prevAutoFitSizesRef.current.set('rowHeight', { prev: currentH, fitted });
    updateSettings({ rowHeight: fitted });
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

  const studentColW = Math.round(workspace.settings.studentColWidth * gridZoom);
  const rowH = Math.round(workspace.settings.rowHeight * gridZoom);
  const headerH = Math.round(workspace.settings.headerHeight * gridZoom);
  const canopyH = Math.max(26, Math.round(30 * gridZoom));
  const activeCurriculum = resolveBookCurriculum(activeBook, workspace.lomloeCurricula);
  const keyCompetencesCatalog =
    workspace.lomloeKeyCompetences && workspace.lomloeKeyCompetences.length > 0
      ? workspace.lomloeKeyCompetences
      : DEFAULT_LOMLOE_KEY_COMPETENCES;
  const showLomloeBar =
    Boolean(activeCurriculum) && isLomloeRowVisible(activeBook, workspace.settings);
  const lomloeRowH = Math.max(46, Math.round(60 * gridZoom));
  const addColW = Math.round(86 * gridZoom);
  const groupRowH = Math.max(28, Math.round(34 * gridZoom));
  const groupSpacerRows = activeBook.groupSpacerRows ?? 1;
  const groupSpacerH = Math.max(10, Math.round((workspace.settings.groupSpacerHeight ?? 24) * gridZoom));
  const summaryRowH = Math.max(24, Math.round((workspace.settings.summaryRowHeight ?? 32) * gridZoom));
  const summaryRows: ColumnSummaryMetric[] = activeBook.summaryRows ?? ['MEAN', 'PASS_PCT'];
  const groupSummaryRows: ColumnSummaryMetric[] = activeBook.groupSummaryRows ?? ['MEAN'];
  const scaledSlotsWidth = displaySlots.reduce(
    (sum, s) => sum + Math.round(s.width * gridZoom),
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
  const barEditableTargets =
    selectedColumnTarget?.kind === 'COL' && canTypeInline(selectedColumnTarget.col)
      ? visibleStudents.map((s) => ({
          studentId: s.id,
          columnId: selectedColumnTarget.col.id,
        }))
      : editableNumericTargets;
  const barClearableTargets =
    selectedColumnTarget?.kind === 'COL' &&
    !activeTab.isLocked &&
    !selectedColumnTarget.col.isLocked &&
    selectedColumnTarget.col.type !== 'AVERAGE'
      ? visibleStudents.map((s) => ({
          studentId: s.id,
          columnId: selectedColumnTarget.col.id,
        }))
      : clearableTargets;
  const distinctSelectedStudentIds = Array.from(
    new Set(
      selectedKeys.size > 0
        ? Array.from(selectedKeys)
            .map((k) => k.split('::')[0])
            .filter(Boolean)
        : selectedTargets.map((t) => t.studentId)
    )
  );

  const handleApplyBatchBar = (e: React.FormEvent) => {
    e.preventDefault();
    if (barEditableTargets.length === 0) return;
    const parsed = parseMixedInput(batchDraft);
    setMultipleCellsData(barEditableTargets, parsed.grade, parsed.comment);
    setBatchDraft('');
  };

  // Shared renderer for standalone columns (rowSpan=2 in Row 1) and child columns (in Row 2)
  const renderColumnHeaderCell = (col: ColumnEntity, isStandalone: boolean) => {
    const hint = dropHint?.key === col.id ? dropHint.mode : null;
    const isDraggingThis = dragItem?.kind === 'COL' && dragItem.id === col.id;
    const isColSelected =
      selectedColumnTarget?.kind === 'COL' && selectedColumnTarget.col.id === col.id;
    const isVertical = shouldRenderVerticalHeader(col.title, col.width, col.headerOrientation);
    const cellHeight = isStandalone ? canopyH + headerH : headerH;

    return (
      <th
        key={col.id}
        rowSpan={isStandalone ? 2 : undefined}
        draggable={!activeTab.isLocked}
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
          if (justResizedRef.current) return;
          e.stopPropagation();
          selectEntireColumn(col);
        }}
        onDoubleClick={(e) => {
          if (justResizedRef.current) return;
          e.stopPropagation();
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
        title={`${col.title} — 1 clic: seleccionar columna · Doble clic: editar · Arrastra borde derecho para ancho`}
        className={`border-r border-b border-slate-300 ${
          !isStandalone ? 'border-t border-t-slate-300/80' : ''
        } px-1 py-1 relative group cursor-pointer transition-all align-middle hover:brightness-97 ${
          isDraggingThis ? 'opacity-60' : ''
        } ${isColSelected ? 'ring-2 ring-inset ring-blue-600' : ''}`}
      >
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
          <Copy style={smallIconStyle} />
        </button>

        <div
          style={{
            height: Math.max(24, cellHeight - 8),
            maxHeight: Math.max(24, cellHeight - 8),
          }}
          className="flex flex-col items-center justify-between gap-0.5 overflow-hidden"
        >
          <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden px-0.5">
            <span
              style={isVertical ? { maxHeight: Math.max(20, cellHeight - 28) } : undefined}
              className={`text-[0.88em] font-bold text-slate-900 leading-tight whitespace-normal break-words ${
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
            {col.isLocked && <Lock style={smallIconStyle} className="text-slate-600 shrink-0" />}
            {col.type === 'AVERAGE' && <Calculator style={smallIconStyle} className="text-amber-700 shrink-0" />}
            {col.type === 'RUBRIC' && <LayoutGrid style={smallIconStyle} className="text-purple-700 shrink-0" />}
          </div>
        </div>

        {/* Independent Right-Edge Width Resize Handle (Double-click = auto-fit / restore) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Cambiar anchura de ${col.title}`}
          title="Arrastra para ajustar ancho · Doble clic: ajustar al texto más largo"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => toggleAutoFitColumn(e, col)}
          onPointerDown={(e) => startColumnResize(e, col)}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/60 transition-colors z-20"
        />
        {/* Bottom-Edge Header Height Resize Handle */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Cambiar altura de cabecera"
          title="Arrastra para ajustar altura de cabecera · Doble clic: autoajustar"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={toggleAutoFitHeaderHeight}
          onPointerDown={startHeaderHeightResize}
          className="absolute left-0 bottom-0 w-full h-1.5 cursor-row-resize hover:bg-blue-500/60 transition-colors z-20"
        />
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
        className="flex-1 min-h-0 overflow-auto bg-slate-50 focus:outline-none relative"
      >
      <table
        style={{
          tableLayout: 'fixed',
          width: totalTableWidth,
          borderCollapse: 'separate',
          borderSpacing: 0,
          fontSize: `${scaledTextFs}px`,
        }}
        className="select-none"
      >
        <colgroup>
          <col style={{ width: studentColW }} />
          {displaySlots.map((slot) => (
            <col key={`cg-${slot.key}`} style={{ width: Math.round(slot.width * gridZoom) }} />
          ))}
          <col style={{ width: addColW }} />
        </colgroup>

        {/* STICKY TOP HEADER (iDoceo-style continuous columns & inverted-L folders + LOMLOE row) */}
        <thead className="sticky top-0 z-30 bg-white">
          {/* Row 1: Top-Left Student Header + Standalone cols (rowSpan=2) + Closed Folders + Open Folder Canopies */}
          <tr>
            <th
              rowSpan={showLomloeBar ? 3 : 2}
              style={{
                width: studentColW,
                backgroundColor: blendWithWhite(activeTab.color, 0.45),
              }}
              className="sticky left-0 z-40 border-r-2 border-b border-slate-300 px-2 py-1 text-left align-top relative"
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

              {/* Resize handle on right edge of student column (Double-click = auto-fit / restore) */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Redimensionar columna de alumnos"
                title="Arrastra para ajustar ancho de alumnos · Doble clic: ajustar al nombre más largo"
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={toggleAutoFitStudentCol}
                onPointerDown={startStudentColResize}
                className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors z-20"
              />
              {/* Bottom-Edge Header Height Resize Handle */}
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Redimensionar altura de cabecera"
                title="Arrastra para ajustar altura de cabecera · Doble clic: autoajustar"
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={toggleAutoFitHeaderHeight}
                onPointerDown={startHeaderHeightResize}
                className="absolute left-0 bottom-0 w-full h-1.5 cursor-row-resize hover:bg-blue-500/50 transition-colors z-20"
              />
            </th>

            {/* Row 1 Dynamic Headers: Standalone Cols (rowSpan=2) + Folder Canopies (BOTH open & closed keep Row 1 + Row 2 so header height NEVER changes!) */}
            {row1Headers.map((item) => {
              if (item.kind === 'COL') {
                return renderColumnHeaderCell(item.col, true);
              }

              // Both FOLDER_CLOSED (colSpan=1) and FOLDER_OPEN (colSpan=1+childCols.length) render the top Row 1 canopy!
              // Double-click on this top bar folds/unfolds the folder; clicking ⋮ edits the folder.
              const { folder, childCols } = item;
              const isClosed = item.kind === 'FOLDER_CLOSED';
              const fldKey = isClosed ? `fld-top-${folder.id}` : `fld-hdr-${folder.id}`;
              const hint = dropHint?.key === fldKey ? dropHint.mode : null;
              const isDraggingThis = dragItem?.kind === 'FOLDER' && dragItem.id === folder.id;
              const isFldSelected =
                selectedColumnTarget?.kind === 'FOLDER' &&
                selectedColumnTarget.folder.id === folder.id;

              return (
                <th
                  key={fldKey}
                  colSpan={isClosed ? 1 : 1 + childCols.length}
                  draggable={!activeTab.isLocked}
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
                    if (justResizedRef.current) return;
                    e.stopPropagation();
                    selectFolderSummaryColumn(folder, childCols);
                  }}
                  onDoubleClick={(e) => {
                    if (justResizedRef.current) return;
                    e.stopPropagation();
                    toggleFolderCollapse(activeTab.id, folder.id);
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
                  } carpeta · 1 clic: seleccionar · Botón ⋮: configurar`}
                  className={`border-r border-b-0 border-slate-300 px-1.5 text-center cursor-pointer hover:brightness-97 transition-all relative group overflow-hidden ${
                    hint === 'INSIDE' ? 'ring-2 ring-inset ring-blue-500' : ''
                  } ${isDraggingThis ? 'opacity-60' : ''} ${
                    isFldSelected ? 'ring-2 ring-inset ring-blue-600' : ''
                  }`}
                >
                  <div
                    style={{
                      height: Math.max(20, canopyH - 4),
                      maxHeight: Math.max(20, canopyH - 4),
                    }}
                    className="flex items-center justify-between gap-0.5 text-[0.86em] font-bold text-slate-900 overflow-hidden"
                  >
                    {!isClosed && (
                      <GripVertical
                        style={smallIconStyle}
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
                      <MoreVertical style={smallIconStyle} />
                    </button>
                  </div>

                  {isClosed && (
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Cambiar anchura de carpeta ${folder.title}`}
                      title="Arrastra para ajustar ancho · Doble clic: ajustar al texto más largo"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => toggleAutoFitFolder(e, folder, childCols)}
                      onPointerDown={(e) => startFolderResize(e, folder)}
                      className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/60 transition-colors z-20"
                    />
                  )}
                </th>
              );
            })}

            {/* Add Column / Folder Top-Right Button (also acts as drop zone to pull columns OUT of folders or move to end) */}
            <th
              rowSpan={showLomloeBar ? 3 : 2}
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

          {/* Row 2: Folder seamless left Summary Columns (both open & closed!) + Child Column Headers */}
          <tr>
            {row2Slots.map((slot) => {
              if (slot.kind === 'FOLDER_SUMMARY') {
                const { folder, childCols, key, isOpen } = slot;
                const fldW = folder.width ?? 68;
                const isVertical = shouldRenderVerticalHeader(folder.title, fldW);
                const isFldSelected =
                  selectedColumnTarget?.kind === 'FOLDER' &&
                  selectedColumnTarget.folder.id === folder.id;

                return (
                  <th
                    key={key}
                    rowSpan={showLomloeBar ? 2 : undefined}
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
                    title={`${folder.title} (resumen) — 1 clic: seleccionar · Doble clic aquí: configurar · Doble clic arriba: ${
                      isOpen ? 'plegar' : 'desplegar'
                    }`}
                    className={`border-r border-b border-t-0 border-slate-300 px-1 py-1 relative group cursor-pointer align-middle transition-all hover:brightness-97 overflow-hidden ${
                      dropHint?.key === key ? 'ring-2 ring-inset ring-blue-500' : ''
                    } ${isFldSelected ? 'ring-2 ring-inset ring-blue-600' : ''}`}
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
                      <Copy style={smallIconStyle} />
                    </button>

                    <div
                      style={{
                        height: Math.max(24, headerH + (showLomloeBar ? lomloeRowH : 0) - 8),
                        maxHeight: Math.max(24, headerH + (showLomloeBar ? lomloeRowH : 0) - 8),
                      }}
                      className="flex flex-col items-center justify-center gap-1 overflow-hidden"
                    >
                      {!isOpen ? (
                        <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden px-0.5">
                          <span
                            style={isVertical ? { maxHeight: Math.max(20, headerH - 14) } : undefined}
                            className={`text-[0.86em] font-bold text-slate-900 leading-tight whitespace-normal break-words ${
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
                          <Plus style={smallIconStyle} />
                          <span>Col</span>
                        </button>
                      ) : (
                        <span className="text-[0.76em] font-semibold text-slate-600/85 text-center whitespace-normal break-words leading-tight px-0.5">
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

                    {/* Independent Folder Width Resize Handle (Double-click = auto-fit / restore) */}
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Cambiar anchura de carpeta ${folder.title}`}
                      title="Arrastra para ajustar ancho · Doble clic: ajustar al texto más largo"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => toggleAutoFitFolder(e, folder, childCols)}
                      onPointerDown={(e) => startFolderResize(e, folder)}
                      className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/60 transition-colors z-20"
                    />
                    {/* Bottom-Edge Header Height Resize Handle */}
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label="Cambiar altura de cabecera"
                      title="Arrastra para ajustar altura de cabecera · Doble clic: autoajustar"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={toggleAutoFitHeaderHeight}
                      onPointerDown={startHeaderHeightResize}
                      className="absolute left-0 bottom-0 w-full h-1.5 cursor-row-resize hover:bg-blue-500/60 transition-colors z-20"
                    />
                  </th>
                );
              }

              return renderColumnHeaderCell(slot.col, false);
            })}
          </tr>

          {/* Row 3: iDoceo-style LOMLOE Criteria Codes, Specific Competence Numbers & Key Competence Badges */}
          {showLomloeBar && activeCurriculum && (
            <tr data-lomloe-row="true">
              {displaySlots.map((slot) => {
                if (slot.kind === 'FOLDER_SUMMARY') {
                  // Covered seamlessly by FOLDER_SUMMARY rowSpan={2}
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
                      isPickerOpen ? 'ring-2 ring-inset ring-indigo-500' : ''
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

                    {/* Resize Column Width Handle continued cleanly on LOMLOE cell */}
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => toggleAutoFitColumn(e, col)}
                      onPointerDown={(e) => startColumnResize(e, col)}
                      className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/60 transition-colors z-20"
                    />
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
                      <div className="flex items-center justify-between gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleGroupCollapsed(bucket.key)}
                          className="flex items-center gap-1.5 min-w-0 text-left hover:text-slate-950 text-slate-800 font-bold text-[0.98em]"
                        >
                          {bucket.isCollapsed ? (
                            <ChevronRight style={smallIconStyle} className="shrink-0" />
                          ) : (
                            <ChevronDown style={smallIconStyle} className="shrink-0" />
                          )}
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
                        </button>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {groupSummaryRows.length === 0 && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
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
                              onClick={() => onOpenGroupsManager(bucket.name)}
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
                      const cellBg = isFolder
                        ? blendWithWhite(slot.folder.color, 0.36)
                        : blendWithWhite(bucket.color, 0.66);
                      const isActivePopover =
                        groupColAction?.bucketKey === bucket.key &&
                        ((groupColAction.slot.kind === 'COL' &&
                          slot.kind === 'COL' &&
                          groupColAction.slot.col.id === slot.col.id) ||
                          (groupColAction.slot.kind === 'FOLDER' &&
                            slot.kind === 'FOLDER_SUMMARY' &&
                            groupColAction.slot.folder.id === slot.folder.id));

                      const isSelectedGroupCol =
                        selectedGroupColCell?.bucketKey === bucket.key &&
                        selectedGroupColCell?.slotKey === slot.key;

                      return (
                        <td
                          key={`grp-act-${bucket.key}-${slot.key}`}
                          data-group-col-action={`${bucket.key}::${slot.key}`}
                          style={{ backgroundColor: cellBg, height: groupRowH }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSummaryCellPicker(null);
                            setAddGroupSummaryMenu(null);
                            setGroupColAction(null);
                            setSelectedGroupColCell({ bucketKey: bucket.key, slotKey: slot.key });
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setGroupColGradeDraft('');
                            setSummaryCellPicker(null);
                            setAddGroupSummaryMenu(null);
                            setSelectedGroupColCell({ bucketKey: bucket.key, slotKey: slot.key });
                            setGroupColAction({
                              bucketKey: bucket.key,
                              bucketName: bucket.name,
                              studentIds: groupStudentIds,
                              slot: isFolder
                                ? {
                                    kind: 'FOLDER',
                                    folder: slot.folder,
                                    childCols: slot.childCols,
                                  }
                                : { kind: 'COL', col: slot.col },
                              top: Math.max(12, Math.min(window.innerHeight - 360, rect.bottom + 6)),
                              left: Math.max(12, Math.min(window.innerWidth - 300, rect.left - 80)),
                            });
                          }}
                          title={
                            isFolder
                              ? `Grupo "${bucket.name}" · Doble clic: ver estadísticas en carpeta ${slot.folder.title}`
                              : `Grupo "${bucket.name}" · Doble clic: modificar notas o ver estadísticas en ${slot.col.title}`
                          }
                          className={`border-r border-b border-t border-slate-300 text-center align-middle cursor-pointer hover:brightness-95 transition-all ${
                            isActivePopover || isSelectedGroupCol ? 'ring-2 ring-inset ring-blue-600' : ''
                          }`}
                        >
                          <div className="flex items-center justify-center h-full text-slate-500/80 hover:text-blue-700">
                            {isFolder ? (
                              <Hexagon style={smallIconStyle} />
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
                const displayName =
                  workspace.settings.nameFormat === 'FIRST_LAST'
                    ? `${student.firstName} ${student.lastName}`
                    : `${student.lastName}, ${student.firstName}`;
                const stGroup = getStudentActiveGroup(student, activeBook);
                const stGrpColor = stGroup
                  ? effectiveGroups.find(
                      (g) => g.name.toLowerCase() === stGroup.toLowerCase()
                    )?.color ?? getGroupDefaultColor(stGroup)
                  : undefined;

                rows.push(
                <tr key={student.id} style={{ height: rowH }}>
                  {/* Sticky Student Name Cell (1 click selects row, double click opens student card) */}
                  <th
                    scope="row"
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
                    className="sticky left-0 z-20 border-r-2 border-b border-slate-200 px-2.5 py-1 text-left font-normal relative"
                  >
                    <button
                      type="button"
                      onClick={() => selectEntireStudentRow(student.id)}
                      onDoubleClick={() => onEditStudent(student)}
                      title={`${displayName} — 1 clic: seleccionar fila · Doble clic: abrir ficha del alumno`}
                      className="w-full h-full flex items-center justify-between gap-2 text-left hover:text-blue-700 transition-colors overflow-hidden"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-[2em] h-[2em] rounded-full flex items-center justify-center text-[0.83em] font-bold text-slate-700 shrink-0 border border-black/5"
                          style={{ backgroundColor: getAvatarBg(student.id) }}
                        >
                          {getInitials(student.firstName, student.lastName)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[1em] font-semibold text-slate-900 truncate">
                            {displayName}
                          </div>
                          {stGroup && !activeBook.groupByGroups && (
                            <div className="mt-0.5 flex items-center gap-1">
                              <span
                                style={{ backgroundColor: stGrpColor }}
                                className="px-1.5 py-0 rounded-full text-[0.79em] font-bold text-slate-700 border border-black/5 truncate max-w-[130px] leading-tight"
                              >
                                {stGroup}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="text-[0.83em] text-slate-400 tabular-nums shrink-0">
                        {rIdx + 1}
                      </span>
                    </button>
                    {/* Bottom-Edge Row Height Resize Handle (Double-click = auto-fit / restore) */}
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label={`Cambiar altura de filas (${displayName})`}
                      title="Arrastra para ajustar altura de las filas · Doble clic: autoajustar al contenido"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={toggleAutoFitRowHeight}
                      onPointerDown={startRowHeightResize}
                      className="absolute left-0 bottom-0 w-full h-1.5 cursor-row-resize hover:bg-blue-500/50 transition-colors z-20"
                    />
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
                      return (
                        <td
                          key={`${student.id}-${slot.key}`}
                          data-cell={fCellKey}
                          aria-selected={isFolderCellInMulti || isFocusedFolderCell}
                          tabIndex={isFocusedFolderCell ? 0 : -1}
                          style={{
                            height: rowH,
                            backgroundColor: folderColors.bgColor ?? defaultFolderBg,
                            color: folderColors.textColor ?? '#0F172A',
                            fontSize: `${scaledGradeFs}px`,
                          }}
                          onMouseDown={(e) => {
                            if (e.shiftKey || e.metaKey || e.ctrlKey) {
                              e.preventDefault();
                            }
                          }}
                          onClick={(e) => {
                            const clicked = { studentId: student.id, columnId: slot.key };
                            const isMod = e.metaKey || e.ctrlKey;
                            if (e.shiftKey) {
                              const anchor = anchorCoord ?? selectedCoord ?? clicked;
                              selectRangeToCell(anchor, clicked, isMod);
                            } else if (isMod) {
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
                              // Select ONLY this single folder cell (like any normal cell in the grid)
                              selectSingleCell(student.id, slot.key);
                              ensureCellVisible(student.id, slot.key, 'auto');
                            }
                          }}
                          onDoubleClick={(e) => {
                            if (e.shiftKey || e.metaKey || e.ctrlKey) return;
                            onEditFolder(activeTab.id, slot.folder);
                          }}
                          className={`border-r border-b border-slate-200 px-1 py-0.5 text-center font-bold tabular-nums cursor-pointer relative ${
                            isFocusedFolderCell
                              ? 'cell-selected z-10'
                              : isFolderCellInMulti
                                ? 'cell-multi-selected z-10'
                                : 'hover:brightness-98'
                          }`}
                        >
                          {val !== null ? formatGrade(val, 2) : ''}
                        </td>
                      );
                    }

                    const col = slot.col;
                    const key = cellKey(student.id, col.id);
                    const cell = activeBook.cells[key];
                    const grade = cell?.grade ?? null;
                    const comment = cell?.comment ?? '';
                    const isFocusedCell =
                      selectedCoord?.studentId === student.id &&
                      selectedCoord?.columnId === col.id;
                    const isInMultiSelection = selectedKeys.has(key);
                    const isInline =
                      inlineEdit?.studentId === student.id &&
                      inlineEdit?.columnId === col.id;

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
                    const liveSplit =
                      isInline && inlineEdit ? parseLiveMixedInput(inlineEdit.draft) : null;

                    const isTypingComment = Boolean(liveSplit && !liveSplit.gradeText && liveSplit.commentText);
                    const isPreservedGrade = Boolean(
                      isTypingComment &&
                      inlineEdit?.initialGrade !== null &&
                      inlineEdit?.initialGrade !== undefined &&
                      (col.type === 'RUBRIC' || inlineEdit?.mode === 'TYPE_OVER')
                    );

                    const liveGradeDisplay = liveSplit
                      ? liveSplit.gradeText ||
                        (isPreservedGrade
                          ? formatGrade(inlineEdit!.initialGrade, col.decimals)
                          : '')
                      : '';

                    const isTypingGrade = Boolean(liveSplit && liveSplit.gradeText && !liveSplit.commentText);
                    const isPreservedComment = Boolean(
                      isTypingGrade &&
                      inlineEdit?.initialComment &&
                      inlineEdit?.mode === 'TYPE_OVER'
                    );

                    const liveCommentDisplay = liveSplit
                      ? liveSplit.commentText || (isPreservedComment ? inlineEdit!.initialComment! : '')
                      : '';

                    return (
                      <td
                        key={`${student.id}-${col.id}`}
                        data-cell={key}
                        aria-selected={isInMultiSelection || isFocusedCell}
                        tabIndex={isFocusedCell ? 0 : -1}
                        title={
                          isManualRubricEdit
                            ? 'Nota de rúbrica editada manualmente (doble clic para abrir la rúbrica)'
                            : undefined
                        }
                        onMouseDown={(e) => {
                          if (e.shiftKey || e.metaKey || e.ctrlKey) {
                            e.preventDefault();
                          }
                        }}
                        onClick={(e) => {
                          if (isInline) return;
                          const clicked = { studentId: student.id, columnId: col.id };
                          const isMod = e.metaKey || e.ctrlKey;
                          if (e.shiftKey) {
                            const anchor = anchorCoord ?? selectedCoord ?? clicked;
                            selectRangeToCell(anchor, clicked, isMod);
                          } else if (isMod) {
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
                          if (isInline || e.shiftKey || e.metaKey || e.ctrlKey) return;
                          selectSingleCell(student.id, col.id);
                          ensureCellVisible(student.id, col.id, 'auto');
                          if (col.type === 'RUBRIC') {
                            onOpenRubricGrader(student, col);
                          } else if (col.type === 'NUMERIC') {
                            onOpenCellModal(student, col);
                          } else {
                            onEditColumn(col);
                          }
                        }}
                        style={{
                          height: rowH,
                          backgroundColor: cellBg,
                          color: colors.textColor ?? '#0F172A',
                        }}
                        className={`border-r border-b border-slate-200 px-1.5 py-0.5 text-center align-middle relative cursor-pointer overflow-hidden ${
                          isFocusedCell
                            ? 'cell-selected z-10'
                            : isInMultiSelection
                              ? 'cell-multi-selected z-10'
                              : 'hover:brightness-98'
                        }`}
                      >
                        {/* Discreet corner indicator for manually-edited rubric cells */}
                        {isManualRubricEdit && !isInline && (
                          <span
                            aria-label="Nota editada manualmente"
                            className="absolute top-0 right-0 w-0 h-0 border-t-[7px] border-l-[7px] border-t-amber-500/85 border-l-transparent pointer-events-none"
                          />
                        )}

                        {isInline && inlineEdit && liveSplit ? (
                          <div className="w-full h-[calc(100%-2px)] px-1 bg-white border border-blue-500 rounded-md relative flex flex-col items-center justify-center overflow-hidden leading-tight">
                            {/* Live top line: numeric grade */}
                            <div className="min-h-[1.15em] flex items-center justify-center max-w-full truncate">
                              {liveGradeDisplay && (
                                <span
                                  className={`text-[1em] font-bold tabular-nums ${
                                    isPreservedGrade ? 'text-slate-400' : 'text-blue-700'
                                  }`}
                                >
                                  {liveGradeDisplay}
                                </span>
                              )}
                              {liveSplit.activePart === 'GRADE' && (
                                <span className="inline-block w-[1.5px] h-[1em] bg-blue-600 ml-0.5 animate-pulse shrink-0" />
                              )}
                            </div>

                            {/* Live bottom line: comment text */}
                            {(liveCommentDisplay || liveSplit.activePart === 'COMMENT') && (
                              <div className="flex items-center justify-center max-w-full truncate mt-0.5">
                                {liveCommentDisplay && (
                                  <span
                                    className={`text-[0.83em] truncate ${
                                      isPreservedComment
                                        ? 'text-slate-400 font-normal'
                                        : 'font-medium text-slate-600'
                                    }`}
                                  >
                                    {liveCommentDisplay}
                                  </span>
                                )}
                                {liveSplit.activePart === 'COMMENT' && (
                                  <span className="inline-block w-[1.5px] h-[0.9em] bg-slate-500 ml-0.5 animate-pulse shrink-0" />
                                )}
                              </div>
                            )}

                            {/* Real focused input capturing all typing, IME, selection & paste natively */}
                            <input
                              ref={inlineInputRef}
                              type="text"
                              autoFocus
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
                              className="absolute inset-0 w-full h-full opacity-0 cursor-text"
                            />
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full overflow-hidden leading-tight">
                            {grade !== null && (
                              <span
                                style={{ fontSize: `${scaledGradeFs}px` }}
                                className="font-bold tabular-nums leading-tight"
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
                            )}
                            {comment && (
                              <span
                                title={comment}
                                className={`max-w-full truncate px-0.5 ${
                                  grade !== null
                                    ? 'text-[0.8em] font-normal text-slate-500 mt-0.5'
                                    : 'text-[0.9em] font-medium text-slate-600'
                                }`}
                              >
                                {comment}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}

                  <td className="border-b border-slate-200 bg-slate-50/40" />
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
                        className="sticky left-0 z-20 bg-slate-50/95 border-r-2 border-b border-slate-200 px-2 py-0.5 text-left font-normal"
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
                              setSummaryCellPicker({
                                scope: 'GROUP',
                                rowIndex: gRowIdx,
                                target: { kind: 'GLOBAL' },
                                top: Math.max(12, Math.min(window.innerHeight - 320, rect.top - 90)),
                                left: Math.min(window.innerWidth - 250, rect.left),
                              });
                            }}
                            title="Cambiar estadística de grupo (se aplica a todos los grupos y columnas)"
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
                        const overrideMetric = isFolder
                          ? slot.folder.groupSummaryRowOverrides?.[gRowIdx]
                          : slot.col.groupSummaryRowOverrides?.[gRowIdx];
                        const effectiveMetric = overrideMetric ?? globalGrpMetric;
                        const metricOpt = COLUMN_SUMMARY_OPTIONS.find(
                          (o) => o.metric === effectiveMetric
                        );

                        const grpGrades = bucket.students.map((st) => {
                          if (isFolder) {
                            return computeFolderSummary(slot.folder, slot.childCols, st.id, activeBook);
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
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setGroupColAction(null);
                              setAddGroupSummaryMenu(null);
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
                            title={`${bucket.name} · ${metricOpt?.label ?? ''}: ${formatted || '—'} · Clic para cambiar (se aplica a todos los grupos)`}
                            className="border-r border-b border-slate-200 px-1 py-0.5 text-center align-middle cursor-pointer hover:brightness-95 transition-all"
                          >
                            <div className="font-bold text-slate-900 tabular-nums text-[0.88em] leading-tight truncate">
                              {formatted || '—'}
                            </div>
                            {effectiveMetric !== 'NONE' && (
                              <div className="text-[0.68em] font-medium text-slate-500 leading-none truncate">
                                {metricOpt?.shortLabel}
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
                  } px-2 py-0.5 text-left font-normal`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSummaryCellPicker({
                          scope: 'TABLE',
                          rowIndex: rowIdx,
                          target: { kind: 'GLOBAL' },
                          top: Math.max(12, Math.min(window.innerHeight - 320, rect.top - 120)),
                          left: Math.min(window.innerWidth - 240, rect.left),
                        });
                      }}
                      title="Cambiar resumen de esta fila (extensible a todas las columnas)"
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/90 hover:bg-white border border-slate-200 text-[0.84em] font-bold text-slate-700 hover:text-blue-700 truncate max-w-[165px]"
                    >
                      <Sigma style={smallIconStyle} className="text-blue-600 shrink-0" />
                      <span className="truncate">{globalOpt.label}</span>
                      <ChevronDown style={smallIconStyle} className="opacity-60 shrink-0" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSummaryRow(rowIdx)}
                      title="Eliminar esta fila de resumen"
                      aria-label={`Eliminar fila de resumen ${globalOpt.label}`}
                      className="p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                    >
                      <X style={smallIconStyle} />
                    </button>
                  </div>
                </th>

                {displaySlots.map((slot) => {
                  const isFolder = slot.kind === 'FOLDER_SUMMARY';
                  const overrideMetric = isFolder
                    ? slot.folder.summaryRowOverrides?.[rowIdx]
                    : slot.col.summaryRowOverrides?.[rowIdx];
                  const effectiveMetric = overrideMetric ?? globalMetric;
                  const metricOpt = COLUMN_SUMMARY_OPTIONS.find(
                    (o) => o.metric === effectiveMetric
                  );

                  const gradesForSlot = visibleStudents.map((st) => {
                    if (isFolder) {
                      return computeFolderSummary(slot.folder, slot.childCols, st.id, activeBook);
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
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
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
                      title={`${metricOpt?.label ?? ''}: ${formatted || '—'} · Clic para cambiar resumen de esta columna`}
                      className={`border-r border-b border-slate-300 ${
                        rowIdx === 0 ? 'border-t-2 border-t-slate-300' : ''
                      } px-1 py-0.5 text-center font-bold text-slate-800 tabular-nums cursor-pointer hover:brightness-95 transition-all text-[0.9em]`}
                    >
                      <div className="truncate">{formatted || '—'}</div>
                      {overrideMetric && overrideMetric !== globalMetric && overrideMetric !== 'NONE' && (
                        <div className="text-[0.72em] font-semibold text-blue-700 leading-none truncate">
                          {metricOpt?.shortLabel}
                        </div>
                      )}
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
          <tr data-summary-controls="true" className="h-8 bg-slate-100/80">
            <th
              scope="row"
              className={`sticky left-0 z-20 bg-slate-100 border-r-2 border-b border-slate-300 ${
                summaryRows.length === 0 ? 'border-t-2 border-t-slate-300' : ''
              } px-2 py-1 text-left font-normal`}
            >
              <div className="relative flex items-center justify-between gap-1" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => setShowAddSummaryMenu((v) => !v)}
                  title="Añadir fila de resumen extensible a todas las columnas"
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
              Pulsa en cualquier casilla de resumen para personalizar esa columna o en la fila izquierda para aplicarlo a todas.
            </td>
          </tr>
        </tfoot>
        )}
      </table>
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
                `Fila resumen ${summaryCellPicker.rowIndex + 1} (Todas)`
              ) : (
                `Resumen · ${summaryCellPicker.target.title}`
              )}
            </div>
            <div className="text-[10px] text-slate-500">
              {summaryCellPicker.scope === 'GROUP'
                ? 'Se configura igual en todos los grupos'
                : summaryCellPicker.target.kind === 'GLOBAL'
                  ? 'Se aplica a todas las columnas de esta fila'
                  : 'Personaliza esta columna o extiéndelo a todas'}
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
                    title="Aplicar esta métrica a TODAS las columnas en esta fila"
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

      {/* Floating iDoceo-style Group Column Header Action Popover (batch grade + group stats!) */}
      {groupColAction && (() => {
        const actSlot = groupColAction.slot;
        const isCol = actSlot.kind === 'COL';
        const colEntity = actSlot.kind === 'COL' ? actSlot.col : null;
        const folderSlot = actSlot.kind === 'FOLDER' ? actSlot : null;
        const canBatchEdit = Boolean(
          colEntity && !activeTab.isLocked && !colEntity.isLocked && colEntity.type !== 'AVERAGE'
        );

        const groupGrades = groupColAction.studentIds.map((sid) => {
          if (colEntity) {
            return activeBook.cells[cellKey(sid, colEntity.id)]?.grade ?? null;
          }
          if (folderSlot) {
            return computeFolderSummary(folderSlot.folder, folderSlot.childCols, sid, activeBook);
          }
          return null;
        });
        const threshold = colEntity ? colEntity.passThreshold : activeBook.passThreshold;
        const decimals = colEntity ? colEntity.decimals : 2;
        const title = colEntity ? colEntity.title : (folderSlot?.folder.title ?? '');

        const targets = colEntity
          ? groupColAction.studentIds.map((studentId) => ({ studentId, columnId: colEntity.id }))
          : [];

        return (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{ top: groupColAction.top, left: groupColAction.left }}
            role="dialog"
            aria-label={`Acciones del grupo ${groupColAction.bucketName} en ${title}`}
            className="fixed w-72 rounded-2xl border border-slate-200 bg-white shadow-2xl p-3 z-50 text-xs space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
              <div className="min-w-0">
                <div className="font-bold text-slate-900 truncate">{groupColAction.bucketName}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {isCol ? title : `Carpeta: ${title}`} · {groupColAction.studentIds.length} alumnos
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

            {canBatchEdit && colEntity && (
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
                  Poner nota / texto a todo el grupo a la vez
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    autoFocus
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

      {/* Floating iDoceo-style Zoom Controls (affects ONLY the gradebook grid) */}
      <div className="absolute bottom-3 right-4 z-30">
        <ZoomControls
          zoom={gridZoom}
          min={0.5}
          max={1.8}
          onChangeZoom={(next) => updateSettings({ gridZoom: next })}
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

      {/* Multi-selection or Column-selection contextual batch action bar */}
      {(selectedKeys.size > 1 || selectedTargets.length > 1 || selectedColumnTarget !== null) && (
        <div
          role="region"
          aria-label="Acciones para selección múltiple"
          className="shrink-0 border-t border-blue-200 bg-blue-50/95 backdrop-blur-xs px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs z-20"
        >
          <div className="flex items-center gap-2 font-semibold text-blue-950">
            {selectedColumnTarget ? (
              <>
                <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[11px] font-bold">
                  Columna
                </span>
                <span className="truncate max-w-[200px]">
                  {selectedColumnTarget.kind === 'COL'
                    ? selectedColumnTarget.col.title
                    : selectedColumnTarget.folder.title}
                </span>
                <span className="text-[11px] font-normal text-blue-800 hidden sm:inline">
                  (Cmd/Ctrl+C copia siempre en orden alfabético por apellidos · Doble clic edita)
                </span>
              </>
            ) : (
              <>
                <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[11px] font-bold tabular-nums">
                  {Math.max(selectedKeys.size, selectedTargets.length)}
                </span>
                <span>celdas seleccionadas</span>
                <span className="text-[11px] font-normal text-blue-800 hidden sm:inline">
                  (Escribe directamente o usa esta barra · Shift+Clic rango · Cmd/Ctrl+Clic salteadas)
                </span>
              </>
            )}
          </div>

          <form onSubmit={handleApplyBatchBar} className="flex flex-wrap items-center gap-1.5">
            {selectedColumnTarget?.kind !== 'FOLDER' && (
              <>
                <input
                  type="text"
                  value={batchDraft}
                  onChange={(e) => setBatchDraft(e.target.value)}
                  disabled={barEditableTargets.length === 0}
                  aria-label="Nota o comentario para celdas seleccionadas"
                  placeholder="Nota común (ej: 8.5 bien)"
                  className="w-48 px-2.5 py-1.5 rounded-lg border border-blue-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={barEditableTargets.length === 0 || !batchDraft.trim()}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold flex items-center gap-1 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Aplicar ({barEditableTargets.length})</span>
                </button>
              </>
            )}

            {/* Quick assign selected students into a group (existing or created on the fly) */}
            {distinctSelectedStudentIds.length > 0 && (
              <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setShowBatchGroupMenu((v) => !v)}
                title="Incluir los alumnos seleccionados en un grupo"
                className="px-3 py-1.5 rounded-lg border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-800 font-semibold flex items-center gap-1 transition-colors"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Grupo ({distinctSelectedStudentIds.length})</span>
                <ChevronDown className="w-3 h-3 opacity-70" />
              </button>

              {showBatchGroupMenu && (
                <div className="absolute bottom-full right-0 mb-1.5 w-64 rounded-2xl border border-slate-200 bg-white shadow-xl p-2 z-50 text-xs space-y-2">
                  <div className="px-1.5 pt-0.5 font-bold text-slate-800 flex items-center justify-between">
                    <span>Asignar {distinctSelectedStudentIds.length} alumnos a:</span>
                  </div>

                  {/* Quick create new group on the fly */}
                  <div className="flex items-center gap-1 px-1">
                    <input
                      type="text"
                      value={batchNewGroupDraft}
                      onChange={(e) => setBatchNewGroupDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const clean = batchNewGroupDraft.trim();
                          if (!clean) return;
                          assignStudentsToGroup(distinctSelectedStudentIds, clean);
                          showCopyToast(
                            `${distinctSelectedStudentIds.length} alumnos añadidos a "${clean}"`
                          );
                          setBatchNewGroupDraft('');
                          setShowBatchGroupMenu(false);
                        }
                      }}
                      placeholder="Nuevo grupo..."
                      className="flex-1 border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      disabled={!batchNewGroupDraft.trim()}
                      onClick={() => {
                        const clean = batchNewGroupDraft.trim();
                        if (!clean) return;
                        assignStudentsToGroup(distinctSelectedStudentIds, clean);
                        showCopyToast(
                          `${distinctSelectedStudentIds.length} alumnos añadidos a "${clean}"`
                        );
                        setBatchNewGroupDraft('');
                        setShowBatchGroupMenu(false);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold"
                    >
                      Crear
                    </button>
                  </div>

                  {effectiveGroups.length > 0 && (
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border-t border-slate-100 pt-1">
                      {effectiveGroups.map((grp) => (
                        <button
                          key={grp.id}
                          type="button"
                          onClick={() => {
                            assignStudentsToGroup(distinctSelectedStudentIds, grp.name);
                            showCopyToast(
                              `${distinctSelectedStudentIds.length} alumnos incluidos en "${grp.name}"`
                            );
                            setShowBatchGroupMenu(false);
                          }}
                          className="w-full px-2 py-1.5 text-left flex items-center gap-2 hover:bg-indigo-50 rounded-lg font-medium text-slate-800"
                        >
                          <span
                            className="w-3 h-3 rounded-full border border-black/15 shrink-0"
                            style={{ backgroundColor: grp.color }}
                          />
                          <span className="truncate">{grp.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="border-t border-slate-100 pt-1 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        assignStudentsToGroup(distinctSelectedStudentIds, undefined);
                        showCopyToast('Alumnos quitados de su grupo');
                        setShowBatchGroupMenu(false);
                      }}
                      className="px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50 font-semibold"
                    >
                      Quitar de grupo
                    </button>
                    {onOpenGroupsManager && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowBatchGroupMenu(false);
                          onOpenGroupsManager();
                        }}
                        className="px-2 py-1 rounded-lg text-indigo-700 hover:bg-indigo-50 font-semibold"
                      >
                        Editar grupos...
                      </button>
                    )}
                  </div>
                </div>
              )}
              </div>
            )}

            <button
              type="button"
              onClick={copySelectionToClipboard}
              title={
                selectedColumnTarget
                  ? 'Copiar columna entera en orden alfabético por apellidos (Apellidos A–Z)'
                  : 'Copiar celdas seleccionadas (rúbricas siempre en 0–10)'
              }
              className="px-3 py-1.5 rounded-lg border border-blue-200 bg-white hover:bg-blue-50 text-blue-800 font-semibold flex items-center gap-1 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{selectedColumnTarget ? 'Copiar columna (Apellidos A–Z)' : 'Copiar'}</span>
            </button>
            {selectedColumnTarget?.kind !== 'FOLDER' && (
              <button
                type="button"
                disabled={barClearableTargets.length === 0}
                onClick={() => clearMultipleCells(barClearableTargets)}
                className="px-3 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 disabled:opacity-40 text-rose-700 font-semibold flex items-center gap-1 transition-colors"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>Borrar ({barClearableTargets.length})</span>
              </button>
            )}
            <button
              type="button"
              onClick={clearAllSelection}
              title="Deseleccionar (Esc)"
              aria-label="Cerrar barra de selección múltiple"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-blue-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
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
    </div>
  );
};
