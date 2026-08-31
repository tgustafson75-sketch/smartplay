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
