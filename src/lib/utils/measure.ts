/**
 * Content size of a wrap="off" textarea in CSS px. scrollWidth/scrollHeight never
 * report less than the current layout box, so the textarea is collapsed for the
 * read and the previous inline size restored verbatim afterwards — restoring '' is
 * NOT enough, because React only re-applies its style prop when the value changes,
 * which would leave the box collapsed. Shared by every auto-fitting text editor
 * (element text boxes and the scan tool's in-place run editor) so they measure —
 * and therefore size — text identically.
 */
export function measureTextareaContent(ta: HTMLTextAreaElement): { w: number; h: number } {
  const pw = ta.style.width;
  const ph = ta.style.height;
  ta.style.width = '0px';
  ta.style.height = '0px';
  const w = ta.scrollWidth;
  const h = ta.scrollHeight;
  ta.style.width = pw;
  ta.style.height = ph;
  return { w, h };
}
