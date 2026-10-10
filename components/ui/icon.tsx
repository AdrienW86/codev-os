import type { SVGProps } from "react";

const paths = {
  projects: "M3 7V4h6l3 3h9v13H3z",
  tasks: "M9 5h12 M9 12h12 M9 19h12 M3 5l1 1 2-2 M3 12l1 1 2-2 M3 19l1 1 2-2",
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  clients: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  agents: "M5 7h14v13H5z M12 3v4 M9 12h.01 M15 12h.01 M9 16h6 M2 11v5 M22 11v5",
  recommendations: "M9 18h6 M10 21h4 M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  clock: "M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  alert: "M12 9v4 M12 17h.01 M10 3 2 18a2 2 0 0 0 2 3h16a2 2 0 0 0 2-3L14 3a2 2 0 0 0-4 0",
  ads: "M4 13V7l13-4v14L4 13z M4 13l2 8h4l-2-7 M20 7v6",
  seo: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  content: "M14 2H4v20h16V8l-6-6z M14 2v6h6 M8 13h8 M8 17h5",
  business: "M3 21h18 M6 17v-5 M12 17V7 M18 17V3",
  home: "M3 11l9-8 9 8 M5 9v12h14V9 M10 21v-6h4v6",
  calendar: "M3 5h18v16H3z M3 10h18 M8 3v4 M16 3v4",
  work: "M3 7h18v13H3z M8 7V4h8v3 M3 13h18",
  reports: "M4 3h16v18H4z M8 15v2 M12 11v6 M16 7v10",
  publications: "M4 4h16v12H8l-4 4z M8 9h8 M8 12h5",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3 M5 11a7 7 0 0 0 14 0 M12 18v3",
  send: "M22 2 11 13 M22 2l-7 20-4-9-9-4z",
  voice: "M4 10v4 M8 7v10 M12 4v16 M16 7v10 M20 10v4",
  plus: "M12 5v14 M5 12h14",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={paths[name]} />
    </svg>
  );
}
