import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from '../../data/seedData';
import { cellKey } from '../../types/gradebook';
import { mergeWorkspaces3Way } from '../syncEngine';

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
});
