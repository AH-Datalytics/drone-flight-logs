/**
 * Reading labelled values out of prose.
 *
 * Kept in its own module because these are the fiddliest patterns in the
 * project and they earn a place where they can be read plainly.
 *
 * Some agencies write several facts into one text field, one per line, in the
 * form "Reason: Training". Bloomington does this, and among those lines it also
 * writes prose that names the pilot — "Training flight. Gallion at controls" —
 * with no label to match on. An unlabelled surname in prose cannot be detected
 * reliably, so the safe move is the reverse of scrubbing: keep only the
 * labelled lines that were asked for, and discard the rest of the text.
 */

const LINE = /\r?\n/;
const LABEL_AT_START = /^\s*([A-Za-z][A-Za-z ]*?)\s*:/;

/** Keep only the lines whose label is one of `labels`, in the order they appear. */
export function keepOnlyLabels(v: unknown, labels: string[]): string | null {
  if (typeof v !== 'string') return null;
  const wanted = labels.map(l => l.trim().toLowerCase());
  const kept = v
    .split(LINE)
    .filter(line => {
      const label = line.match(LABEL_AT_START)?.[1];
      return label ? wanted.includes(label.trim().toLowerCase()) : false;
    })
    .map(line => line.trim());
  return kept.length ? kept.join('\n') : null;
}

/** The value of one labelled line: "Reason: Training" gives "Training". */
export function labelled(text: unknown, label: string): string | null {
  const line = keepOnlyLabels(text, [label]);
  if (line === null) return null;
  const value = line.slice(line.indexOf(':') + 1).trim();
  if (!value) return null;
  return /^(none|n\/a|null|unknown)$/i.test(value) ? null : value;
}
