/**
 * 2026-08-31 (Tim) — THE CARD'S FACTS, in one place that is not a screen.
 *
 * Extracted from app/owner-card.tsx for two reasons. The screen is JSX, so nothing in the logic test
 * project can import it — the share text was untestable where it was. And a card is DATA: the same
 * facts should be able to reach a spoken answer or a share sheet without going through a component.
 *
 * One owner for the contact details. A phone number that disagrees with itself between the card and
 * whatever the caddie says would be the two-owners defect at its most embarrassing.
 * [[two-owners-is-the-root-cause]]
 */
export const CARD = {
  name: 'Tim Gustafson',
  role: 'Founder',
  company: 'SmartPlay AI LLC',
  pitch:
    'A voice-first AI caddie that knows your bag, your tendencies and the shot in front of you — and talks you through it hands-free while you play.',
  download: 'https://smartplaycaddie.com/download',
  phone: '951-746-4090',
  email: 'tim@smartplaycaddie.com',
  website: 'https://smartplaycaddie.com',
  instagram: '@smartplay_caddie',
  instagramUrl: 'https://www.instagram.com/smartplay_caddie',
  /** Tim's catchphrase, 2026-08-30. ADDITIVE — it does not replace the tagline. */
  tagline: 'Full Swing Ahead',
} as const;

export type OwnerCard = typeof CARD;

/**
 * What gets sent when the card is shared. Plain text on purpose: it has to survive SMS, email,
 * WhatsApp and every app that strips formatting, and it has to be readable when it does.
 */
export function shareTextFor(c: OwnerCard = CARD): string {
  return [
    `${c.name} — ${c.role}, ${c.company}`,
    '',
    c.pitch,
    '',
    `Get the app: ${c.download}`,
    `Call: ${c.phone}`,
    `Email: ${c.email}`,
    `Web: ${c.website}`,
    `Instagram: ${c.instagram}`,
    '',
    c.tagline,
  ].join('\n');
}

/** A `tel:` URI from the display number — built, never stored twice. */
export function telUriFor(c: OwnerCard = CARD): string {
  return `tel:+1${c.phone.replace(/\D/g, '')}`;
}

/**
 * 2026-09-01 (Tim, on a Galaxy Z Fold: "qr code doesn't size on fold z") — THE QR IS SIZED IN
 * PIXELS, NOT PERCENT.
 *
 * It was `width: '100%'` on an Image inside a ScrollView contentContainer that ALSO declared
 * `width: '100%'`. When that percentage fails to resolve the Image falls back to the asset's
 * intrinsic size, so the code rendered several times the screen width and was cropped. A cropped QR
 * will not scan, and this screen exists to be scanned by a stranger.
 *
 * A foldable also CHANGES WIDTH while open; useWindowDimensions re-renders on that, a percentage
 * resolved once at mount does not. Lives here rather than in the screen so it is testable without
 * pulling React Native into Jest. [[two-owners-is-the-root-cause]]
 */
export const CARD_MAX_W = 460;
export const CARD_H_PAD = 22;
export const PLATE_PAD = 14;

/** The plate hugs the QR: card width minus the paddings, floored so the code stays scannable. */
export function qrSizeFor(windowWidth: number): number {
  const w = Number.isFinite(windowWidth) ? windowWidth : 0;
  const cardW = Math.min(w, CARD_MAX_W);
  return Math.max(140, Math.round(cardW - CARD_H_PAD * 2 - PLATE_PAD * 2));
}
