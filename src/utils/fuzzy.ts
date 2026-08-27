// Fuzzy subsequence matching for the spotlight search. Pure logic: no React, no
// DOM, no domain types. Returns the character positions that matched so the UI
// can highlight exactly the letters the user typed and fade the rest.

export interface FuzzyMatch {
  /** Higher is better. Only comparable between matches of the same query. */
  score: number;
  /** Positions in the original text that the query characters landed on. */
  indices: number[];
}

const BOUNDARY = /[^a-z0-9]/;

/** True when the char at `i` starts a word (string start or after punctuation/space). */
const isBoundary = (text: string, i: number) => i === 0 || BOUNDARY.test(text[i - 1]);

/**
 * Match one whitespace-free term. Prefers a contiguous substring hit; falls back
 * to a subsequence ("bhr" matches "BoHemian Rhapsody").
 */
function matchTerm(term: string, lower: string): FuzzyMatch | null {
  const exact = lower.indexOf(term);
  if (exact !== -1) {
    let score = 100;
    if (exact === 0) score += 40;
    else if (isBoundary(lower, exact)) score += 25;
    score += (term.length / lower.length) * 25; // matching most of a short field beats a sliver of a long one
    score -= exact * 0.3; // earlier is better
    return { score, indices: Array.from({ length: term.length }, (_, i) => exact + i) };
  }

  // Forward pass: leftmost subsequence. Bails early when a char is missing.
  const forward: number[] = [];
  let cursor = 0;
  for (const ch of term) {
    const at = lower.indexOf(ch, cursor);
    if (at === -1) return null;
    forward.push(at);
    cursor = at + 1;
  }

  // Backward pass: pull each char as far right as it will go without crossing the
  // next one. This tightens "aa..a" style matches into the densest cluster, which
  // is both a better highlight and a better score.
  const indices = forward.slice();
  for (let qi = term.length - 1, limit = forward[forward.length - 1]; qi >= 0; qi--) {
    const at = lower.lastIndexOf(term[qi], limit);
    indices[qi] = at;
    limit = at - 1;
  }

  let score = 30;
  for (let i = 0; i < indices.length; i++) {
    if (i > 0 && indices[i] === indices[i - 1] + 1) score += 8; // consecutive run
    if (isBoundary(lower, indices[i])) score += 10; // hit the start of a word
  }
  if (indices[0] === 0) score += 15;
  score -= (indices[indices.length - 1] - indices[0] - term.length + 1) * 0.5; // spread penalty
  return { score, indices };
}

/**
 * A query parsed once, ready to be matched against many texts.
 *
 * This exists purely for speed. Matching a query against a 5,000-track library
 * calls into here ~20,000 times per keystroke (4 fields x N tracks); parsing the
 * same query string inside every one of those calls was pure waste. Prepare
 * once, reuse for the whole scan.
 */
export interface PreparedQuery {
  /** Lowercased, non-empty search terms. ALL of them must hit for a match. */
  terms: string[];
}

/** Parse a raw query. Returns null when there is nothing to search for. */
export function prepareQuery(query: string): PreparedQuery | null {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return terms.length === 0 ? null : { terms };
}

/**
 * Match a prepared query against ALREADY-LOWERCASED text.
 *
 * The caller owns the lowercasing so it can hoist it out of the hot loop (field
 * values are fixed while the user types, so they only ever need it once). The
 * returned `indices` are positions in the original text — valid because
 * `toLowerCase()` preserves index parity for every script this searches.
 */
export function matchPrepared(pq: PreparedQuery, lower: string): FuzzyMatch | null {
  if (!lower) return null;

  const hits = new Set<number>();
  let score = 0;

  for (const term of pq.terms) {
    const m = matchTerm(term, lower);
    if (!m) return null;
    score += m.score;
    for (const i of m.indices) hits.add(i);
  }

  return { score: score / pq.terms.length, indices: [...hits].sort((a, b) => a - b) };
}

/**
 * Match a full query (space-separated terms, all of which must hit) against
 * `text`. Case-insensitive. Returns null when any term is absent.
 *
 * Convenience wrapper over prepareQuery + matchPrepared, for one-off matches
 * where there is no loop to hoist the parse out of.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const pq = prepareQuery(query);
  if (!pq) return null;
  if (!text) return null;
  return matchPrepared(pq, text.toLowerCase());
}

export interface Field<K extends string> {
  key: K;
  value: string;
  /** Multiplies the field's score, so a title hit outranks a folder-path hit. */
  weight: number;
  /**
   * `value.toLowerCase()`, precomputed. Optional: supply it when the same field
   * is matched repeatedly (every keystroke over a whole library) to skip a
   * string allocation per field per match. Omit it and it's computed here.
   */
  lower?: string;
}

export interface FieldMatch<K extends string> extends FuzzyMatch {
  key: K;
}

/**
 * Score a query against several fields of one item and return the best-scoring
 * one — that field is *why* the item matched, and drives the "MATCH:" badge.
 */
export function matchFields<K extends string>(
  query: string,
  fields: Field<K>[]
): FieldMatch<K> | null {
  const pq = prepareQuery(query);
  return pq ? matchFieldsPrepared(pq, fields) : null;
}

/**
 * `matchFields` for a query that was prepared once outside the loop. Use this
 * (with `Field.lower` filled in) when scanning a whole library.
 */
export function matchFieldsPrepared<K extends string>(
  pq: PreparedQuery,
  fields: Field<K>[]
): FieldMatch<K> | null {
  let best: FieldMatch<K> | null = null;
  for (const field of fields) {
    if (!field.value) continue;
    const m = matchPrepared(pq, field.lower ?? field.value.toLowerCase());
    if (!m) continue;
    const scored: FieldMatch<K> = { ...m, key: field.key, score: m.score * field.weight };
    if (!best || scored.score > best.score) best = scored;
  }
  return best;
}
