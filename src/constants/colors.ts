export const PASTEL_SWATCHES: { name: string; hex: string }[] = [
  { name: 'Blanco', hex: '#FFFFFF' },
  { name: 'Gris Neutro', hex: '#D1D5DB' },
  { name: 'Gris Perla', hex: '#E2E8F0' },
  { name: 'Menta', hex: '#D1FAE5' },
  { name: 'Salvia', hex: '#DCFCE7' },
  { name: 'Lima Suave', hex: '#ECFCCB' },
  { name: 'Cielo', hex: '#DBEAFE' },
  { name: 'Azul Pastel', hex: '#BAE6FD' },
  { name: 'Lavanda', hex: '#EDE9FE' },
  { name: 'Rosa Pastel', hex: '#FCE7F3' },
  { name: 'Coral Suave', hex: '#FFE4E6' },
  { name: 'Melocotón', hex: '#FFEDD5' },
  { name: 'Crema', hex: '#FEF9C3' },
  { name: 'Amarillo Pastel', hex: '#FEF08A' },
];

export const SCHOOL_DEFAULT_COLORS: Record<string, string> = {
  Ribarroja: '#FCA5A5', // Rojo pastel
  Manises: '#93C5FD',   // Azul pastel
};

export const CLASS_ACCENT_SWATCHES = [
  '#FCA5A5', // Rojo pastel (Ribarroja)
  '#93C5FD', // Azul pastel (Manises)
  '#64748B',
  '#3B82F6',
  '#0D9488',
  '#10B981',
  '#84CC16',
  '#8B5CF6',
  '#EC4899',
  '#F59E0B',
];

const AVATAR_PASTELS = [
  '#DBEAFE',
  '#DCFCE7',
  '#EDE9FE',
  '#FCE7F3',
  '#FFEDD5',
  '#E0F2FE',
  '#ECFCCB',
  '#F1F5F9',
];

export function getAvatarBg(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PASTELS[Math.abs(hash) % AVATAR_PASTELS.length];
}

export function getInitials(firstName: string, lastName: string): string {
  const f = firstName.trim()[0] ?? '';
  const l = lastName.trim()[0] ?? '';
  return `${f}${l}`.toUpperCase() || 'AL';
}

export function blendWithWhite(hex: string | undefined, whiteRatio = 0.55): string {
  if (!hex || !hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) {
    return '#F8FAFC';
  }
  let full = hex;
  if (hex.length === 4) {
    full = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c * (1 - whiteRatio) + 255 * whiteRatio);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Generates an automatic pastel gradient color from pastel GREEN (highest score, left, rank 0)
 * through pastel yellow/peach to pastel RED (lowest score, right, rank total-1).
 */
export function getRubricLevelPastelColor(rankFromHighest: number, totalLevels: number): string {
  if (totalLevels <= 1) return hslToHex(138, 68, 87);
  // t = 1 at highest (left = pastel green), t = 0 at lowest (right = pastel red)
  const t = Math.max(0, Math.min(1, 1 - rankFromHighest / (totalLevels - 1)));
  // Piecewise hue interpolation: 0° (red) -> 48° (warm yellow at midpoint) -> 138° (green)
  const hue = t <= 0.5 ? (t / 0.5) * 48 : 48 + ((t - 0.5) / 0.5) * (138 - 48);
  const sat = t <= 0.5 ? 82 - t * 8 : 78 - (t - 0.5) * 16;
  const light = 88;
  return hslToHex(hue, sat, light);
}

/**
 * Conditional alert colors for grades:
 * - Below passThreshold (< 5): pastel red
 * - Below passThreshold + 1 (5.00 .. 5.99): pastel orange
 * - passThreshold + 1 or higher (>= 6): null (no conditional color)
 */
export function getGradeAlertColors(
  grade: number,
  passThreshold = 5
): { bgColor: string; bgTextColor: string; textColor: string } | null {
  if (grade < passThreshold) {
    return {
      bgColor: '#FCA5A5',
      bgTextColor: '#7F1D1D',
      textColor: '#DC2626',
    };
  }
  if (grade < passThreshold + 1) {
    return {
      bgColor: '#FED7AA',
      bgTextColor: '#9A3412',
      textColor: '#EA580C',
    };
  }
  return null;
}

export const GROUP_PASTEL_SWATCHES = [
  '#DBEAFE', // Cielo
  '#D1FAE5', // Menta
  '#EDE9FE', // Lavanda
  '#FFE4E6', // Coral
  '#FEF3C7', // Crema
  '#E0F2FE', // Hielo
  '#FCE7F3', // Rosa pastel
  '#FFEDD5', // Melocotón
  '#ECFCCB', // Lima suave
  '#E2E8F0', // Gris perla
];

export function getGroupDefaultColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33 + seed.charCodeAt(i)) | 0;
  }
  return GROUP_PASTEL_SWATCHES[Math.abs(hash) % GROUP_PASTEL_SWATCHES.length];
}
