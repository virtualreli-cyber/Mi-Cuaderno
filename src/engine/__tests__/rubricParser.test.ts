import { describe, expect, it } from 'vitest';
import { DEFAULT_RUBRIC_IMPORT_TEMPLATE, parseRubricFromText } from '../rubricParser';

describe('rubricParser', () => {
  it('parses DEFAULT_RUBRIC_IMPORT_TEMPLATE with title, levels (highest left to lowest right), criteria weights, and descriptors', () => {
    const res = parseRubricFromText(DEFAULT_RUBRIC_IMPORT_TEMPLATE);
    expect(res.errors).toEqual([]);
    expect(res.rubric).not.toBeNull();
    const r = res.rubric!;
    expect(r.title).toBe('Exposición Oral (Ejemplo)');
    expect(r.minScore).toBe(0);
    expect(r.maxScore).toBe(10);
    expect(r.levels.map((l) => l.percentage)).toEqual([100, 75, 50, 0]);
    expect(r.levels[0].title).toBe('Excelente');
    expect(r.levels[3].title).toBe('Insuficiente');
    expect(r.criteria.map((c) => c.title)).toEqual([
      'Dominio del tema',
      'Expresión oral',
      'Material visual',
    ]);
    expect(r.criteria.map((c) => c.weight)).toEqual([40, 30, 30]);
    const c0 = r.criteria[0];
    const l0 = r.levels[0];
    expect(r.descriptors[`${c0.id}::${l0.id}`]).toContain('seguridad');
  });

  it('parses Markdown and TSV tables even without explicit % and reorders levels highest-left', () => {
    const md = `| Criterio | Bajo (20%) | Alto (100%) | Medio (60%) |
| --- | --- | --- | --- |
| Ortografía | Muchos errores | Sin errores | Pocos errores |
| Presentación | Desordenada | Impecable | Correcta |`;
    const res = parseRubricFromText(md);
    expect(res.errors).toEqual([]);
    const r = res.rubric!;
    expect(r.levels.map((l) => l.percentage)).toEqual([100, 60, 20]);
    expect(r.levels.map((l) => l.title)).toEqual(['Alto', 'Medio', 'Bajo']);
    expect(r.criteria.map((c) => c.weight)).toEqual([50, 50]);
    expect(r.descriptors[`${r.criteria[0].id}::${r.levels[0].id}`]).toBe('Sin errores');
  });

  it('parses tab-separated tables pasted from Excel/Sheets', () => {
    const tsv = [
      'Nombre: Trabajo en grupo',
      'Criterio\tSobresaliente (100%)\tBien (70%)\tInsuficiente (0%)',
      'Participación (50%)\tSiempre aporta\tAporta a veces\tNo participa',
      'Respeto (50%)\tEscucha siempre\tRespeta casi siempre\tInterrumpe',
    ].join('\n');
    const res = parseRubricFromText(tsv);
    expect(res.errors).toEqual([]);
    const r = res.rubric!;
    expect(r.title).toBe('Trabajo en grupo');
    expect(r.criteria).toHaveLength(2);
    expect(r.levels).toHaveLength(3);
  });

  it('returns clear Spanish error on empty text', () => {
    const res = parseRubricFromText('   ');
    expect(res.rubric).toBeNull();
    expect(res.errors.length).toBeGreaterThan(0);
  });
});
