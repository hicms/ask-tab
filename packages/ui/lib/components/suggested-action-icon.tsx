import { cn } from '../utils';
import { isSuggestedActionIconId } from '@extension/storage';
import type { SuggestedActionIconId } from '@extension/storage';
import type { ReactNode } from 'react';

const iconArt: Record<SuggestedActionIconId, ReactNode> = {
  page: (
    <>
      <path d="M9 3.5h9l5 5V27a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" />
      <path d="M18 3.5v5h5M11 15h8M11 20h8M11 25h5" />
    </>
  ),
  sparkles: (
    <>
      <path d="m15.5 3 1.7 5.8L23 10.5l-5.8 1.7-1.7 5.8-1.7-5.8L8 10.5l5.8-1.7L15.5 3Z" />
      <path d="m24.5 18 1.1 3.4L29 22.5l-3.4 1.1-1.1 3.4-1.1-3.4-3.4-1.1 3.4-1.1 1.1-3.4ZM6 21l.8 2.2L9 24l-2.2.8L6 27l-.8-2.2L3 24l2.2-.8L6 21Z" />
    </>
  ),
  sun: (
    <>
      <circle cx="16" cy="16" r="5.5" />
      <path d="M16 2.5v4M16 25.5v4M2.5 16h4M25.5 16h4M6.45 6.45l2.8 2.8m13.5 13.5 2.8 2.8m0-19.1-2.8 2.8m-13.5 13.5-2.8 2.8" />
    </>
  ),
  palm: (
    <>
      <path d="M16 15c.4 4.5-.4 8.8-2 13M16 15c-4.1-4-8.1-4-12-2.5 3.8-.7 6.9.2 9 2.5M16 15c-1.5-5.5-5-7.5-9.5-7.5 3.2 2.2 5.5 4.7 6.7 7.5M16 15c1.5-5.5 5-7.5 9.5-7.5-3.2 2.2-5.5 4.7-6.7 7.5M16 15c4.1-4 8.1-4 12-2.5-3.8-.7-6.9.2-9 2.5M4 28c2.5-1.8 4.5-1.8 7 0 2.5-1.8 4.5-1.8 7 0 2.5-1.8 4.5-1.8 7 0" />
    </>
  ),
  code: (
    <>
      <rect x="3.5" y="5.5" width="25" height="21" rx="3" />
      <path d="m12.5 12-4 4 4 4m7-8 4 4-4 4m-2-10-3 12" />
    </>
  ),
  pen: (
    <>
      <path d="m19 4 9 9-11.5 14.5-9-9L19 4ZM19 4l-2.5 8.5L8 18.5M28 13l-8.5 2.5L17 27.5" />
      <circle cx="16" cy="16" r="1.4" />
      <path d="m6.5 25.5-2 2" />
    </>
  ),
  list: (
    <>
      <rect x="5" y="3.5" width="22" height="25" rx="3" />
      <path d="m9 11 1.5 1.5L13 10m4 1h6m-14 7 1.5 1.5L13 17m4 1h6m-14 7 1.5 1.5L13 24m4 1h6" />
    </>
  ),
  compass: (
    <>
      <circle cx="16" cy="16" r="12" />
      <circle cx="16" cy="16" r="1.5" />
      <path d="m20.5 11.5-3 6-6 3 3-6 6-3Z" />
    </>
  ),
  translate: (
    <>
      <path d="M4 6h15M11.5 3v3M7 10c2 4.8 5 8 9 10m-1-10c-1.3 5-4.8 8.8-9 11M19 14l-5 14m2-4h9m-6-10 6 14" />
    </>
  ),
  chart: (
    <>
      <path d="M5 27.5h23M7 22l6-6 5 3 8-10" />
      <path d="M21 9h5v5M7 8v3m6-6v5m6-5v2" />
      <circle cx="7" cy="22" r="1" />
      <circle cx="13" cy="16" r="1" />
    </>
  ),
  book: (
    <>
      <path d="M16 27c-3.5-2.5-7.5-3-12-2V5c4.5-1 8.5-.5 12 2 3.5-2.5 7.5-3 12-2v20c-4.5-1-8.5-.5-12 2ZM16 7v20M8 11c1.5 0 3 .3 4.5 1M20 12c1.5-.7 3-1 4.5-1M8 17c1.5 0 3 .3 4.5 1M20 18c1.5-.7 3-1 4.5-1" />
    </>
  ),
  idea: (
    <>
      <path d="M12 23v-2.5c-2.8-1.4-4.5-4-4.5-7a8.5 8.5 0 0 1 17 0c0 3-1.7 5.6-4.5 7V23H12ZM12 26h8M14 29h4M16 3V1m-9 5L5.5 4.5M4 13H2m23-7 1.5-1.5M28 13h2" />
    </>
  ),
};

const iconTones: Record<SuggestedActionIconId, { badge: string; card: string }> = {
  page: {
    badge: 'bg-gradient-to-br from-blue-50 to-sky-100 text-blue-600',
    card: 'border-blue-100 hover:border-blue-300',
  },
  sparkles: {
    badge: 'bg-gradient-to-br from-violet-50 to-purple-100 text-violet-600',
    card: 'border-violet-100 hover:border-violet-300',
  },
  sun: {
    badge: 'bg-gradient-to-br from-amber-50 to-orange-100 text-amber-600',
    card: 'border-amber-100 hover:border-amber-300',
  },
  palm: {
    badge: 'bg-gradient-to-br from-teal-50 to-cyan-100 text-teal-600',
    card: 'border-teal-100 hover:border-teal-300',
  },
  code: {
    badge: 'bg-gradient-to-br from-indigo-50 to-blue-100 text-indigo-600',
    card: 'border-indigo-100 hover:border-indigo-300',
  },
  pen: {
    badge: 'bg-gradient-to-br from-rose-50 to-pink-100 text-rose-600',
    card: 'border-rose-100 hover:border-rose-300',
  },
  list: {
    badge: 'bg-gradient-to-br from-emerald-50 to-green-100 text-emerald-600',
    card: 'border-emerald-100 hover:border-emerald-300',
  },
  compass: {
    badge: 'bg-gradient-to-br from-cyan-50 to-blue-100 text-cyan-700',
    card: 'border-cyan-100 hover:border-cyan-300',
  },
  translate: {
    badge: 'bg-gradient-to-br from-fuchsia-50 to-purple-100 text-fuchsia-600',
    card: 'border-fuchsia-100 hover:border-fuchsia-300',
  },
  chart: {
    badge: 'bg-gradient-to-br from-lime-50 to-green-100 text-lime-700',
    card: 'border-lime-100 hover:border-lime-300',
  },
  book: {
    badge: 'bg-gradient-to-br from-slate-50 to-blue-100 text-slate-600',
    card: 'border-slate-100 hover:border-slate-300',
  },
  idea: {
    badge: 'bg-gradient-to-br from-yellow-50 to-amber-100 text-yellow-700',
    card: 'border-yellow-100 hover:border-yellow-300',
  },
};

const getSuggestedActionTone = (value: unknown) =>
  iconTones[isSuggestedActionIconId(value) ? value : 'sparkles'];

const SuggestedActionIcon = ({
  icon,
  className,
}: {
  icon?: SuggestedActionIconId;
  className?: string;
}) => {
  const resolved = isSuggestedActionIconId(icon) ? icon : 'sparkles';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-xl',
        iconTones[resolved].badge,
        className,
      )}>
      <svg
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 32 32">
        {iconArt[resolved]}
      </svg>
    </span>
  );
};

export { SuggestedActionIcon, getSuggestedActionTone };
