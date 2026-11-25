import React from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Compass,
  HeartHandshake,
  HeartPulse,
  Languages,
  Puzzle,
  Sparkles,
  Tag,
} from 'lucide-react';
import type { StudentTagIconName } from '../../constants/studentTags';

interface StudentTagIconProps {
  name: StudentTagIconName;
  className?: string;
  style?: React.CSSProperties;
}

export const StudentTagIcon: React.FC<StudentTagIconProps> = ({ name, className, style }) => {
  switch (name) {
    case 'Puzzle':
      return <Puzzle className={className} style={style} aria-hidden="true" />;
    case 'HeartHandshake':
      return <HeartHandshake className={className} style={style} aria-hidden="true" />;
    case 'AlertTriangle':
      return <AlertTriangle className={className} style={style} aria-hidden="true" />;
    case 'Compass':
      return <Compass className={className} style={style} aria-hidden="true" />;
    case 'CalendarClock':
      return <CalendarClock className={className} style={style} aria-hidden="true" />;
    case 'HeartPulse':
      return <HeartPulse className={className} style={style} aria-hidden="true" />;
    case 'Languages':
      return <Languages className={className} style={style} aria-hidden="true" />;
    case 'Sparkles':
      return <Sparkles className={className} style={style} aria-hidden="true" />;
    default:
      return <Tag className={className} style={style} aria-hidden="true" />;
  }
};
