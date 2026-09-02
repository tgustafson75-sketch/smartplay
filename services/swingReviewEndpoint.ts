/**
 * 2026-09-01 — ONE PLACE THAT KNOWS WHAT THE REVIEW ENDPOINT IS CALLED.
 *
 * The route was renamed from /api/cage-review to /api/swing-review for the release build, with the
 * old path kept as an alias so phones already on an OTA keep working. The mistake I made doing it was
 * shipping the CLIENT change before confirming the server route was live — which would have 404'd
 * swing review for everyone until a deploy landed, to buy a nicer name.
 *
 * So the client does not depend on deploy ordering at all. It calls the new path, and on a 404 — the
 * one status that means "this route does not exist here" — it retries the old one and remembers.
 * Nothing else is retried: a 400 or a 500 is the handler talking, and repeating it would just double
 * the work. [[the-client-must-be-the-last-to-give-up]]
 */

const NEW_PATH = '/api/swing-review';
const OLD_PATH = '/api/cage-review';

/** Sticky once proven, so a session pays the probe at most once. */
let resolvedPath: string | null = null;

/**
 * fetch the review endpoint, whichever name this server answers to. Same signature as fetch minus the
 * URL, so call sites read exactly as they did.
 */
export async function fetchSwingReview(apiUrl: string, init: RequestInit): Promise<Response> {
  const first = resolvedPath ?? NEW_PATH;
  const res = await fetch(apiUrl + first, init);
  if (res.status !== 404 || first === OLD_PATH) {
    if (res.ok) resolvedPath = first;
    return res;
  }
  // 404 on the new path: this server predates the alias. Fall back and remember.
  const legacy = await fetch(apiUrl + OLD_PATH, init);
  if (legacy.ok) resolvedPath = OLD_PATH;
  return legacy;
}
