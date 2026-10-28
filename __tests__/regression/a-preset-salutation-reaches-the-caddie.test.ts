/**
 * 2026-10-28 (Brain review F5 follow-through) — A PRE-SET SALUTATION REACHES THE CADDIE.
 *
 * data/inviteePreferences maps a known email to what the caddie calls that player ("Uncle Mike").
 * The only reader was a hook selector in useVoiceCaddie whose firstName nothing destructured, so the
 * override never reached a single brain call; F5 removed that selector and left the resolver
 * unconnected. The payload builder is where every route asks, so it resolves the name there.
 */
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { usePlayerProfileStore } from '../../store/playerProfileStore';

describe('the caddie calls the player what he was set up to call him', () => {
  afterEach(() => { usePlayerProfileStore.setState({ name: '', email: null } as never); });

  it('a pre-set invitee email sends the salutation as firstName', () => {
    usePlayerProfileStore.setState({ name: 'Michael Hayes', email: 'M.Hayes@snet.net' } as never);
    expect(buildCaddieRequestBody({} as never).firstName).toBe('Uncle Mike');
  });

  it('any other player keeps the first word of his own name', () => {
    usePlayerProfileStore.setState({ name: 'Tim Gustafson', email: 'someone@example.com' } as never);
    expect(buildCaddieRequestBody({} as never).firstName).toBe('Tim');
  });

  it('no name and no override sends null, not an empty string', () => {
    usePlayerProfileStore.setState({ name: '', email: null } as never);
    expect(buildCaddieRequestBody({} as never).firstName).toBeNull();
  });
});
