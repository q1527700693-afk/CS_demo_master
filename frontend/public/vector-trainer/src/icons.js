const paths = {
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',
  grid: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M9 9 3 3m12 6 6-6M9 15l-6 6m12-6 6 6"/>',
  wave: '<path d="M2 12c3-12 5 12 8 0s5 12 8 0 4 0 4 0"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
  book: '<path d="M12 5v16M3 3c4-1 6 0 9 2 3-2 5-3 9-2v16c-4-1-6 0-9 2-3-2-5-3-9-2z"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  full: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z"/><path d="m8 11 3 3 5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5zM15 8a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
export function icon(name, size = 20) { return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.target}</svg>`; }
export function modeArt(mode) {
  const drawings = {
    gridshot: '<circle cx="33" cy="24" r="8"/><circle cx="67" cy="24" r="8"/><circle cx="50" cy="50" r="8"/>',
    reaction: '<path d="m55 8-24 28h18l-5 22 26-31H52z"/>',
    spidershot: '<circle cx="23" cy="48" r="7"/><circle cx="77" cy="17" r="10"/><path class="art-line" d="m33 43 30-18m-9-1 9 1-3 8"/>',
    microshot: '<circle cx="50" cy="33" r="20" class="art-line"/><circle cx="50" cy="33" r="6"/><path class="art-line" d="M50 5v12m0 32v12M22 33h12m32 0h12"/>',
    tracking: '<path class="art-line" d="M10 44c18-55 34 50 66-17"/><circle cx="77" cy="26" r="9"/>',
  };
  return `<svg class="mode-art" viewBox="0 0 100 66" aria-hidden="true">${drawings[mode]}</svg>`;
}
