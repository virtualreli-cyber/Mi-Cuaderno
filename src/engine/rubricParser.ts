import { makeId, normalizeRubricLevels } from './gradeMath';
import type { RubricCriterion, RubricEntity, RubricLevel } from '../types/gradebook';

export const DEFAULT_RUBRIC_IMPORT_TEMPLATE = `Título: Exposición Oral (Ejemplo)
Nota mínima: 0
Nota máxima: 10

Criterio (Peso %) | Excelente (100%) | Notable (75%) | Suficiente (50%) | Insuficiente (0%)
Dominio del tema (40%) | Expone con total seguridad, rigor y sin leer apuntes. | Explica bien las ideas principales con algún apoyo puntual. | Conoce lo básico pero duda o depende mucho del guion. | Información muy incompleta o errónea.
Expresión oral (30%) | Voz clara, buen ritmo y contacto visual continuo. | Se entiende bien y mantiene un ritmo adecuado. | Voz algo baja o monótona en varios tramos. | Cuesta entenderle o lee todo el texto sin pausa.
Material visual (30%) | Presentación limpia, visual y muy útil para seguir la charla. | Buenas diapositivas aunque con algo de texto extra. | Apoyo visual correcto pero poco elaborado. | Sin material de apoyo o diapositivas ilegibles.`;

export interface RubricParseResult {
  rubric: RubricEntity | null;
  errors: string[];
  warnings: string[];
}

function parseLocaleNumber(raw: string): number | null {
  const n = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Extracts a title and optional numeric weight/percentage from a header like
 * "Excelente (100%)", "Dominio del tema [40 %]", or "75%".
 */
function extractLabelAndPct(rawCell: string): { title: string; pct: number | null } {
  const text = rawCell.trim();
  // Try parenthesized/bracketed percentage at the end: "Excelente (100%)" or "Excelente (100)"
  const parenMatch = /^(.*?)\s*[\(\[]\s*(\d+(?:[.,]\d+)?)\s*%?\s*[\)\]]\s*$/.exec(text);
  if (parenMatch) {
    const num = parseLocaleNumber(parenMatch[2]);
    if (num !== null) {
      return {
        title: parenMatch[1].trim() || `${num}%`,
        pct: num,
      };
    }
  }
  // Try trailing percentage token: "Excelente 100%" or "100%"
  const pctMatch = /^(.*?)\s*(\d+(?:[.,]\d+)?)\s*%\s*$/.exec(text);
  if (pctMatch) {
    const num = parseLocaleNumber(pctMatch[2]);
    if (num !== null) {
      return {
        title: pctMatch[1].trim() || `${num}%`,
        pct: num,
      };
    }
  }
  return { title: text, pct: null };
}

function splitTableRow(line: string, delimiter: '\t' | '|' | ';'): string[] {
  let working = line.trim();
  if (delimiter === '|') {
    if (working.startsWith('|')) working = working.slice(1);
    if (working.endsWith('|')) working = working.slice(0, -1);
  }
  return working.split(delimiter).map((c) => c.trim());
}

function isMarkdownDividerRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  const cleaned = trimmed.replace(/\|/g, '').trim();
  return /^[:\-\s]+$/.test(cleaned);
}

function detectDelimiter(lines: string[]): '\t' | '|' | ';' | null {
  const sample = lines.slice(0, Math.min(6, lines.length));
  const count = (ch: string) =>
    sample.reduce((acc, l) => acc + (l.split(ch).length - 1), 0);
  const tabs = count('\t');
  const pipes = count('|');
  const semis = count(';');
  if (tabs >= 2 && tabs >= pipes) return '\t';
  if (pipes >= 2) return '|';
  if (semis >= 2) return ';';
  return null;
}

function distributeMissingWeights(rawWeights: Array<number | null>): number[] {
  const count = rawWeights.length;
  if (count === 0) return [];
  const hasAny = rawWeights.some((w) => w !== null && w > 0);
  if (!hasAny) {
    const base = Math.floor((100 / count) * 100) / 100;
    return rawWeights.map((_, idx) =>
      idx === count - 1 ? Number((100 - base * (count - 1)).toFixed(2)) : base
    );
  }
  const missingIdx = rawWeights
    .map((w, idx) => (w === null ? idx : -1))
    .filter((idx) => idx >= 0);
  const explicitSum = rawWeights.reduce<number>((s, w) => s + (w !== null ? Math.max(0, w) : 0), 0);
  if (missingIdx.length === 0) {
    return rawWeights.map((w) => Math.max(0, w ?? 0));
  }
  const rem = Math.max(0, 100 - explicitSum);
  const perMissing = Number((rem / missingIdx.length).toFixed(2));
  return rawWeights.map((w) => (w !== null ? Math.max(0, w) : perMissing));
}

function buildLevels(parsedHeaders: Array<{ title: string; pct: number | null }>): RubricLevel[] {
  const n = parsedHeaders.length;
  const anyMissingPct = parsedHeaders.some((h) => h.pct === null);
  return normalizeRubricLevels(
    parsedHeaders.map((h, idx) => {
      const autoPct = n > 1 ? Math.round(((n - 1 - idx) / (n - 1)) * 100) : 100;
      return {
        id: makeId('lvl'),
        title: h.title || `Nivel ${idx + 1}`,
        percentage: Math.max(0, Math.min(100, anyMissingPct && h.pct === null ? autoPct : (h.pct ?? autoPct))),
        color: '',
      };
    })
  );
}

/**
 * Parses a rubric copied from Markdown, Word/Excel/TSV tables, CSV-with-semicolon,
 * or structured plain text ("Criterio..." + "- Nivel (100%): descriptor").
 */
export function parseRubricFromText(rawText: string): RubricParseResult {
  const lines = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      rubric: null,
      errors: ['El cuadro de texto está vacío.'],
      warnings: [],
    };
  }

  let title = '';
  let description = '';
  let minScore = 0;
  let maxScore = 10;
  let decimals = 2;
  const warnings: string[] = [];
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (bodyLines.length === 0) {
      const mTitle = /^(?:t[ií]tulo|nombre(?:\s+de\s+la\s+r[uú]brica)?)\s*:\s*(.+)$/i.exec(line);
      if (mTitle) {
        title = mTitle[1].trim();
        continue;
      }
      const mDesc = /^(?:descripci[oó]n)\s*:\s*(.+)$/i.exec(line);
      if (mDesc) {
        description = mDesc[1].trim();
        continue;
      }
      const mMin = /^(?:nota\s*m[ií]n(?:ima)?|m[ií]nimo|min)\s*:\s*([+-]?\d+(?:[.,]\d+)?)$/i.exec(
        line
      );
      if (mMin) {
        minScore = parseLocaleNumber(mMin[1]) ?? 0;
        continue;
      }
      const mMax = /^(?:nota\s*m[aá]x(?:ima)?|m[aá]ximo|max)\s*:\s*([+-]?\d+(?:[.,]\d+)?)$/i.exec(
        line
      );
      if (mMax) {
        maxScore = parseLocaleNumber(mMax[1]) ?? 10;
        continue;
      }
      const mDec = /^(?:decimales)\s*:\s*(\d+)$/i.exec(line);
      if (mDec) {
        decimals = Math.max(0, Math.min(3, Number(mDec[1])));
        continue;
      }
    }
    if (isMarkdownDividerRow(line)) continue;
    bodyLines.push(line);
  }

  if (maxScore <= minScore) {
    maxScore = minScore + 10;
    warnings.push('Nota máxima ajustada para ser mayor que la mínima.');
  }

  if (bodyLines.length < 2) {
    return {
      rubric: null,
      errors: [
        'Se necesita al menos una fila de cabecera con los niveles de logro y una fila con un criterio.',
      ],
      warnings,
    };
  }

  const delimiter = detectDelimiter(bodyLines);
  if (delimiter) {
    const rows = bodyLines
      .map((l) => splitTableRow(l, delimiter))
      .filter((cells) => cells.some((c) => c.length > 0));

    const headerCells = rows[0];
    if (!headerCells || headerCells.length < 3) {
      return {
        rubric: null,
        errors: [
          'La cabecera de la tabla debe tener la columna de criterio y al menos 2 columnas de niveles (ej.: Criterio | Excelente (100%) | Insuficiente (0%)).',
        ],
        warnings,
      };
    }

    const rawLevelHeaders = headerCells.slice(1).map(extractLabelAndPct);
    const anyLevelMissingPct = rawLevelHeaders.some((h) => h.pct === null);
    if (anyLevelMissingPct) {
      warnings.push('Algunos niveles no indicaban %: se han calculado porcentajes automáticos.');
    }

    const nLevels = rawLevelHeaders.length;
    const rawLevels = rawLevelHeaders.map((h, idx) => {
      const autoPct = nLevels > 1 ? Math.round(((nLevels - 1 - idx) / (nLevels - 1)) * 100) : 100;
      return {
        id: makeId('lvl'),
        title: h.title || `Nivel ${idx + 1}`,
        percentage: Math.max(0, Math.min(100, h.pct ?? autoPct)),
        color: '',
      };
    });

    const dataRows = rows.slice(1);
    if (dataRows.length === 0) {
      return {
        rubric: null,
        errors: ['No se encontraron filas de criterios debajo de la cabecera.'],
        warnings,
      };
    }

    const parsedCriteria = dataRows.map((cells, idx) => {
      const { title: critTitle, pct } = extractLabelAndPct(cells[0] || `Criterio ${idx + 1}`);
      return {
        id: makeId('crit'),
        title: critTitle || `Criterio ${idx + 1}`,
        rawWeight: pct,
        rawDescriptors: rawLevels.map((lvl, lIdx) => ({
          levelId: lvl.id,
          text: cells[lIdx + 1] ?? '',
        })),
      };
    });

    const finalWeights = distributeMissingWeights(parsedCriteria.map((c) => c.rawWeight));
    const criteria: RubricCriterion[] = parsedCriteria.map((c, idx) => ({
      id: c.id,
      title: c.title,
      weight: finalWeights[idx],
    }));

    const descriptors: Record<string, string> = {};
    for (const c of parsedCriteria) {
      for (const d of c.rawDescriptors) {
        if (d.text.trim()) {
          descriptors[`${c.id}::${d.levelId}`] = d.text.trim();
        }
      }
    }

    const levels = normalizeRubricLevels(rawLevels);

    return {
      rubric: {
        id: makeId('rub'),
        title: title || 'Rúbrica importada',
        description: description || undefined,
        minScore,
        maxScore,
        decimals,
        levels,
        criteria,
        descriptors,
      },
      errors: [],
      warnings,
    };
  }

  // Fallback: block text parser ("Criterio..." followed by "- Nivel (100%): descriptor")
  interface BlockCrit {
    title: string;
    weight: number | null;
    entries: Array<{ levelTitle: string; pct: number | null; text: string }>;
  }
  const blocks: BlockCrit[] = [];
  for (const line of bodyLines) {
    const levelBullet = /^(?:[-*•]+|\d+[.)])\s*([^:]+?)\s*:\s*(.+)$/.exec(line);
    if (levelBullet && blocks.length > 0) {
      const { title: lTitle, pct } = extractLabelAndPct(levelBullet[1]);
      blocks[blocks.length - 1].entries.push({
        levelTitle: lTitle,
        pct,
        text: levelBullet[2].trim(),
      });
      continue;
    }
    const cleanCritLine = line.replace(/^#+\s*/, '').replace(/^criterio\s*\d*\s*:\s*/i, '');
    const { title: cTitle, pct } = extractLabelAndPct(cleanCritLine);
    blocks.push({ title: cTitle || `Criterio ${blocks.length + 1}`, weight: pct, entries: [] });
  }

  const validBlocks = blocks.filter((b) => b.entries.length >= 2);
  if (validBlocks.length === 0) {
    return {
      rubric: null,
      errors: [
        'No se ha detectado una tabla ni bloques válidos. Usa "|" o tabulaciones entre columnas, igual que en el modelo de ejemplo.',
      ],
      warnings,
    };
  }

  const headerSamples = validBlocks[0].entries.map((e) => ({
    title: e.levelTitle,
    pct: e.pct,
  }));
  const levels = buildLevels(headerSamples);
  const rawLevelOrder = validBlocks[0].entries.map((e) => e.levelTitle.toLowerCase());
  const levelByLowerTitle = new Map<string, RubricLevel>();
  levels.forEach((lvl) => levelByLowerTitle.set(lvl.title.toLowerCase(), lvl));

  const weights = distributeMissingWeights(validBlocks.map((b) => b.weight));
  const criteria: RubricCriterion[] = validBlocks.map((b, idx) => ({
    id: makeId('crit'),
    title: b.title,
    weight: weights[idx],
  }));

  const descriptors: Record<string, string> = {};
  validBlocks.forEach((b, cIdx) => {
    const crit = criteria[cIdx];
    b.entries.forEach((e, eIdx) => {
      const matched =
        levelByLowerTitle.get(e.levelTitle.toLowerCase()) ??
        levelByLowerTitle.get(rawLevelOrder[eIdx] ?? '') ??
        levels[eIdx];
      if (matched && e.text) {
        descriptors[`${crit.id}::${matched.id}`] = e.text;
      }
    });
  });

  return {
    rubric: {
      id: makeId('rub'),
      title: title || 'Rúbrica importada',
      description: description || undefined,
      minScore,
      maxScore,
      decimals,
      levels,
      criteria,
      descriptors,
    },
    errors: [],
    warnings,
  };
}
