/**
 * 2026-09-28 (1.0.2) — THE PAYWALL NAMES THE TRIAL THE STORE WILL GIVE, OR NONE.
 *
 * It used to read "14-day free trial", "Free for 14 days" and (spoken) "14 days on me" from
 * PRICING.trialDays — a constant that knows neither what the store offers nor whether this player is
 * eligible. The only trial is now the store's introductory offer, so the wording comes from the package.
 */
import fs from 'fs';
import path from 'path';
import { freeTrialFromPackage, trialAdjective, trialDuration, trialSpokenLine } from '../../services/billing/introOffer';

const iosMonthTrial = { product: { identifier: 'm', introPrice: { price: 0, priceString: '$0.00', cycles: 1, period: 'P1M', periodUnit: 'MONTH', periodNumberOfUnits: 1 } } };
const iosPaidIntro = { product: { identifier: 'm', introPrice: { price: 4.99, cycles: 1, periodUnit: 'MONTH', periodNumberOfUnits: 1 } } };
const playMonthTrial = { product: { identifier: 'm', introPrice: null, defaultOption: { freePhase: { billingPeriod: { unit: 'MONTH', value: 1, iso8601: 'P1M' } } } } };
const noOffer = { product: { identifier: 'm', introPrice: null, defaultOption: { freePhase: null } } };

describe('reading the trial from the store package', () => {
  it('iOS: a free intro offer for an ELIGIBLE player is a trial', () => {
    expect(freeTrialFromPackage(iosMonthTrial, 'ios', 'eligible')).toEqual({ count: 1, unit: 'month' });
  });

  it('iOS: not eligible, unknown, or no offer → no trial wording', () => {
    expect(freeTrialFromPackage(iosMonthTrial, 'ios', 'ineligible')).toBeNull();
    expect(freeTrialFromPackage(iosMonthTrial, 'ios', 'unknown')).toBeNull(); // RevenueCat: show the non-intro price
    expect(freeTrialFromPackage(iosMonthTrial, 'ios', 'none')).toBeNull();
    expect(freeTrialFromPackage(noOffer, 'ios', 'eligible')).toBeNull();
  });

  it('a paid introductory price is not a FREE trial', () => {
    expect(freeTrialFromPackage(iosPaidIntro, 'ios', 'eligible')).toBeNull();
  });

  it('Play: the default option\'s free phase is the trial (Play only returns eligible offers)', () => {
    expect(freeTrialFromPackage(playMonthTrial, 'android', 'unknown')).toEqual({ count: 1, unit: 'month' });
    expect(freeTrialFromPackage(noOffer, 'android', 'unknown')).toBeNull();
    expect(freeTrialFromPackage(playMonthTrial, 'android', 'ineligible')).toBeNull();
  });

  it('no package → nothing', () => {
    expect(freeTrialFromPackage(null, 'ios', 'eligible')).toBeNull();
  });

  it('words it in whatever length the store says', () => {
    expect(trialAdjective({ count: 1, unit: 'month' })).toBe('1-month');
    expect(trialDuration({ count: 1, unit: 'month' })).toBe('1 month');
    expect(trialDuration({ count: 7, unit: 'day' })).toBe('7 days');
    expect(trialSpokenLine({ count: 1, unit: 'month' })).toBe('The first month is on me.');
    expect(trialSpokenLine({ count: 2, unit: 'week' })).toBe('The first 2 weeks are on me.');
  });
});

describe('the paywall has no trial length of its own', () => {
  const code = fs.readFileSync(path.join(__dirname, '../../app/paywall.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('never reads a pricing constant for the trial', () => {
    expect(code).not.toMatch(/PRICING\.\w*[tT]rial/);
  });

  it('asks the store, and every trial word is conditional on the answer', () => {
    expect(code).toMatch(/getTrialOffers\(\)/);
    expect(code).toMatch(/trial \? t\('paywall\.paywall_screen\.start_free_trial'\) : t\('paywall\.paywall_screen\.subscribe'\)/);
    expect(code).toMatch(/\{trial \? \(\s*<Text style=\{styles\.pricingTrial\}>/);
    expect(code).toMatch(/offer \? ` \$\{trialSpokenLine\(offer\)\}` : ''/);
  });

  it('no player-facing copy anywhere names a fixed trial length', () => {
    const en = fs.readFileSync(path.join(__dirname, '../../i18n/locales/en.json'), 'utf8');
    // Values, not key names: the countdown key `free_trial_days_left` is legitimate (it counts a real trial down).
    expect(en).not.toMatch(/: "[^"]*(14-day|14 days on me|another 7 days|\{\{trial_days\}\}|\{\{trialDays\}\})/);
  });
});
