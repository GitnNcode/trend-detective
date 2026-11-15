// Inline SVG icons (hand-drawn paths, 24px grid). Written with Claude and reviewed by the team.
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  series: svg('<path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/>'),
  map: svg('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'),
  band: svg('<path d="M3 15c3-4 6-4 9 0s6 4 9 0"/><path d="M3 9c3-4 6-4 9 0s6 4 9 0" opacity=".45"/><circle cx="12" cy="12" r="1.6"/>'),
  route: svg('<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h6a4 4 0 000-8H9a3 3 0 010-6h8"/>'),
  flow: svg('<path d="M3 8h11a3 3 0 100-3"/><path d="M3 12h15a3 3 0 110 6"/><path d="M3 16h7"/>'),
  twin: svg('<circle cx="7" cy="16" r="3"/><circle cx="17" cy="7" r="3"/><path d="M9.5 13.5l5-4"/><path d="M12 8.5l2.5 1 -1 2.5"/>'),
  lineup: svg('<path d="M4 20V9a2 2 0 014 0v11M10 20V6a2 2 0 014 0v14M16 20v-8a2 2 0 014 0v8"/><path d="M2 20h20"/>'),
  atlas: svg('<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>'),
  flat: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 12h18M9 5v14M15 5v14"/>'),
  polar: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>'),
  draw: svg('<rect x="4" y="6" width="16" height="12" rx="1" stroke-dasharray="3 2"/><path d="M4 6l3 3"/>'),
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  rings: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="3"/>'),
  trail: svg('<path d="M4 18c4 0 5-4 8-6s5-1 8-6"/><circle cx="20" cy="6" r="1.8"/>'),
  track: svg('<path d="M4 20l4-5 4 2 4-6 4-5"/><circle cx="20" cy="6" r="2"/>'),
  dipole: svg('<path d="M4 12h16"/><path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  link: svg('<path d="M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1"/><path d="M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1"/>'),
  case: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
};
