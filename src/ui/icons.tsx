import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  crop: <><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></>,
  pages: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="9" rx="1" /><rect x="3" y="15" width="7" height="6" rx="1" /><rect x="14" y="15" width="7" height="6" rx="1" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  watermark: <><path d="M4 4h16v16H4z" /><path d="m9 15 6-6" strokeDasharray="2.5 2.5" /><path d="M9 9h.01" /><path d="M15 15h.01" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  trim: <><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="8" y="8" width="8" height="8" rx="1" /></>,
  reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 8h.01" /><path d="M11 12h1v4h1" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  upload: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M12 18v-6" /><path d="m9 15 3-3 3 3" /></>,
  select: <path d="m4 4 7 16 2-7 7-2z" />,
  text: <><path d="M5 6V4h14v2" /><path d="M12 4v16" /><path d="M9 20h6" /></>,
  whiteout: <><path d="m16 3 5 5-11 11H5v-5z" /><path d="M3 21h18" /></>,
  highlight: <><path d="m9 11-5 5v4h4l5-5" /><path d="m13 7 4 4" /><path d="M9 11 15 5l4 4-6 6" /></>,
  box: <rect x="4" y="5" width="16" height="14" rx="1.5" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 17-5-5-9 8" /></>,
  signature: <path d="M2 17c3-6 5-9 6.5-8.3S6 17.5 7.5 18s4-7.5 5.5-7.5-.8 6.8 1.5 6.8 3.8-5.3 5.5-5.3M2 21h20" />,
  rotateL: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  rotateR: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 15h10l1-15" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  merge: <><path d="M8 3v5a4 4 0 0 0 4 4 4 4 0 0 1 4 4v5" /><path d="M16 3v5a4 4 0 0 1-4 4" /></>,
  split: <><path d="M4 12h16" /><path d="M8 4v4" /><path d="M16 16v4" /><rect x="4" y="3" width="16" height="18" rx="2" /></>,
  extract: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M12 11v7" /><path d="m9 15 3 3 3-3" /></>,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
}

export type IconName = keyof typeof paths

export function Icon({ name, size = 18, stroke = 2, label }: { name: IconName; size?: number; stroke?: number; label?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined}
    >
      {paths[name]}
    </svg>
  )
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 30 / 26} viewBox="0 0 26 30" fill="none" aria-hidden="true" className="logo">
      <path d="M4 1h13l8 8v18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" fill="var(--ink)" />
      <path d="M17 1v8h8" stroke="var(--paper-hi)" strokeWidth="1.5" />
      <path d="M7 14v9M7 14h9" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M19 23v-6M19 23h-6" stroke="var(--paper-hi)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}
