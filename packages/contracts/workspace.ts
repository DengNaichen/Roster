/**
 * Derive a valid team key (`[A-Z][A-Z0-9]{1,5}`) from a team display name.
 * Multi-word names use initials (or keep a short leading acronym); single words
 * use the first 2–3 characters.
 */
export function deriveTeamKey(name: string): string {
  const words = name
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  let candidate: string;
  if (words.length === 1) {
    candidate = words[0]
      .toUpperCase()
      .replace(/^[^A-Z]+/, '')
      .slice(0, 3);
  } else {
    const first = words[0];
    if (/^[A-Z][A-Z0-9]{1,3}$/.test(first)) {
      candidate = first;
    } else {
      candidate = words
        .map((word) => word[0].toUpperCase())
        .join('')
        .replace(/^[^A-Z]+/, '')
        .slice(0, 4);
      if (candidate.length < 2) {
        candidate = words
          .join('')
          .toUpperCase()
          .replace(/^[^A-Z]+/, '')
          .slice(0, 3);
      }
    }
  }
  return /^[A-Z][A-Z0-9]{1,5}$/.test(candidate) ? candidate : '';
}

/** A valid fallback is always available for non-Latin or numeric workspace names. */
export function defaultTeamKey(name: string, slug: string): string {
  return deriveTeamKey(name) || deriveTeamKey(slug) || 'TEAM';
}
