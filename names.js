/**
 * Matching typed names against the batch list (the Attendees tab).
 *
 * Shared by the page (script.js, as a module) and the server (lib/rsvp.js), so the
 * search the visitor sees and the check the server makes can never disagree.
 *
 * Ported from batch-dos-reunion's lib/roster-search.ts: it forgives how people type
 * their own name — first name first, no comma, and without reaching for the ñ.
 */

/** Accents folded, the filing comma dropped, spacing squashed: "Perez,  Niña" -> "perez nina". */
export const fold = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/,/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** Lower is better: a term that opens the name beats one that opens a word, which
 *  beats one buried inside it — so "ros" offers the Ros- surnames before Axlrose. */
function termRank(haystack, term) {
  let best = null
  for (let at = haystack.indexOf(term); at >= 0; at = haystack.indexOf(term, at + 1)) {
    const rank = at === 0 ? 0 : haystack[at - 1] === ' ' ? 1 : 2
    if (rank === 0) return 0
    if (best === null || rank < best) best = rank
  }
  return best
}

/** Names matching every term in `query`, best first, capped at `limit`. */
export function rankRoster(roster, query, limit = 6) {
  const terms = fold(query).split(' ').filter(Boolean)
  if (terms.length === 0) return []

  const scored = []
  for (const name of roster) {
    const haystack = fold(name)
    let score = 0
    for (const term of terms) {
      const rank = termRank(haystack, term)
      if (rank === null) {
        score = -1
        break
      }
      score += rank
    }
    if (score >= 0) scored.push({ name, score })
  }

  return scored
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((s) => s.name)
}

/** The roster's own spelling of `name`, or null when it isn't on the list. */
export const findMember = (roster, name) => {
  const key = fold(name)
  return key ? roster.find((member) => fold(member) === key) ?? null : null
}
