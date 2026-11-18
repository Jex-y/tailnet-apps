/** 24×24 stroked paths, drawn in the text colour. */
const PATHS = {
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  back: "M15 5l-7 7 7 7",
  down: "M5 9l7 7 7-7",
  up: "M5 15l7-7 7 7",
  check: "M5 12.5l4.5 4.5L19 7.5",
  delete: "M9 6h11v12H9l-5.5-6zM12.5 9.5l5 5M17.5 9.5l-5 5",
  log: "M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12",
  history: "M5 4h14v16H5zM5 9h14M9 4v5M15 4v5",
  exercises: "M4 19h16M7 16v-5M12 16V6M17 16v-8",
} as const;

export type IconName = keyof typeof PATHS;

export const Icon = ({ name }: { readonly name: IconName }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
    <path d={PATHS[name]} />
  </svg>
);
