/**
 * 2026-09-23 — from Tim's pasted Vercel logs: `/api/kevin` printed "Failed to load the ES module
 * @sentry/react-native". The brain's app catalog asks isShelved(), which asked isOwnerBuild(), which
 * required the player-profile store — and with it the whole client graph — inside a serverless
 * function, to answer a question that has no meaning there.
 */
let mockStoreLoads = 0;
jest.mock('../../store/playerProfileStore', () => {
  mockStoreLoads++;
  return { isOwnerEmail: () => true, usePlayerProfileStore: { getState: () => ({ email: 'owner@example.com' }) } };
});

import { isOwnerBuild } from '../../services/releaseSurface';

describe('owner check on the server', () => {
  const prev = process.env.VERCEL;
  afterAll(() => { if (prev === undefined) delete process.env.VERCEL; else process.env.VERCEL = prev; });

  it('on Vercel it answers without loading the client store at all', () => {
    process.env.VERCEL = '1';
    expect(isOwnerBuild()).toBe(false);
    expect(mockStoreLoads).toBe(0);
  });

  it('on the phone it still finds the owner', () => {
    delete process.env.VERCEL;
    expect(isOwnerBuild()).toBe(true);
    expect(mockStoreLoads).toBe(1);
  });
});
