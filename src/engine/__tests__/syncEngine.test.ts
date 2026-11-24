import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from '../../data/seedData';
import { cellKey } from '../../types/gradebook';
import { mergeWorkspaces3Way, preserveDeviceLocalLayoutAndNav } from '../syncEngine';

describe('syncEngine — 3-way offline multi-device merge', () => {
  it('merges grades entered offline on iPad in one class with grades entered online on desktop in another class without losing either', () => {
    const base = createSeedWorkspace();
    const clsA = base.classes[0];
    const clsB = base.classes[1];
    const stA = clsA.students[0];
    const colA = clsA.tabs[0].columns.find((c) => c.type === 'NUMERIC')!;
    const stB = clsB.students[0];
    const colB = clsB.tabs[0].columns.find((c) => c.type === 'NUMERIC')!;

    // iPad offline edits Class A
    const localIpad = structuredClone(base);
    localIpad.classes[0].cells[cellKey(stA.id, colA.id)] = {
      grade: 9.75,
      comment: 'Anotado sin Wi-Fi en clase',
    };
    localIpad.updatedAt = '2026-11-21T10:15:00.000Z';

    // Desktop online edits Class B later
    const remoteDesktop = structuredClone(base);
    remoteDesktop.classes[1].cells[cellKey(stB.id, colB.id)] = {
      grade: 6.25,
      comment: 'Editado en ordenador',
    };
    remoteDesktop.updatedAt = '2026-11-21T10:20:00.000Z';

    const result = mergeWorkspaces3Way(base, localIpad, remoteDesktop);

    expect(result.cellConflicts).toHaveLength(0);
    expect(result.hadDivergence).toBe(true);
    expect(result.workspace.classes[0].cells[cellKey(stA.id, colA.id)]?.grade).toBe(9.75);
    expect(result.workspace.classes[0].cells[cellKey(stA.id, colA.id)]?.comment).toBe(
      'Anotado sin Wi-Fi en clase'
    );
    expect(result.workspace.classes[1].cells[cellKey(stB.id, colB.id)]?.grade).toBe(6.25);
    expect(result.workspace.classes[1].cells[cellKey(stB.id, colB.id)]?.comment).toBe(
      'Editado en ordenador'
    );
  });

  it('merges different students edited in the same column across devices and honors explicit offline cell deletions', () => {
    const base = createSeedWorkspace();
    const cls = base.classes[0];
    const col = cls.tabs[0].columns.find((c) => c.type === 'NUMERIC')!;
    const st0 = cls.students[0];
    const st1 = cls.students[1];
    const st2 = cls.students[2];

    // Ensure st2 has an existing value in base so we can test deletion
    base.classes[0].cells[cellKey(st2.id, col.id)] = { grade: 5.5, comment: '' };

    const localIpad = structuredClone(base);
    localIpad.classes[0].cells[cellKey(st0.id, col.id)] = { grade: 8.8, comment: 'iPad' };
    delete localIpad.classes[0].cells[cellKey(st2.id, col.id)]; // explicitly cleared offline
    localIpad.updatedAt = '2026-11-21T11:00:00.000Z';

    const remoteDesktop = structuredClone(base);
    remoteDesktop.classes[0].cells[cellKey(st1.id, col.id)] = { grade: 7.4, comment: 'Mac' };
    remoteDesktop.updatedAt = '2026-11-21T11:05:00.000Z';

    const result = mergeWorkspaces3Way(base, localIpad, remoteDesktop);

    expect(result.cellConflicts).toHaveLength(0);
    expect(result.workspace.classes[0].cells[cellKey(st0.id, col.id)]?.grade).toBe(8.8);
    expect(result.workspace.classes[0].cells[cellKey(st1.id, col.id)]?.grade).toBe(7.4);
    expect(result.workspace.classes[0].cells[cellKey(st2.id, col.id)]).toBeUndefined();
  });

  it('merges independently added columns on both devices without overwriting either column', () => {
    const base = createSeedWorkspace();
    const localIpad = structuredClone(base);
    localIpad.classes[0].tabs[0].columns.push({
      id: 'col-ipad-offline',
      folderId: null,
      title: 'Debate iPad',
      color: '#DBEAFE',
      width: 110,
      orderIndex: 99,
      type: 'NUMERIC',
      minValue: 0,
      maxValue: 10,
      decimals: 2,
      passThreshold: 5,
      colorMode: 'NONE',
    });
    localIpad.updatedAt = '2026-11-21T12:00:00.000Z';

    const remoteDesktop = structuredClone(base);
    remoteDesktop.classes[0].tabs[0].columns.push({
      id: 'col-mac-online',
      folderId: null,
      title: 'Ensayo Mac',
      color: '#DCFCE7',
      width: 110,
      orderIndex: 100,
      type: 'NUMERIC',
      minValue: 0,
      maxValue: 10,
      decimals: 2,
      passThreshold: 5,
      colorMode: 'NONE',
    });
    remoteDesktop.updatedAt = '2026-11-21T12:01:00.000Z';

    const result = mergeWorkspaces3Way(base, localIpad, remoteDesktop);
    const colIds = result.workspace.classes[0].tabs[0].columns.map((c) => c.id);
    expect(colIds).toContain('col-ipad-offline');
    expect(colIds).toContain('col-mac-online');
  });

  it('detects and surfaces true concurrent conflicts on the exact same student+column cell while preserving device-local zoom/sidebar prefs', () => {
    const base = createSeedWorkspace();
    const cls = base.classes[0];
    const col = cls.tabs[0].columns.find((c) => c.type === 'NUMERIC')!;
    const st = cls.students[0];

    const localIpad = structuredClone(base);
    localIpad.classes[0].cells[cellKey(st.id, col.id)] = { grade: 9.0, comment: 'iPad' };
    localIpad.settings.gridZoom = 1.25;
    localIpad.settings.sidebarVisible = false;
    localIpad.updatedAt = '2026-11-21T12:10:00.000Z';

    const remoteDesktop = structuredClone(base);
    remoteDesktop.classes[0].cells[cellKey(st.id, col.id)] = { grade: 6.5, comment: 'Mac' };
    remoteDesktop.settings.gridZoom = 0.9;
    remoteDesktop.settings.sidebarVisible = true;
    remoteDesktop.updatedAt = '2026-11-21T12:05:00.000Z';

    const result = mergeWorkspaces3Way(base, localIpad, remoteDesktop);

    expect(result.cellConflicts).toHaveLength(1);
    expect(result.cellConflicts[0]).toMatchObject({
      bookId: cls.id,
      studentId: st.id,
      columnId: col.id,
      chosen: 'LOCAL',
    });
    expect(result.cellConflicts[0].localCell?.grade).toBe(9.0);
    expect(result.cellConflicts[0].remoteCell?.grade).toBe(6.5);
    expect(result.workspace.classes[0].cells[cellKey(st.id, col.id)]?.grade).toBe(9.0);

    // Device-local view prefs stay untouched by remote device
    expect(result.workspace.settings.gridZoom).toBe(1.25);
    expect(result.workspace.settings.sidebarVisible).toBe(false);
  });

  it('preserves remote lomloeCriteriaIds when local device only modified column width', () => {
    const base = createSeedWorkspace();
    const local = structuredClone(base);
    const remote = structuredClone(base);

    const targetColId = base.classes[0].tabs[0].columns[0].id;
    local.classes[0].tabs[0].columns[0].width = 80;
    local.updatedAt = '2026-11-23T10:00:00.000Z';

    remote.classes[0].tabs[0].columns[0].lomloeCriteriaIds = ['1.1', '5.1'];
    remote.updatedAt = '2026-11-23T09:00:00.000Z';

    const result = mergeWorkspaces3Way(base, local, remote);
    const mergedCol = result.workspace.classes[0].tabs[0].columns.find((c) => c.id === targetColId)!;
    expect(mergedCol.width).toBe(80);
    expect(mergedCol.lomloeCriteriaIds).toEqual(['1.1', '5.1']);
  });

  it('syncs data ONLY while keeping active screen, widths, rowHeight, zoom and collapsed state independent per device', () => {
    const base = createSeedWorkspace();
    const local = structuredClone(base);
    const remote = structuredClone(base);

    // Local iPad state: viewing class 0, tab 0, zoom 1.3, rowHeight 36, col width 80
    local.activeClassId = local.classes[0].id;
    local.activeTabByBook[local.classes[0].id] = local.classes[0].tabs[0].id;
    local.settings.gridZoom = 1.3;
    local.settings.rowHeight = 36;
    local.settings.sidebarVisible = false;
    local.classes[0].tabs[0].columns[0].width = 80;
    local.classes[0].groupSpacerRows = 2;
    if (local.classes[0].tabs[0].folders[0]) {
      local.classes[0].tabs[0].folders[0].isCollapsed = true;
      local.classes[0].tabs[0].folders[0].width = 72;
    }

    // Remote Mac state: viewing class 1, different tab, zoom 0.9, rowHeight 60, col width 150, newer timestamp + data edit
    remote.activeClassId = remote.classes[1].id;
    remote.activeTabByBook[remote.classes[0].id] = remote.classes[0].tabs[1]?.id ?? remote.classes[0].tabs[0].id;
    remote.settings.gridZoom = 0.9;
    remote.settings.rowHeight = 60;
    remote.settings.sidebarVisible = true;
    remote.classes[0].tabs[0].columns[0].width = 150;
    remote.classes[0].tabs[0].columns[0].title = 'Nuevo Título';
    remote.classes[0].groupSpacerRows = 0;
    if (remote.classes[0].tabs[0].folders[0]) {
      remote.classes[0].tabs[0].folders[0].isCollapsed = false;
      remote.classes[0].tabs[0].folders[0].width = 110;
    }
    const st = remote.classes[0].students[0];
    const col = remote.classes[0].tabs[0].columns[0];
    remote.classes[0].cells[cellKey(st.id, col.id)] = { grade: 9.5, comment: 'Sincronizado' };
    remote.updatedAt = '2026-11-23T14:00:00.000Z';

    // Test both 3-way merge and fast remote-accept path
    const merged = mergeWorkspaces3Way(base, local, remote).workspace;
    const fastAccepted = preserveDeviceLocalLayoutAndNav(remote, local);

    for (const out of [merged, fastAccepted]) {
      // Data synced
      expect(out.classes[0].tabs[0].columns[0].title).toBe('Nuevo Título');
      expect(out.classes[0].cells[cellKey(st.id, col.id)]?.grade).toBe(9.5);
      // Device-local layout & active screens untouched
      expect(out.activeClassId).toBe(local.classes[0].id);
      expect(out.activeTabByBook[local.classes[0].id]).toBe(local.classes[0].tabs[0].id);
      expect(out.settings.gridZoom).toBe(1.3);
      expect(out.settings.rowHeight).toBe(36);
      expect(out.settings.sidebarVisible).toBe(false);
      expect(out.classes[0].tabs[0].columns[0].width).toBe(80);
      expect(out.classes[0].groupSpacerRows).toBe(2);
      if (local.classes[0].tabs[0].folders[0]) {
        expect(out.classes[0].tabs[0].folders[0].isCollapsed).toBe(true);
        expect(out.classes[0].tabs[0].folders[0].width).toBe(72);
      }
    }
  });

  it('merges class group categories, group definitions, student assignments, active category and groupByGroups across devices without losing either side', () => {
    const base = createSeedWorkspace();
    const cls = base.classes[0];
    const st0 = cls.students[0];
    const st1 = cls.students[1];
    const st2 = cls.students[2];

    // Base already has default group category with st0 assigned
    base.classes[0].groupByGroups = false;
    base.classes[0].groups = [
      { id: 'grp-a', name: 'Equipo A', color: '#DBEAFE', orderIndex: 0 },
    ];
    base.classes[0].groupCategories = [
      {
        id: 'cat-default',
        name: 'Grupos de clase',
        groups: [{ id: 'grp-a', name: 'Equipo A', color: '#DBEAFE', orderIndex: 0 }],
        assignments: { [st0.id]: 'Equipo A' },
      },
    ];
    base.classes[0].activeGroupCategoryId = 'cat-default';
    base.classes[0].students[0].group = 'Equipo A';

    // Device 1 (local iPad, offline): adds Equipo B, assigns st1, turns ON groupByGroups
    const localIpad = structuredClone(base);
    localIpad.classes[0].groupByGroups = true;
    localIpad.classes[0].groupCategories![0].groups.push({
      id: 'grp-b',
      name: 'Equipo B',
      color: '#DCFCE7',
      orderIndex: 1,
    });
    localIpad.classes[0].groupCategories![0].assignments[st1.id] = 'Equipo B';
    localIpad.classes[0].groups = structuredClone(localIpad.classes[0].groupCategories![0].groups);
    localIpad.classes[0].students[1].group = 'Equipo B';
    localIpad.updatedAt = '2026-11-24T08:00:00.000Z';

    // Device 2 (remote Mac, offline): creates a new category "Talleres", assigns st2 in cat-default, selects "Talleres"
    const remoteMac = structuredClone(base);
    remoteMac.classes[0].groupCategories![0].assignments[st2.id] = 'Equipo A';
    remoteMac.classes[0].students[2].group = 'Equipo A';
    remoteMac.classes[0].groupCategories!.push({
      id: 'cat-talleres',
      name: 'Talleres',
      groups: [{ id: 'grp-t1', name: 'Mesa 1', color: '#FEF3C7', orderIndex: 0 }],
      assignments: { [st0.id]: 'Mesa 1', [st1.id]: 'Mesa 1' },
    });
    remoteMac.classes[0].activeGroupCategoryId = 'cat-talleres';
    remoteMac.updatedAt = '2026-11-24T08:05:00.000Z';

    const result = mergeWorkspaces3Way(base, localIpad, remoteMac);
    const mergedBook = result.workspace.classes[0];

    expect(result.hadDivergence).toBe(true);
    expect(mergedBook.groupByGroups).toBe(true);
    expect(mergedBook.activeGroupCategoryId).toBe('cat-talleres');
    expect(mergedBook.groupCategories?.map((c) => c.id)).toEqual(['cat-default', 'cat-talleres']);

    const defaultCat = mergedBook.groupCategories!.find((c) => c.id === 'cat-default')!;
    expect(defaultCat.groups.map((g) => g.name)).toEqual(['Equipo A', 'Equipo B']);
    expect(defaultCat.assignments).toEqual({
      [st0.id]: 'Equipo A',
      [st1.id]: 'Equipo B',
      [st2.id]: 'Equipo A',
    });
    expect(mergedBook.students.find((s) => s.id === st1.id)?.group).toBe('Equipo B');
    expect(mergedBook.students.find((s) => s.id === st2.id)?.group).toBe('Equipo A');

    const talleresCat = mergedBook.groupCategories!.find((c) => c.id === 'cat-talleres')!;
    expect(talleresCat.groups.map((g) => g.name)).toEqual(['Mesa 1']);
    expect(talleresCat.assignments).toEqual({ [st0.id]: 'Mesa 1', [st1.id]: 'Mesa 1' });
  });

  it('preserves remote groupCategories when local device had uninitialized groupCategories and newer timestamp without base', () => {
    const legacyLocal = createSeedWorkspace();
    legacyLocal.classes[0].groupCategories = undefined;
    legacyLocal.classes[0].groups = undefined;
    legacyLocal.classes[0].groupByGroups = false;
    legacyLocal.updatedAt = '2026-11-24T09:10:00.000Z';

    const remoteWithGroups = createSeedWorkspace();
    const st0 = remoteWithGroups.classes[0].students[0];
    remoteWithGroups.classes[0].groupByGroups = true;
    remoteWithGroups.classes[0].groupCategories = [
      {
        id: 'cat-default',
        name: 'Grupos de clase',
        groups: [{ id: 'grp-1', name: 'Grupo Alfa', color: '#FCE7F3', orderIndex: 0 }],
        assignments: { [st0.id]: 'Grupo Alfa' },
      },
      {
        id: 'cat-debates',
        name: 'Debates',
        groups: [{ id: 'grp-d1', name: 'A favor', color: '#DCFCE7', orderIndex: 0 }],
        assignments: { [st0.id]: 'A favor' },
      },
    ];
    remoteWithGroups.classes[0].activeGroupCategoryId = 'cat-debates';
    remoteWithGroups.updatedAt = '2026-11-24T09:00:00.000Z';

    const result = mergeWorkspaces3Way(null, legacyLocal, remoteWithGroups);
    const mergedBook = result.workspace.classes[0];

    expect(mergedBook.groupCategories?.map((c) => c.id)).toContain('cat-debates');
    expect(mergedBook.activeGroupCategoryId).toBe('cat-debates');
    expect(
      mergedBook.groupCategories?.find((c) => c.id === 'cat-debates')?.assignments[st0.id]
    ).toBe('A favor');
  });

  it('syncs globalSummaryRows from merged books across devices', () => {
    const base = createSeedWorkspace();
    const local = structuredClone(base);
    const remote = structuredClone(base);

    const updatedRows = ['MEDIAN', 'MAX', 'PASS_PCT'] as const;
    remote.updatedAt = '2026-11-24T13:30:00.000Z';
    remote.classes = remote.classes.map((c) => ({ ...c, summaryRows: [...updatedRows] }));
    remote.templates = remote.templates.map((t) => ({ ...t, summaryRows: [...updatedRows] }));
    remote.settings = { ...remote.settings, globalSummaryRows: [...updatedRows] };

    const merged = mergeWorkspaces3Way(base, local, remote);
    expect(merged.workspace.classes.every((c) => c.summaryRows?.join(',') === updatedRows.join(','))).toBe(true);
    expect(merged.workspace.settings.globalSummaryRows).toEqual([...updatedRows]);

    const preserved = preserveDeviceLocalLayoutAndNav(remote, local);
    expect(preserved.settings.globalSummaryRows).toEqual([...updatedRows]);
  });
});
