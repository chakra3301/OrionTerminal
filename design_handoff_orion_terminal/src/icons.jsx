// === Icons & small visual atoms — exported to window ===

const Icon = ({ d, size = 16, stroke = "currentColor", fill = "none", strokeWidth = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const I = {
  archives: (p) => <Icon {...p} d={["M3 7h18", "M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7", "M9 4h6a2 2 0 0 1 2 2v1H7V6a2 2 0 0 1 2-2z", "M10 12h4"]} />,
  orion: (p) => <Icon {...p} d={["M8 7l-5 5 5 5", "M16 7l5 5-5 5", "M14 4l-4 16"]} />,
  xdesign: (p) => <Icon {...p} d={["M12 2l3 5 5 1-4 4 1 6-5-3-5 3 1-6L4 8l5-1z"]} />,
  search: (p) => <Icon {...p} d={["M11 11m-7 0a7 7 0 1 0 14 0 7 7 0 1 0 -14 0", "M21 21l-4.35-4.35"]} />,
  plus: (p) => <Icon {...p} d={["M12 5v14", "M5 12h14"]} />,
  send: (p) => <Icon {...p} d={["M22 2L11 13", "M22 2l-7 20-4-9-9-4z"]} />,
  mic: (p) => <Icon {...p} d={["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z", "M19 10a7 7 0 0 1-14 0", "M12 19v3"]} />,
  wifi: (p) => <Icon {...p} d={["M5 12.55a11 11 0 0 1 14 0", "M8.5 16.43a6 6 0 0 1 7 0", "M12 20h.01", "M2 8.82a15 15 0 0 1 20 0"]} />,
  battery: (p) => <Icon {...p} d={["M2 7h16v10H2z", "M22 11v2"]} />,
  cmd: (p) => <Icon {...p} d={["M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"]} />,
  bold: (p) => <Icon {...p} d={["M7 4h6a4 4 0 0 1 0 8H7z", "M7 12h7a4 4 0 0 1 0 8H7z"]} />,
  italic: (p) => <Icon {...p} d={["M19 4h-9", "M14 20H5", "M15 4L9 20"]} />,
  heading: (p) => <Icon {...p} d={["M6 4v16", "M18 4v16", "M6 12h12"]} />,
  list: (p) => <Icon {...p} d={["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"]} />,
  quote: (p) => <Icon {...p} d={["M3 21c0-2 1-3 3-3V8a2 2 0 0 0-2 2v8", "M14 21c0-2 1-3 3-3V8a2 2 0 0 0-2 2v8"]} />,
  code: (p) => <Icon {...p} d={["M16 18l6-6-6-6", "M8 6l-6 6 6 6"]} />,
  image: (p) => <Icon {...p} d={["M3 5h18v14H3z", "M3 16l5-5 4 4 3-3 6 6", "M8 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"]} />,
  link: (p) => <Icon {...p} d={["M10 13a5 5 0 0 0 7 0l3-3a5 5 0 1 0-7-7l-1 1", "M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 1 0 7 7l1-1"]} />,
  folder: (p) => <Icon {...p} d={["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"]} />,
  file: (p) => <Icon {...p} d={["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M14 3v6h6"]} />,
  chev: (p) => <Icon {...p} d={["M9 18l6-6-6-6"]} />,
  star: (p) => <Icon {...p} d={["M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"]} />,
  calendar: (p) => <Icon {...p} d={["M3 6h18v15H3z", "M16 3v6", "M8 3v6", "M3 11h18"]} />,
  pen: (p) => <Icon {...p} d={["M12 20h9", "M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"]} />,
  layers: (p) => <Icon {...p} d={["M12 2l10 6-10 6L2 8z", "M2 14l10 6 10-6", "M2 20l10 6 10-6"]} />,
  move: (p) => <Icon {...p} d={["M5 9l-3 3 3 3", "M9 5l3-3 3 3", "M15 19l-3 3-3-3", "M19 9l3 3-3 3", "M2 12h20", "M12 2v20"]} />,
  square: (p) => <Icon {...p} d={["M3 3h18v18H3z"]} />,
  circle: (p) => <Icon {...p} d={["M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0 -18 0"]} />,
  type: (p) => <Icon {...p} d={["M4 7V5h16v2", "M9 20h6", "M12 5v15"]} />,
  hand: (p) => <Icon {...p} d={["M18 11V6a2 2 0 1 0-4 0v5", "M14 10V4a2 2 0 1 0-4 0v6", "M10 10V4a2 2 0 1 0-4 0v9", "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8"]} />,
  vector: (p) => <Icon {...p} d={["M3 3h6v6H3z", "M15 15h6v6h-6z", "M9 6h6", "M18 9v6"]} />,
  eye: (p) => <Icon {...p} d={["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0 -6 0"]} />,
  lock: (p) => <Icon {...p} d={["M5 11h14v10H5z", "M8 11V7a4 4 0 1 1 8 0v4"]} />,
  play: (p) => <Icon {...p} d={["M5 3l14 9-14 9z"]} fill="currentColor" />,
  terminal: (p) => <Icon {...p} d={["M4 17l6-6-6-6", "M12 19h8"]} />,
  branch: (p) => <Icon {...p} d={["M6 3v12", "M18 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M6 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6z", "M18 9c0 4-6 3-6 6"]} />,
  sparkles: (p) => <Icon {...p} d={["M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z", "M19 14l.5 1.5L21 16l-1.5.5L19 18l-.5-1.5L17 16l1.5-.5z"]} />,
  x: (p) => <Icon {...p} d={["M18 6L6 18", "M6 6l12 12"]} />,
  more: (p) => <Icon {...p} d={["M5 12h.01", "M12 12h.01", "M19 12h.01"]} />,
  filter: (p) => <Icon {...p} d={["M22 3H2l8 9.5V19l4 2v-8.5z"]} />,
  grid: (p) => <Icon {...p} d={["M3 3h7v7H3z", "M14 3h7v7h-7z", "M14 14h7v7h-7z", "M3 14h7v7H3z"]} />,
  tag: (p) => <Icon {...p} d={["M20 12l-8 8-8-8V4h8z", "M7 7h.01"]} />,
  refresh: (p) => <Icon {...p} d={["M23 4v6h-6", "M1 20v-6h6", "M3.5 9a9 9 0 0 1 14.85-3.36L23 10", "M20.5 15a9 9 0 0 1-14.85 3.36L1 14"]} />,
  download: (p) => <Icon {...p} d={["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"]} />,
  share: (p) => <Icon {...p} d={["M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M8.59 13.51l6.83 3.98", "M15.41 6.51l-6.82 3.98"]} />,
};

window.Icon = Icon;
window.I = I;
