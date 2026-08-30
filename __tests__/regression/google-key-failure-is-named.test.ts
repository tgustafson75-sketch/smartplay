/**
 * 2026-08-30 — a Google key failure must say WHICH failure it was.
 *
 * `isCapabilityMiss` folded four different outcomes into one `true`, and the key walker turned that
 * into "no configured project has this API enabled". For two of them that sentence is false, and it
 * is the sentence someone reads while debugging.
 *
 * This is not hypothetical and it is not far off. `eas.json` ships EXPO_PUBLIC_GOOGLE_MAPS_KEY with
 * Application restrictions set to NONE, and restricting it is on the Cowork list. The moment that
 * happens Google starts answering REQUEST_DENIED — and before this change the app would have
 * reported a missing API and sent whoever was looking to the wrong console page.
 *
 * The rule being pinned:
 *
 *      A KEY THAT IS CORRECTLY CONFIGURED AND FAILING MUST NOT BE WALKED PAST IN SILENCE.
 */

import { classifyGoogleFailure, isCapabilityMiss } from '../../api/_googleKeys';

describe('billing failures are not capability misses', () => {
  it.each([
    ['the legacy REQUEST_DENIED billing message', {
      status: 'REQUEST_DENIED',
      message: 'You must enable Billing on the Google Cloud Project at https://console.cloud.google.com/',
    }],
    ['an explicit BILLING_NOT_ACTIVE status', { status: 'BILLING_NOT_ACTIVE' }],
    ['a 403 that mentions billing', { httpStatus: 403, message: 'Billing has not been enabled for this project.' }],
  ])('classifies %s as billing, and refuses to treat it as a missing API', (_label, input) => {
    expect(classifyGoogleFailure(input)).toBe('billing');
    // The file's own comment already forbade this for OVER_QUERY_LIMIT — "silently spilling that
    // load onto the other project would hide a billing problem behind a fallback" — while doing
    // exactly that for billing itself.
    expect(isCapabilityMiss(input)).toBe(false);
  });
});

describe('restriction failures are not capability misses', () => {
  it.each([
    ['an application restriction', {
      status: 'REQUEST_DENIED',
      message: 'This IP, site or mobile application is not authorized to use this API key.',
    }],
    ['a referer restriction', {
      status: 'REQUEST_DENIED',
      message: 'API keys with referer restrictions cannot be used with this API.',
    }],
  ])('classifies %s as restricted', (_label, input) => {
    expect(classifyGoogleFailure(input)).toBe('restricted');
    expect(isCapabilityMiss(input)).toBe(false);
  });

  it('is the exact shape the Maps key will produce when it is finally restricted', () => {
    // eas.json ships that key with Application restrictions: None. This is what changes.
    const whenRestricted = {
      status: 'REQUEST_DENIED',
      message: 'This IP, site or mobile application is not authorized to use this API key.',
    };
    expect(classifyGoogleFailure(whenRestricted)).not.toBe('not_enabled');
  });
});

describe('a genuinely disabled API still walks to the next project', () => {
  it.each([
    ['PERMISSION_DENIED', { status: 'PERMISSION_DENIED' }],
    ['SERVICE_DISABLED', { status: 'SERVICE_DISABLED' }],
    ['a bare REQUEST_DENIED', { status: 'REQUEST_DENIED' }],
    ['the "has not been used in project" message', {
      httpStatus: 403,
      message: 'Places API (New) has not been used in project 1234 before or it is disabled.',
    }],
    ['"is not enabled"', { httpStatus: 403, message: 'This API is not enabled for this project.' }],
  ])('classifies %s as not_enabled and keeps the fallback', (_label, input) => {
    expect(classifyGoogleFailure(input)).toBe('not_enabled');
    expect(isCapabilityMiss(input)).toBe(true);
  });
});

describe('the existing multi-key fallback is unchanged for anything that was working', () => {
  it('still walks past a bare 401 or 403 with nothing to read', () => {
    // Behaviour-preservation, deliberately: these were capability misses before and still are.
    // Named 'unknown' so the log stops asserting something about the project that nobody checked.
    for (const httpStatus of [401, 403]) {
      expect(classifyGoogleFailure({ httpStatus })).toBe('unknown');
      expect(isCapabilityMiss({ httpStatus })).toBe(true);
    }
  });

  it('treats an empty input as unknown rather than guessing', () => {
    expect(classifyGoogleFailure({})).toBe('unknown');
  });

  it('reads the billing message even when it arrives as HTTP 200 + REQUEST_DENIED', () => {
    // Legacy Maps puts the real error in the BODY with a 200. The status code alone would have
    // said nothing was wrong at all.
    expect(
      classifyGoogleFailure({ status: 'REQUEST_DENIED', message: 'You must enable Billing on the project' }),
    ).toBe('billing');
  });
});
