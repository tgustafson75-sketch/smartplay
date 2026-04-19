/**
 * imageUtils.ts
 *
 * Lightweight image pipeline utilities for deduplication, shuffle, and spacing.
 * Works with both URL strings and React Native local asset IDs (number from require()).
 *
 * Usage:
 *   import { prepareImages } from '../utils/imageUtils';
 *   const images = prepareImages([img1, img2, img3, img2]); // deduped, shuffled, spaced
 */

// ── Normalize a value to a consistent string key for deduplication ───────────

function toKey(img: string | number): string {
  if (typeof img === 'number') return String(img);
  // Strip URL query params so "photo.jpg?w=800" and "photo.jpg?w=400" are treated as duplicates
  return img.split('?')[0];
}

// ── Deduplicate — remove exact duplicate entries (by normalized key) ─────────

export function filterImages<T extends string | number>(images: T[]): T[] {
  const seen = new Set<string>();
  return images.filter((img) => {
    const key = toKey(img);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Fisher-Yates shuffle — cryptographically adequate for UI variety ─────────

export function shuffleImages<T>(images: T[]): T[] {
  const arr = [...images];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Space similar images apart — prevent back-to-back "same-looking" entries ─
//
// Two images are considered "similar" when the first 30 characters of their
// normalized keys match (catches URL-prefix siblings like same-host images).

export function spaceImages<T extends string | number>(images: T[]): T[] {
  if (images.length < 3) return images;
  const result: T[] = [];
  for (let i = 0; i < images.length; i++) {
    const curr = toKey(images[i]).slice(0, 30);
    const prev = result.length > 0 ? toKey(result[result.length - 1]).slice(0, 30) : '';
    if (curr === prev && i + 1 < images.length) {
      // Swap with the next available entry to create separation
      result.push(images[i + 1]);
      result.push(images[i]);
      i++; // skip the next entry since we've already placed it
    } else {
      result.push(images[i]);
    }
  }
  return result;
}

// ── Full pipeline: deduplicate → shuffle → space ─────────────────────────────

export function prepareImages<T extends string | number>(images: T[]): T[] {
  const deduped   = filterImages(images);
  const shuffled  = shuffleImages(deduped);
  const spaced    = spaceImages(shuffled);
  return spaced;
}

// ── Pick one image from a variants array, seeded by an index ─────────────────
//
// Guarantees a consistent pick within a session but varies across sessions.
// Safe to call during render (pure, no side effects).

export function pickVariant<T extends string | number>(
  variants: T[],
  sessionSeed: number,
  cardIndex: number,
): T {
  if (variants.length === 0) throw new Error('pickVariant: empty variants array');
  return variants[(sessionSeed + cardIndex) % variants.length];
}
