/**
 * Minimal, safe-enough markdown -> HTML for the report summary.
 * Handles: ## headings, **bold**, paragraphs, and the <sup><a> citation refs
 * that the backend already emits as HTML. NOT a full markdown engine —
 * just enough for our report format.
 */
export function miniMarkdown(md: string): string {
  if (!md) return '';

  const escapeText = (s: string) =>
    s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');

  // The backend emits citation refs as literal <sup><a href="#c1">[1]</a></sup>.
  // Protect them from escaping by extracting first, then restoring.
  const sups: string[] = [];
  let work = md.replace(/<sup>.*?<\/sup>/g, (m) => {
    sups.push(m);
    return `@@SUP${sups.length - 1}@@`;
  });

  work = escapeText(work);

  // Headings (## and #)
  work = work.replace(/^##\s+(.*)$/gm, '<h3>$1</h3>');
  work = work.replace(/^#\s+(.*)$/gm, '<h2>$1</h2>');
  // Bold
  work = work.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Paragraphs: split on blank lines
  work = work
    .split(/\n{2,}/)
    .map((block) => {
      const t = block.trim();
      if (!t) return '';
      if (t.startsWith('<h2>') || t.startsWith('<h3>')) return t;
      return `<p>${t.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  // Restore citation refs
  work = work.replace(/@@SUP(\d+)@@/g, (_, i) => sups[Number(i)] ?? '');

  return work;
}