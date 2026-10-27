const paths: Record<string, string> = {
  select: "M5 3v16l4-5 5 5 3-3-5-5 6-2Z",
  move: "M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4",
  rotate: "M4 10a8 8 0 1 1 1 7M4 4v6h6",
  resize: "M3 8v8M21 8v8M3 12h18M7 9l-4 3 4 3M17 9l4 3-4 3",
  column: "M8 3h8v18H8ZM5 3h14M5 21h14",
  "circular-column": "M7 5c0-4 10-4 10 0s-10 4-10 0v14c0 4 10 4 10 0V5",
  wall: "M3 7l15-4 3 3v15L3 18ZM18 3v15l3 3M3 7l15 3 3-4",
  beam: "M3 7l15-4 3 3-15 4ZM3 7v10l3 4 15-5V6M6 10v11",
  slab: "M3 10l12-6 6 5-12 6ZM3 10v4l6 5 12-6V9M9 15v4",
  roof: "M2 14l10-9 10 9M5 12v8h14v-8",
};
export function CadIcon({ name }: { name: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.select} /></svg>;
}
