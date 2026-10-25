import type { LucideIcon } from 'lucide-react';

interface IconProps {
  /** The lucide icon component, e.g. `MapPin`. */
  as: LucideIcon;
  /** Accessible name. Without it the icon is decorative (`aria-hidden`). */
  label?: string;
  size?: number;
  className?: string;
}

export function Icon({ as: Glyph, label, size = 20, className }: IconProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return <Glyph strokeWidth={1.5} size={size} {...(className ? { className } : {})} {...a11y} />;
}
