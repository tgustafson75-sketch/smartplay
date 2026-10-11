/**
 * utils/greenDepth.ts — FRONT AND BACK OF THE GREEN, AS THE PLAYER SEES IT.
 *
 * 2026-10-10 (course audit P1). Stored green front/back are the polygon vertices nearest and farthest
 * from the TEE. From the fairway of a dogleg they are the green's sides, not its depth (a 30-yard-deep
 * green read 150/150/150 from the side), and from behind the green front came out longer than back —
 * which also made the declared pin decline as "no edge". The yardage a golfer wants is where their
 * line to the middle ENTERS the green and where it LEAVES it.
 *
 * Pure: a local flat projection around the player is exact to well under a yard at golf distances.
 */
type LatLng = { lat: number; lng: number };

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG_EQ = 111_320;
const YARD_M = 0.9144;

/**
 * Yards from the player to where the line player → green middle enters (front) and leaves (back) the
 * green outline. Null when the outline is unusable or the line does not cross it twice.
 */
export function edgesAlongLine(player: LatLng, middle: LatLng, outline: readonly LatLng[]): { front: number; back: number } | null {
  if (outline.length < 3) return null;
  const k = Math.cos((player.lat * Math.PI) / 180);
  const xy = (p: LatLng) => ({ x: (p.lng - player.lng) * M_PER_DEG_LNG_EQ * k, y: (p.lat - player.lat) * M_PER_DEG_LAT });
  const c = xy(middle);
  const len = Math.hypot(c.x, c.y);
  if (!(len > 1)) return null;
  const d = { x: c.x / len, y: c.y / len };
  const ts: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = xy(outline[i]!);
    const b = xy(outline[(i + 1) % outline.length]!);
    const e = { x: b.x - a.x, y: b.y - a.y };
    const denom = d.x * e.y - d.y * e.x;
    if (Math.abs(denom) < 1e-9) continue;               // parallel edge
    // Solve player + t·d = a + s·e  (player is the origin).
    const t = (a.x * e.y - a.y * e.x) / denom;
    const s = (a.x * d.y - a.y * d.x) / denom;
    if (s >= 0 && s <= 1 && Number.isFinite(t)) ts.push(t);
  }
  if (ts.length < 2) return null;
  const front = Math.max(0, Math.min(...ts));
  const back = Math.max(...ts);
  if (!(back > front)) return null;
  return { front: Math.round(front / YARD_M), back: Math.round(back / YARD_M) };
}
