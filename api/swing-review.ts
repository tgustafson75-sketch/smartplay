/**
 * 2026-09-01 — /api/swing-review is the release name for what shipped as /api/cage-review.
 *
 * A REAL route rather than a vercel alias, for two reasons the sim found: an alias has no file, so
 * the "every client endpoint is routed" guard correctly reports it as a 404 waiting to happen, and
 * the regex-alternation form I tried first deployed and still 404'd the new path.
 *
 * The old path stays live and unchanged — phones already on an OTA call it, and a rename that breaks
 * them to buy a nicer name is not a trade worth making a week from release. Both files, one handler,
 * no behaviour difference.
 */
export { default } from './cage-review';
