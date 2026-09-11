import * as fs from 'fs';
import * as path from 'path';

/**
 * 2026-09-11 (release 1.5) — THE STRING MOVED; THE GUARD FOLLOWS IT, STRENGTHENED.
 *
 * The phase-2 codemod replaced this screen's English literals with t() calls, so an assertion that
 * greps the source for the sentence can no longer find it. The invariant being protected is not
 * "this file contains these characters" — it is "this screen still says this to the player".
 *
 * So the check is now in two halves, which together are STRICTER than the single grep was: the
 * screen must call t() with the expected key in the expected structural position, AND that key must
 * resolve to the expected English in i18n/locales/en.json. The old form could be satisfied by a
 * comment quoting the sentence; this one cannot.
 */
function enValue(key: string): string {
  const en = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../i18n/locales/en.json'), 'utf8'),
  ) as Record<string, unknown>;
  return key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], en) as string;
}


const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');

/**
 * 2026-08-22 (Tim — "I have the report I exported from the app, but I can't find the import now for
 * the train my swing card"). The importer existed only in Settings while everything it produces
 * appears on the dashboard, so looking for it where the data lives found nothing.
 */
describe('importing your gym work is reachable from where the data shows up', () => {
  it('the TRAIN YOUR SWING card can import, not just export', () => {
    const dash = read('app/(tabs)/dashboard.tsx');
    expect(dash).toMatch(/onImportSmartPump/);
    expect(dash).toMatch(/accessibilityLabel=\{t\('dashboard\.accessibility_label\.import_workouts_from_smartpump'\)\}/);
    expect(enValue('dashboard.accessibility_label.import_workouts_from_smartpump'))
      .toBe('Import workouts from SmartPump');
    // The pairing is the point: send exercises out, bring the finished sessions back.
    expect(dash).toMatch(/onExportWorkouts/);
  });

  it('Settings still offers it too', () => {
    expect(read('app/settings.tsx')).toMatch(/onImportSmartPump/);
  });

  it('both surfaces run ONE import flow rather than two copies that can drift', () => {
    for (const f of ['app/(tabs)/dashboard.tsx', 'app/settings.tsx']) {
      expect(read(f)).toMatch(/importSmartPumpWithFeedback/);
    }
    // and neither re-implements the messaging
    for (const f of ['app/(tabs)/dashboard.tsx', 'app/settings.tsx']) {
      expect(read(f)).not.toMatch(/no_workouts_found/);
    }
  });

  it('the caddie can say where it is, and names both places', () => {
    const kb = read('services/knowledgeBase/howTo.ts');
    expect(kb).toMatch(/TRAIN YOUR SWING/);
    expect(kb).toMatch(/Settings/);
    expect(kb).toMatch(/where do I import my workouts/);
  });
});
