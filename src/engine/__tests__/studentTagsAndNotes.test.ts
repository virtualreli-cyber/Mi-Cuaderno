import { describe, expect, it } from 'vitest';
import {
  STUDENT_TAG_CATALOG,
  hasCatalogTag,
  resolveStudentTag,
  resolveStudentTags,
  toggleCatalogTag,
} from '../../constants/studentTags';
import { createSeedWorkspace } from '../../data/seedData';
import { hydrateWorkspace } from '../../services/storage';
import { mergeWorkspaces3Way, preserveDeviceLocalLayoutAndNav } from '../syncEngine';

describe('studentTags catalog & resolution', () => {
  it('provides 8 distinct curated tags with icons and descriptions', () => {
    expect(STUDENT_TAG_CATALOG).toHaveLength(8);
    const ids = new Set(STUDENT_TAG_CATALOG.map((t) => t.id));
    expect(ids.size).toBe(8);
    for (const tag of STUDENT_TAG_CATALOG) {
      expect(tag.label.trim().length).toBeGreaterThan(0);
      expect(tag.shortLabel.trim().length).toBeGreaterThan(0);
      expect(tag.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('resolves canonical tags, legacy aliases, and custom tags cleanly', () => {
    const neae = resolveStudentTag('NEAE');
    expect(neae.id).toBe('NEAE');
    expect(neae.isCustom).toBe(false);
    expect(neae.iconName).toBe('Puzzle');

    const legacyFollowUp = resolveStudentTag('Seguimiento');
    expect(legacyFollowUp.id).toBe('SEGUIMIENTO');
    expect(legacyFollowUp.isCustom).toBe(false);

    const legacyDelegate = resolveStudentTag('Delegada');
    expect(legacyDelegate.id).toBe('DESTACA');
    expect(legacyDelegate.shortLabel).toBe('Delegada');

    const custom = resolveStudentTag('Coro escolar');
    expect(custom.isCustom).toBe(true);
    expect(custom.iconName).toBe('Tag');
    expect(custom.label).toBe('Coro escolar');
  });

  it('toggles catalog tags while normalizing legacy aliases without duplicates', () => {
    expect(hasCatalogTag(['Seguimiento'], 'SEGUIMIENTO')).toBe(true);
    const afterRemove = toggleCatalogTag(['Seguimiento', 'Coro'], 'SEGUIMIENTO');
    expect(afterRemove).toEqual(['Coro']);

    const afterAdd = toggleCatalogTag(afterRemove, 'NEAE');
    expect(afterAdd).toEqual(['Coro', 'NEAE']);

    const resolved = resolveStudentTags(['NEAE', 'ACIS', 'Seguimiento', 'SEGUIMIENTO', 'Coro']);
    expect(resolved.map((r) => r.id)).toEqual(['NEAE', 'SEGUIMIENTO', 'Coro']);
  });
});

describe('ClassBook.notes & personal notes column settings persistence/sync', () => {
  it('hydrates ClassBook.notes and defaults notesColWidth to 300', () => {
    const ws = createSeedWorkspace();
    ws.classes[0].notes = 'Grupo muy participativo; revisar tiempos en pruebas escritas.';
    ws.settings.showNotesColumn = true;
    delete ws.settings.notesColWidth;

    const hydrated = hydrateWorkspace(JSON.parse(JSON.stringify(ws)));
    expect(hydrated).not.toBeNull();
    expect(hydrated!.classes[0].notes).toBe(
      'Grupo muy participativo; revisar tiempos en pruebas escritas.'
    );
    expect(hydrated!.settings.showNotesColumn).toBe(true);
    expect(hydrated!.settings.notesColWidth).toBe(300);
  });

  it('merges ClassBook.notes in 3-way sync while keeping notes column layout device-local', () => {
    const base = createSeedWorkspace();
    const local = structuredClone(base);
    const remote = structuredClone(base);

    // Local changes class note + toggles column open at 360px
    local.classes[0].notes = 'Recordar reunión con tutoría el jueves.';
    local.settings.showNotesColumn = true;
    local.settings.notesColWidth = 360;

    // Remote keeps notes column closed at 280px and edits a student note instead
    remote.settings.showNotesColumn = false;
    remote.settings.notesColWidth = 280;
    remote.classes[0].students[0].notes = 'Sentar en primera fila por visión.';
    remote.classes[0].students[0].tags = ['SALUD'];

    const merged = mergeWorkspaces3Way(base, local, remote);
    expect(merged.workspace.classes[0].notes).toBe('Recordar reunión con tutoría el jueves.');
    expect(merged.workspace.classes[0].students[0].notes).toBe(
      'Sentar en primera fila por visión.'
    );
    expect(merged.workspace.classes[0].students[0].tags).toEqual(['SALUD']);
    expect(merged.workspace.settings.showNotesColumn).toBe(true);
    expect(merged.workspace.settings.notesColWidth).toBe(360);

    // Incoming remote update must not overwrite device-local notes column visibility/width
    const applied = preserveDeviceLocalLayoutAndNav(remote, local);
    expect(applied.settings.showNotesColumn).toBe(true);
    expect(applied.settings.notesColWidth).toBe(360);
  });
});
