import React, { useEffect, useMemo, useState } from 'react';
import { ModalDockProvider, useModalDockWidth } from './components/common/Modal';
import { usePreventGlobalBrowserZoom } from './components/common/ZoomControls';
import { GradebookGrid } from './components/grid/GradebookGrid';
import { Sidebar } from './components/layout/Sidebar';
import { TabStrip } from './components/layout/TabStrip';
import { TopBar } from './components/layout/TopBar';
import { useDeviceProfile } from './hooks/useDeviceProfile';
import { LomloeModal } from './components/lomloe/LomloeModal';
import { AuthModal, ViewSettingsModal } from './components/modals/AuthAndViewModals';
import { BackupModal } from './components/modals/BackupModal';
import { BookModal } from './components/modals/BookModal';
import { BulkStudentModal } from './components/modals/BulkStudentModal';
import { CellEditModal } from './components/modals/CellEditModal';
import { ColumnModal } from './components/modals/ColumnModal';
import { FolderModal } from './components/modals/FolderModal';
import { RubricBuilderModal, RubricGraderModal } from './components/modals/RubricModals';
import { StudentGroupsModal } from './components/modals/StudentGroupsModal';
import { StudentModal } from './components/modals/StudentModal';
import { TabModal } from './components/modals/TabModal';
import { TemplateApplyModal } from './components/modals/TemplateApplyModal';
import { GradebookProvider, useGradebook } from './context/GradebookContext';
import { organizeStudentsForGrid } from './engine/gradeMath';
import type {
  ClassBook,
  ColumnEntity,
  ColumnType,
  FolderEntity,
  StudentEntity,
  TabEntity,
} from './types/gradebook';

const CuadernoShell: React.FC = () => {
  usePreventGlobalBrowserZoom();
  const device = useDeviceProfile();
  const { activeBook, activeTab } = useGradebook();
  const dockedWidth = useModalDockWidth();
  const [searchQuery, setSearchQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!device.isOverlaySidebar && drawerOpen) {
      setDrawerOpen(false);
    }
  }, [device.isOverlaySidebar, drawerOpen]);

  // Modal states
  const [bookModal, setBookModal] = useState<{
    open: boolean;
    kind: 'CLASS' | 'TEMPLATE';
    editing: ClassBook | null;
  }>({ open: false, kind: 'CLASS', editing: null });

  const [templateApplyTarget, setTemplateApplyTarget] = useState<ClassBook | null>(null);
  const [editingTab, setEditingTab] = useState<TabEntity | null>(null);
  const [folderModal, setFolderModal] = useState<{
    tabId: string;
    folder: FolderEntity;
  } | null>(null);

  const [colModal, setColModal] = useState<{
    open: boolean;
    editing: ColumnEntity | null;
    presetType: ColumnType;
    presetFolderId?: string | null;
  }>({ open: false, editing: null, presetType: 'NUMERIC', presetFolderId: null });

  const [studentModal, setStudentModal] = useState<{
    open: boolean;
    editing: StudentEntity | null;
  }>({ open: false, editing: null });

  const [cellModalTarget, setCellModalTarget] = useState<{
    student: StudentEntity;
    column: ColumnEntity;
  } | null>(null);

  const [rubricGraderTarget, setRubricGraderTarget] = useState<{
    student: StudentEntity | null;
    column: ColumnEntity;
    groupBatch?: { groupName: string; studentIds: string[] } | null;
  } | null>(null);

  const [showRubricBuilder, setShowRubricBuilder] = useState(false);
  const [showLomloeModal, setShowLomloeModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showBulkStudentModal, setShowBulkStudentModal] = useState(false);
  const [groupsModalState, setGroupsModalState] = useState<{
    open: boolean;
    initialGroupName?: string | null;
  }>({ open: false, initialGroupName: null });
  const [showBackupModal, setShowBackupModal] = useState(false);

  const sortedStudents = useMemo(() => {
    if (!activeBook) return [];
    return organizeStudentsForGrid(activeBook, activeTab, '').visibleStudents;
  }, [activeBook, activeTab]);

  // Live synced references so modals stay up-to-date while open
  const liveTab =
    editingTab && activeBook
      ? activeBook.tabs.find((t) => t.id === editingTab.id) ?? editingTab
      : null;

  const liveFolder =
    folderModal && activeBook
      ? activeBook.tabs
          .find((t) => t.id === folderModal.tabId)
          ?.folders.find((f) => f.id === folderModal.folder.id) ?? folderModal.folder
      : null;

  const liveCol =
    colModal.editing && activeBook
      ? activeBook.tabs
          .flatMap((t) => t.columns)
          .find((c) => c.id === colModal.editing!.id) ?? colModal.editing
      : null;

  return (
    <div className="h-dvh w-dvw overflow-hidden flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        searchQuery={searchQuery}
        onChangeSearch={setSearchQuery}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((v) => !v)}
        onOpenAuth={() => setShowAuthModal(true)}
        onOpenViewSettings={() => setShowViewModal(true)}
        onOpenLomloeManager={() => setShowLomloeModal(true)}
        onOpenBackup={() => setShowBackupModal(true)}
      />

      <div
        className="flex-1 flex min-h-0 overflow-hidden transition-[padding] duration-75"
        style={dockedWidth > 0 ? { paddingRight: dockedWidth } : undefined}
      >
        <Sidebar
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
          onOpenNewBook={(kind) => setBookModal({ open: true, kind, editing: null })}
          onEditBook={(book) =>
            setBookModal({
              open: true,
              kind: book.isTemplate ? 'TEMPLATE' : 'CLASS',
              editing: book,
            })
          }
          onOpenTemplateApply={(tpl) => setTemplateApplyTarget(tpl)}
          onOpenRubricBuilder={() => setShowRubricBuilder(true)}
          onOpenLomloeManager={() => setShowLomloeModal(true)}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <TabStrip
            onEditTab={(tab) => setEditingTab(tab)}
            onOpenTemplateCopy={(tpl) => setTemplateApplyTarget(tpl)}
          />

          <main className="flex-1 flex flex-col min-h-0">
            <GradebookGrid
              searchQuery={searchQuery}
              onEditStudent={(st) => setStudentModal({ open: true, editing: st })}
              onNewStudent={() => setStudentModal({ open: true, editing: null })}
              onOpenBulkStudents={() => setShowBulkStudentModal(true)}
              onOpenGroupsManager={(initialGroupName) =>
                setGroupsModalState({ open: true, initialGroupName: initialGroupName ?? null })
              }
              onEditColumn={(col) =>
                setColModal({ open: true, editing: col, presetType: col.type, presetFolderId: null })
              }
              onNewColumn={(preset = 'NUMERIC', folderId = null) =>
                setColModal({
                  open: true,
                  editing: null,
                  presetType: preset,
                  presetFolderId: folderId,
                })
              }
              onEditFolder={(tabId, folder) => setFolderModal({ tabId, folder })}
              onOpenCellModal={(student, column) => setCellModalTarget({ student, column })}
              onOpenRubricGrader={(student, column, groupBatch) =>
                setRubricGraderTarget({ student, column, groupBatch: groupBatch ?? null })
              }
              onOpenLomloeManager={() => setShowLomloeModal(true)}
            />
          </main>
        </div>
      </div>

      {/* Modals */}
      <BookModal
        open={bookModal.open}
        kind={bookModal.kind}
        editingBook={bookModal.editing}
        onClose={() => setBookModal((prev) => ({ ...prev, open: false }))}
      />

      <TemplateApplyModal
        open={Boolean(templateApplyTarget)}
        template={templateApplyTarget}
        onClose={() => setTemplateApplyTarget(null)}
      />

      <TabModal
        open={Boolean(liveTab)}
        tab={liveTab}
        onClose={() => setEditingTab(null)}
      />

      {folderModal && (
        <FolderModal
          open={Boolean(liveFolder)}
          tabId={folderModal.tabId}
          folder={liveFolder}
          onClose={() => setFolderModal(null)}
        />
      )}

      <ColumnModal
        open={colModal.open}
        editingColumn={liveCol}
        presetType={colModal.presetType}
        presetFolderId={colModal.presetFolderId}
        onClose={() => setColModal((prev) => ({ ...prev, open: false }))}
        onOpenRubricBuilder={() => setShowRubricBuilder(true)}
      />

      <StudentModal
        open={studentModal.open}
        editingStudent={studentModal.editing}
        onClose={() => setStudentModal((prev) => ({ ...prev, open: false }))}
        onOpenBulkStudents={() => setShowBulkStudentModal(true)}
      />

      <BulkStudentModal
        open={showBulkStudentModal}
        onClose={() => setShowBulkStudentModal(false)}
      />

      <StudentGroupsModal
        open={groupsModalState.open}
        initialGroupName={groupsModalState.initialGroupName}
        onClose={() => setGroupsModalState({ open: false, initialGroupName: null })}
      />

      <BackupModal
        open={showBackupModal}
        onClose={() => setShowBackupModal(false)}
      />

      <CellEditModal
        open={Boolean(cellModalTarget)}
        student={cellModalTarget?.student ?? null}
        column={cellModalTarget?.column ?? null}
        onClose={() => setCellModalTarget(null)}
      />

      <RubricGraderModal
        open={Boolean(rubricGraderTarget)}
        column={rubricGraderTarget?.column ?? null}
        students={sortedStudents}
        initialStudentId={rubricGraderTarget?.student?.id ?? null}
        groupBatch={rubricGraderTarget?.groupBatch ?? null}
        onClose={() => setRubricGraderTarget(null)}
      />

      <RubricBuilderModal
        open={showRubricBuilder}
        onClose={() => setShowRubricBuilder(false)}
      />

      <LomloeModal
        isOpen={showLomloeModal}
        onClose={() => setShowLomloeModal(false)}
      />

      <AuthModal open={showAuthModal} onClose={() => setShowAuthModal(false)} />
      <ViewSettingsModal
        open={showViewModal}
        onClose={() => setShowViewModal(false)}
        onOpenBackup={() => setShowBackupModal(true)}
      />
    </div>
  );
};

export function App() {
  return (
    <GradebookProvider>
      <ModalDockProvider>
        <CuadernoShell />
      </ModalDockProvider>
    </GradebookProvider>
  );
}

export default App;
