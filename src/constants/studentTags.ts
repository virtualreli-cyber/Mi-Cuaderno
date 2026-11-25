export type StudentTagIconName =
  | 'Puzzle'
  | 'HeartHandshake'
  | 'AlertTriangle'
  | 'Compass'
  | 'CalendarClock'
  | 'HeartPulse'
  | 'Languages'
  | 'Sparkles'
  | 'Tag';

export type StudentTagId =
  | 'NEAE'
  | 'PERSONAL'
  | 'CONDUCTA'
  | 'SEGUIMIENTO'
  | 'ASISTENCIA'
  | 'SALUD'
  | 'IDIOMA'
  | 'DESTACA';

export interface StudentTagDef {
  id: StudentTagId;
  label: string;
  shortLabel: string;
  description: string;
  iconName: StudentTagIconName;
  /** Text & icon color (high contrast on bgColor) */
  color: string;
  /** Soft pastel badge fill */
  bgColor: string;
  /** Subtle border tint */
  borderColor: string;
}

/**
 * Curated, concise set of 8 teacher-attention tags covering key classroom circumstances.
 * Designed to stay discreet and scannable as compact icons in the student row, full chips
 * in the private notes column, and selectable pills in the student modal.
 */
export const STUDENT_TAG_CATALOG: readonly StudentTagDef[] = [
  {
    id: 'NEAE',
    label: 'NEAE / Adaptación',
    shortLabel: 'NEAE',
    description:
      'Necesidades específicas de apoyo educativo, ACIS, PT, TDAH, dislexia o adaptación metodológica/de evaluación.',
    iconName: 'Puzzle',
    color: '#6D28D9',
    bgColor: '#F3E8FF',
    borderColor: '#DDD6FE',
  },
  {
    id: 'PERSONAL',
    label: 'Situación personal',
    shortLabel: 'Personal',
    description:
      'Circunstancia familiar o emocional delicada que requiere especial sensibilidad y tacto en el trato.',
    iconName: 'HeartHandshake',
    color: '#BE123C',
    bgColor: '#FFE4E6',
    borderColor: '#FECDD3',
  },
  {
    id: 'CONDUCTA',
    label: 'Conducta / Convivencia',
    shortLabel: 'Conducta',
    description:
      'Atención en el aula, disrupción, conflictos de convivencia o seguimiento conductual.',
    iconName: 'AlertTriangle',
    color: '#B45309',
    bgColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  {
    id: 'SEGUIMIENTO',
    label: 'Refuerzo académico',
    shortLabel: 'Refuerzo',
    description:
      'Dificultad académica, seguimiento cercano, repetidor o riesgo de no superar la materia.',
    iconName: 'Compass',
    color: '#1D4ED8',
    bgColor: '#DBEAFE',
    borderColor: '#BFDBFE',
  },
  {
    id: 'ASISTENCIA',
    label: 'Asistencia / Retrasos',
    shortLabel: 'Asistencia',
    description: 'Absentismo, faltas de asistencia recurrentes o retrasos frecuentes.',
    iconName: 'CalendarClock',
    color: '#C2410C',
    bgColor: '#FFEDD5',
    borderColor: '#FED7AA',
  },
  {
    id: 'SALUD',
    label: 'Salud / Médico',
    shortLabel: 'Salud',
    description:
      'Alergias, medicación, necesidades de visión/audición (sentar delante) o consideración médica.',
    iconName: 'HeartPulse',
    color: '#0F766E',
    bgColor: '#CCFBF1',
    borderColor: '#99F6E4',
  },
  {
    id: 'IDIOMA',
    label: 'Apoyo lingüístico',
    shortLabel: 'Idioma',
    description: 'Incorporación tardía o apoyo necesario con el idioma vehicular.',
    iconName: 'Languages',
    color: '#0369A1',
    bgColor: '#E0F2FE',
    borderColor: '#BAE6FD',
  },
  {
    id: 'DESTACA',
    label: 'Altas cap. / Referente',
    shortLabel: 'Destaca',
    description:
      'Altas capacidades, participación destacada, delegado/a o alumno/a referente para apoyo entre iguales.',
    iconName: 'Sparkles',
    color: '#047857',
    bgColor: '#D1FAE5',
    borderColor: '#A7F3D0',
  },
] as const;

export interface ResolvedStudentTag {
  rawKey: string;
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  iconName: StudentTagIconName;
  color: string;
  bgColor: string;
  borderColor: string;
  isCustom: boolean;
}

const CATALOG_BY_UPPER = new Map<string, StudentTagDef>(
  STUDENT_TAG_CATALOG.map((t) => [t.id.toUpperCase(), t])
);

const LEGACY_ALIASES: Record<string, StudentTagId> = {
  SEGUIMIENTO: 'SEGUIMIENTO',
  REFUERZO: 'SEGUIMIENTO',
  NEAE: 'NEAE',
  ACIS: 'NEAE',
  PERSONAL: 'PERSONAL',
  FAMILIA: 'PERSONAL',
  CONDUCTA: 'CONDUCTA',
  COMPORTAMIENTO: 'CONDUCTA',
  ASISTENCIA: 'ASISTENCIA',
  ABSENTISMO: 'ASISTENCIA',
  SALUD: 'SALUD',
  MEDICO: 'SALUD',
  MÉDICO: 'SALUD',
  IDIOMA: 'IDIOMA',
  DESTACA: 'DESTACA',
  PARTICIPATIVA: 'DESTACA',
  PARTICIPATIVO: 'DESTACA',
  DELEGADA: 'DESTACA',
  DELEGADO: 'DESTACA',
};

/**
 * Resolves any stored tag key (canonical catalog ID, legacy Spanish label, or custom string)
 * into a structured descriptor with icon, accessible label, and soft pastel palette.
 */
export function resolveStudentTag(rawTag: string): ResolvedStudentTag {
  const cleaned = rawTag.trim();
  const upper = cleaned.toUpperCase();
  const direct = CATALOG_BY_UPPER.get(upper);
  if (direct) {
    return {
      rawKey: rawTag,
      ...direct,
      isCustom: false,
    };
  }
  const aliasId = LEGACY_ALIASES[upper];
  if (aliasId) {
    const def = CATALOG_BY_UPPER.get(aliasId)!;
    return {
      rawKey: rawTag,
      ...def,
      // Keep original legacy label visible if it differs meaningfully (e.g., "Delegada")
      shortLabel:
        upper === 'DELEGADA' || upper === 'DELEGADO' ? cleaned : def.shortLabel,
      label:
        upper === 'DELEGADA' || upper === 'DELEGADO'
          ? `${cleaned} (${def.label})`
          : def.label,
      isCustom: false,
    };
  }
  return {
    rawKey: rawTag,
    id: cleaned,
    label: cleaned,
    shortLabel: cleaned,
    description: cleaned,
    iconName: 'Tag',
    color: '#475569',
    bgColor: '#F1F5F9',
    borderColor: '#CBD5E1',
    isCustom: true,
  };
}

/**
 * Checks whether a student's `tags` array already contains a given canonical catalog tag
 * (accounting for canonical IDs and case-insensitive legacy aliases).
 */
export function hasCatalogTag(tags: readonly string[] | undefined, targetId: StudentTagId): boolean {
  if (!tags || tags.length === 0) return false;
  return tags.some((t) => {
    const upper = t.trim().toUpperCase();
    return upper === targetId || LEGACY_ALIASES[upper] === targetId;
  });
}

/**
 * Toggles a canonical catalog tag inside a student's `tags` array, normalizing any matching
 * legacy alias cleanly so duplicates never accumulate.
 */
export function toggleCatalogTag(
  tags: readonly string[] | undefined,
  targetId: StudentTagId
): string[] {
  const current = [...(tags ?? [])];
  if (hasCatalogTag(current, targetId)) {
    return current.filter((t) => {
      const upper = t.trim().toUpperCase();
      return upper !== targetId && LEGACY_ALIASES[upper] !== targetId;
    });
  }
  return [...current, targetId];
}

/**
 * Deduplicates and resolves all tags of a student for crisp rendering.
 */
export function resolveStudentTags(tags: readonly string[] | undefined): ResolvedStudentTag[] {
  if (!tags || tags.length === 0) return [];
  const seen = new Set<string>();
  const out: ResolvedStudentTag[] = [];
  for (const raw of tags) {
    const cleaned = raw.trim();
    if (!cleaned) continue;
    const resolved = resolveStudentTag(cleaned);
    const dedupeKey = resolved.isCustom ? `custom:${cleaned.toLowerCase()}` : `cat:${resolved.id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(resolved);
  }
  return out;
}
