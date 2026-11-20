import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOMLOE_KEY_COMPETENCES,
  DEFAULT_LOMLOE_RELIGION_CURRICULA,
} from '../../data/lomloeReligion';
import {
  computeStudentLomloeStats,
  inferReligionCurriculumId,
  resolveBookCurriculum,
  resolveColumnLomloeSummary,
} from '../lomloe';
import type { ClassBook, ColumnEntity, TabEntity } from '../../types/gradebook';

describe('LOMLOE Religión Católica curriculum engine', () => {
  it('infers official cycle curricula by law from class names (1º ESO through 1º BAC)', () => {
    expect(inferReligionCurriculumId('1 ESO A - R', 'Religión')).toBe('lomloe-rel-eso-1-2');
    expect(inferReligionCurriculumId('2º ESO B - M', 'Religión')).toBe('lomloe-rel-eso-1-2');
    expect(inferReligionCurriculumId('3.º ESO A', 'Religión')).toBe('lomloe-rel-eso-3-4');
    expect(inferReligionCurriculumId('4.º ESO C', 'Historia')).toBe('lomloe-rel-eso-3-4');
    expect(inferReligionCurriculumId('3 ESO A - M', 'Religión')).toBe('lomloe-rel-eso-3-4');
    expect(inferReligionCurriculumId('4º ESO B - R', 'Religión')).toBe('lomloe-rel-eso-3-4');
    expect(inferReligionCurriculumId('1 BAC - R', 'Religión')).toBe('lomloe-rel-bac-1');
    expect(inferReligionCurriculumId('1.º Bach. B', 'Filosofía')).toBe('lomloe-rel-bac-1');
    expect(inferReligionCurriculumId('1.º Bachillerato', 'Religión')).toBe('lomloe-rel-bac-1');
  });

  it('respects explicit override or NONE on ClassBook', () => {
    const auto = resolveBookCurriculum(
      { name: '3 ESO A - R', subject: 'Religión' },
      DEFAULT_LOMLOE_RELIGION_CURRICULA
    );
    expect(auto?.id).toBe('lomloe-rel-eso-3-4');

    const disabled = resolveBookCurriculum(
      { name: '3 ESO A - R', subject: 'Religión', lomloeCurriculumId: 'NONE' },
      DEFAULT_LOMLOE_RELIGION_CURRICULA
    );
    expect(disabled).toBeNull();

    const manual = resolveBookCurriculum(
      { name: 'Grupo Taller', subject: '', lomloeCurriculumId: 'lomloe-rel-bac-1' },
      DEFAULT_LOMLOE_RELIGION_CURRICULA
    );
    expect(manual?.id).toBe('lomloe-rel-bac-1');
  });

  it('derives sorted criteria, specific competence numbers, and key competence badges', () => {
    const currEso34 = DEFAULT_LOMLOE_RELIGION_CURRICULA.find(
      (c) => c.id === 'lomloe-rel-eso-3-4'
    )!;
    const col: Pick<ColumnEntity, 'lomloeCriteriaIds'> = {
      lomloeCriteriaIds: ['5.1', '1.1'],
    };

    const summary = resolveColumnLomloeSummary(
      col,
      currEso34,
      DEFAULT_LOMLOE_KEY_COMPETENCES
    );

    expect(summary.criteriaCodes).toEqual(['1.1', '5.1']);
    expect(summary.specificNumbers).toEqual([1, 5]);
    // CE 1 = CCL, CD, CPSAA, CE, CCEC; CE 5 = CCL, CPSAA, CC, CE, CCEC -> sorted by number: 1,4,5,6,7,8
    expect(summary.keyCompetences.map((k) => k.code)).toEqual([
      'CCL',
      'CD',
      'CPSAA',
      'CC',
      'CE',
      'CCEC',
    ]);
  });

  it('supports criterion-level custom key competence overrides and student stats normalization', () => {
    const baseCurr = DEFAULT_LOMLOE_RELIGION_CURRICULA[0];
    const customCurr = {
      ...baseCurr,
      criteria: baseCurr.criteria.map((cr) =>
        cr.id === '1.1' ? { ...cr, keyCompetenceIds: ['CCL', 'CC'] } : cr
      ),
    };

    const tab: TabEntity = {
      id: 'tab-1',
      title: '1ª Ev',
      color: '#fff',
      orderIndex: 0,
      folders: [],
      columns: [
        {
          id: 'c1',
          folderId: null,
          title: 'Preguntas fundamentales',
          color: '#fff',
          width: 100,
          orderIndex: 0,
          type: 'NUMERIC',
          minValue: 0,
          maxValue: 10,
          decimals: 2,
          passThreshold: 5,
          colorMode: 'NONE',
          lomloeCriteriaIds: ['1.1'],
        },
        {
          id: 'c2',
          folderId: null,
          title: 'Trabajo 0-100',
          color: '#fff',
          width: 100,
          orderIndex: 1,
          type: 'NUMERIC',
          minValue: 0,
          maxValue: 100,
          decimals: 2,
          passThreshold: 50,
          colorMode: 'NONE',
          lomloeCriteriaIds: ['1.1', '5.1'],
        },
      ],
    };

    const cells: ClassBook['cells'] = {
      'st1::c1': { grade: 8, comment: '' },
      'st1::c2': { grade: 90, comment: '' }, // normalized to 9.0
    };

    const stats = computeStudentLomloeStats(
      'st1',
      [tab],
      cells,
      customCurr,
      DEFAULT_LOMLOE_KEY_COMPETENCES
    );

    expect(stats.byCriterion['1.1'].avg).toBeCloseTo(8.5);
    expect(stats.byCriterion['1.1'].count).toBe(2);
    expect(stats.byCriterion['5.1'].avg).toBeCloseTo(9.0);
    expect(stats.byKeyCompetence['CC'].avg).toBeCloseTo(8.5);
  });
});
