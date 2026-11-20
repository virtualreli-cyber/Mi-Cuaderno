import React from 'react';
import {
  Atom,
  Award,
  BookOpen,
  Compass,
  Globe,
  HeartHandshake,
  Languages,
  Lightbulb,
  MessageSquareText,
  Monitor,
  Palette,
  Sparkles,
} from 'lucide-react';
import type { LomloeKeyCompetenceDef } from '../../types/gradebook';

export const LOMLOE_ICON_OPTIONS: { id: string; label: string }[] = [
  { id: 'MessageSquareText', label: 'Comunicación' },
  { id: 'Languages', label: 'Idiomas' },
  { id: 'Atom', label: 'Ciencia / STEM' },
  { id: 'Monitor', label: 'Digital' },
  { id: 'HeartHandshake', label: 'Social / Personal' },
  { id: 'Globe', label: 'Ciudadana' },
  { id: 'Lightbulb', label: 'Emprendedora' },
  { id: 'Palette', label: 'Cultura / Arte' },
  { id: 'BookOpen', label: 'Lectura' },
  { id: 'Compass', label: 'Orientación' },
  { id: 'Award', label: 'Logro' },
  { id: 'Sparkles', label: 'Sentido' },
];

export function renderLomloeIcon(iconName: string, className = 'w-3 h-3'): React.ReactNode {
  switch (iconName) {
    case 'MessageSquareText':
      return <MessageSquareText className={className} strokeWidth={2.3} />;
    case 'Languages':
      return <Languages className={className} strokeWidth={2.3} />;
    case 'Atom':
      return <Atom className={className} strokeWidth={2.3} />;
    case 'Monitor':
      return <Monitor className={className} strokeWidth={2.3} />;
    case 'HeartHandshake':
      return <HeartHandshake className={className} strokeWidth={2.3} />;
    case 'Globe':
      return <Globe className={className} strokeWidth={2.3} />;
    case 'Lightbulb':
      return <Lightbulb className={className} strokeWidth={2.3} />;
    case 'Palette':
      return <Palette className={className} strokeWidth={2.3} />;
    case 'BookOpen':
      return <BookOpen className={className} strokeWidth={2.3} />;
    case 'Compass':
      return <Compass className={className} strokeWidth={2.3} />;
    case 'Award':
      return <Award className={className} strokeWidth={2.3} />;
    default:
      return <Sparkles className={className} strokeWidth={2.3} />;
  }
}

interface LomloeCompetenceBadgeProps {
  competence: LomloeKeyCompetenceDef;
  sizePx?: number;
  showCode?: boolean;
  className?: string;
}

export const LomloeCompetenceBadge: React.FC<LomloeCompetenceBadgeProps> = ({
  competence,
  sizePx = 18,
  showCode = false,
  className = '',
}) => {
  const iconPx = Math.max(9, Math.round(sizePx * 0.56));
  const title = `${competence.number}. ${competence.code} — ${competence.name}`;

  if (showCode) {
    return (
      <span
        title={title}
        className={`inline-flex items-center gap-1 pr-1.5 pl-0.5 py-0.5 rounded-full text-[10px] font-bold text-slate-800 bg-white border border-slate-200 shadow-2xs ${className}`}
      >
        <span
          className="inline-flex items-center justify-center rounded-full text-white shrink-0 shadow-2xs"
          style={{
            width: `${sizePx}px`,
            height: `${sizePx}px`,
            backgroundColor: competence.color,
          }}
        >
          <span style={{ width: `${iconPx}px`, height: `${iconPx}px` }} className="flex items-center justify-center">
            {renderLomloeIcon(competence.iconName, 'w-full h-full')}
          </span>
        </span>
        <span>{competence.number}·{competence.code}</span>
      </span>
    );
  }

  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center rounded-full text-white shrink-0 ring-1 ring-white/80 shadow-2xs ${className}`}
      style={{
        width: `${sizePx}px`,
        height: `${sizePx}px`,
        backgroundColor: competence.color,
      }}
    >
      <span style={{ width: `${iconPx}px`, height: `${iconPx}px` }} className="flex items-center justify-center">
        {renderLomloeIcon(competence.iconName, 'w-full h-full')}
      </span>
    </span>
  );
};
