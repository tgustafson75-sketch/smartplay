/**
 * 2026-09-14 (Tim) — "The bag setup in profile opens the camera, it actually scanned most of my
 * clubs but the clubs from that scan do not persist and update the bag everywhere… When you go back
 * to the bag in profile, it's the camera from the start again."
 *
 * And: "But this shows there is still not a universal bag logic that is working right. If we know,
 * we should have brands and grip and shaft options. Everything club/bag related has to be unified
 * in logic."
 *
 * FOUR THINGS WERE WRONG AND ONLY ONE OF THEM WAS THE STORE.
 *
 * 1. The save button was OFF THE BOTTOM OF THE SCREEN. The review list was a `<ScrollView>` with no
 *    `flex: 1`, followed by a footer holding the only control that wrote anything. React Native's
 *    `flexShrink` defaults to 0, so a content-sized ScrollView pushes its siblings out of the
 *    viewport — and the more clubs the scan read, the further off-screen the button went. A scan of
 *    three clubs saved; a scan of the whole bag could not. Guarded structurally below: every control
 *    that writes now lives inside the scroll, and the scroll flexes.
 * 2. The screen's only state was "camera", so a successful scan and a lost one looked identical.
 * 3. A club could be registered and then never corrected: `setClubSpecs` had ZERO CALLERS.
 * 4. The bag held the HEAD only. Shaft and grip — the actual difference between his three drivers,
 *    which `clubVariantPerformance` already compares — existed nowhere in the app.
 *
 * Every assertion here fails on the pre-fix code.
 */
import fs from 'fs';
import path from 'path';
import { useClubBagStore, specsOf, inPlayVariant } from '../../store/clubBagStore';
import { SHAFT_BRANDS, GRIP_SIZES, shaftWeightsFor, hasShaftWeight } from '../../services/clubSpecOptions';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf-8');

describe('the bag screen saves what it scanned', () => {
  beforeEach(() => { useClubBagStore.getState().clearBag(); });

  it('every control that writes is INSIDE the scrolling area, and the scroll flexes', () => {
    const src = read('app/bag-scan.tsx');
    /**
     * The structural fact, not a style opinion: without `flex: 1` a ScrollView sized by its content
     * pushes whatever follows it past the bottom of the screen. This is the line whose absence cost
     * every long scan.
     */
    expect(src).toMatch(/<ScrollView style=\{\{ flex: 1 \}\}/);
    /**
     * And nothing may sit BETWEEN the scroll and the screen edge claiming to be an action — that
     * gap is exactly where the old footer lived. Scoped to the screen's own JSX (from the close of
     * the ScrollView to the close of the SafeAreaView), not to the rest of the file, which quite
     * properly contains the row components rendered INSIDE the scroll.
     */
    const close = src.indexOf('</ScrollView>');
    const gap = src.slice(close, src.indexOf('</SafeAreaView>', close));
    expect(close).toBeGreaterThan(-1);
    expect(gap).not.toMatch(/TouchableOpacity|<Button/);
  });

  it('opens on the bag, not on the camera', () => {
    const src = read('app/bag-scan.tsx');
    expect(src).toMatch(/useState<Phase>\('bag'\)/);
    // A scan is an action taken FROM the bag; it is not the screen's resting state.
    expect(src).toMatch(/type Phase = 'bag' \| 'scanning'/);
  });

  it('a scan persists without a confirm step, and the caddie sees it', () => {
    const store = useClubBagStore.getState();
    store.registerClub('DR', { source: 'camera', brand: 'TaylorMade', model: 'Stealth 2', loft: '10.5°' });
    store.registerClub('7I', { source: 'camera' });
    const ids = useClubBagStore.getState().bagList().map((c) => c.club_id);
    expect(ids).toEqual(expect.arrayContaining(['DR', '7I']));
    expect(specsOf(useClubBagStore.getState().clubs.DR).model).toBe('Stealth 2');
  });

  it('a SECOND scan merges — it never wipes what the first one learned or what you typed', () => {
    const store = useClubBagStore.getState();
    store.registerClub('DR', { source: 'camera', brand: 'TaylorMade', model: 'Stealth 2', loft: '10.5°' });
    // You then type in the shaft, which no camera can read.
    store.setClubSpecs('DR', { shaftBrand: 'Fujikura', shaftWeight: '60g', gripSize: 'Midsize' });
    // A second pass reads the head again and, as usual, cannot read the shaft.
    store.registerClub('DR', { source: 'camera', brand: 'TaylorMade', model: 'Stealth 2', loft: '' });

    const sp = specsOf(useClubBagStore.getState().clubs.DR);
    expect(sp.shaftBrand).toBe('Fujikura');   // survived
    expect(sp.shaftWeight).toBe('60g');       // survived
    expect(sp.gripSize).toBe('Midsize');      // survived
    expect(sp.loft).toBe('10.5°');            // a blank read means "couldn't see it", not "erase it"
    expect(useClubBagStore.getState().clubs.DR.variants).toHaveLength(1); // one driver, read twice
  });

  it('setClubSpecs works on a club that has no specs yet — the orphan had no first-edit path', () => {
    const store = useClubBagStore.getState();
    store.registerClub('SW', { source: 'voice' });            // voice knows the club and nothing else
    expect(useClubBagStore.getState().clubs.SW.variants).toHaveLength(0);
    store.setClubSpecs('SW', { brand: 'Vokey', loft: '56°' });
    expect(specsOf(useClubBagStore.getState().clubs.SW).brand).toBe('Vokey');
  });

  it('holds THREE DRIVERS as three physical clubs, one of them in play', () => {
    const store = useClubBagStore.getState();
    store.registerClub('DR', { source: 'camera', model: 'Stealth 2' });
    const burner = store.addVariant('DR', { label: 'Burner 2', shaftBrand: 'Project X', shaftWeight: '70g' });
    const old = store.addVariant('DR', { label: 'R11', shaftBrand: 'Aldila', shaftWeight: '60g' });
    expect(burner).toBeTruthy();
    expect(old).toBeTruthy();
    expect(useClubBagStore.getState().clubs.DR.variants).toHaveLength(3);

    // Still ONE driver slot to every reader in the app — membership is unchanged.
    expect(useClubBagStore.getState().bagList().filter((c) => c.club_id === 'DR')).toHaveLength(1);

    // And "driver today is the Burner 2" is a fact the bag can now hold.
    store.setInPlayVariant('DR', burner!);
    expect(inPlayVariant(useClubBagStore.getState().clubs.DR)?.label).toBe('Burner 2');
    expect(specsOf(useClubBagStore.getState().clubs.DR).shaftBrand).toBe('Project X');
  });

  it('the same variant label twice is the same club said twice, not a fourth driver', () => {
    const store = useClubBagStore.getState();
    store.registerClub('DR', { source: 'camera', model: 'Stealth 2' });
    const a = store.addVariant('DR', { label: 'Burner 2' });
    const b = store.addVariant('DR', { label: ' burner 2 ' });
    expect(a).toBe(b);
    expect(useClubBagStore.getState().clubs.DR.variants).toHaveLength(2);
  });

  it('removing a variant never leaves the slot pointing at a club that is gone', () => {
    const store = useClubBagStore.getState();
    store.registerClub('DR', { source: 'camera', model: 'Stealth 2' });
    const burner = store.addVariant('DR', { label: 'Burner 2' })!;
    store.setInPlayVariant('DR', burner);
    store.removeVariant('DR', burner);
    const dr = useClubBagStore.getState().clubs.DR;
    expect(dr.variants.find((v) => v.variant_id === dr.inPlay) ?? dr.variants[0]).toBeTruthy();
    expect(inPlayVariant(dr)?.label).toBe('Stealth 2');
  });

  it('shaft weight is scoped to the family, and the putter is asked nothing it cannot answer', () => {
    expect(shaftWeightsFor('DR')).toContain('60g');
    expect(shaftWeightsFor('DR')).not.toContain('125g');   // no 125 g driver shaft
    expect(shaftWeightsFor('7I')).toContain('105g');
    expect(shaftWeightsFor('7I')).not.toContain('40g');    // no 40 g iron shaft
    expect(shaftWeightsFor('SW')).toEqual(shaftWeightsFor('7I'));
    expect(hasShaftWeight('PT')).toBe(false);
    expect(shaftWeightsFor('PT')).toEqual([]);
  });

  it('the option lists have ONE owner — the screen declares none of its own', () => {
    const src = read('app/bag-scan.tsx');
    expect(src).toMatch(/from '\.\.\/services\/clubSpecOptions'/);
    // No inline array of brands or sizes anywhere in the screen.
    expect(src).not.toMatch(/'True Temper'|'Midsize'|'Undersize'/);
    expect(SHAFT_BRANDS.length).toBeGreaterThan(5);
    expect(GRIP_SIZES).toContain('Midsize');
  });

  it('the slot stores no flat copy of the specs it derives from the club in play', () => {
    const store = useClubBagStore.getState();
    store.registerClub('DR', { source: 'camera', brand: 'TaylorMade', model: 'Stealth 2' });
    const raw = useClubBagStore.getState().clubs.DR as unknown as Record<string, unknown>;
    // A flattened brand beside the variants list would be the two-owner bug, inside one record.
    expect(raw.brand).toBeUndefined();
    expect(raw.model).toBeUndefined();
    expect(raw.loft).toBeUndefined();
    expect(specsOf(useClubBagStore.getState().clubs.DR).brand).toBe('TaylorMade');
  });
});

describe('the scan reads the ball in the frame', () => {
  it('the route asks for balls, and refuses a brand with no model', () => {
    const api = read('api/bag-scan.ts');
    expect(api).toMatch(/balls/);
    expect(api).toMatch(/NEVER infer the model from the brand/);
    // ballPerformance compares MODELS; a brand alone cannot be compared to anything.
    expect(api).toMatch(/if \(!model\) return null;/);
  });

  it('the client parses balls and the screen offers them rather than writing silently', () => {
    expect(read('services/bagScan.ts')).toMatch(/ScannedBall/);
    const screen = read('app/bag-scan.tsx');
    expect(screen).toMatch(/setCurrentBall/);
    // Offered behind a tap: this is the ball every future round is stamped with.
    expect(screen).toMatch(/bag\.ball\.play_this/);
  });
});

describe('photos are a first-class way in', () => {
  it('the screen can take a photo, pick photos, and record a video', () => {
    const src = read('app/bag-scan.tsx');
    expect(src).toMatch(/scanBagFromPhotos/);
    expect(src).toMatch(/launchImageLibraryAsync/);
    expect(src).toMatch(/allowsMultipleSelection: true/);
    expect(src).toMatch(/scanBagFromVideo/);
  });

  it('photos go down the same route as frames — one prompt, one catalog', () => {
    const svc = read('services/bagScan.ts');
    const photos = svc.slice(svc.indexOf('export async function scanBagFromPhotos'));
    expect(photos).toMatch(/scanBagFromFrames/);
    expect(svc).not.toMatch(/api\/bag-photo|api\/photo-scan/);
  });
});

/**
 * 2026-09-14 (Tim) — "Everything club/bag related has to be unified in logic."
 *
 * THE FIFTH OWNER. `store/clubVariantStore` held "which of my three drivers is in play", keyed by
 * normalised club NAME, written by the voice declaration and read by roundStore when it stamps a
 * shot. The bag held the drivers themselves, keyed by club id. Two stores, one fact, unable to see
 * each other — so "driver today is the Burner 2" left the Fit Profile still showing the Stealth,
 * because the bag had never heard of the Burner.
 *
 * The bag is now the owner and that store is deleted.
 */
describe('which physical club is in play has exactly one owner', () => {
  beforeEach(() => { useClubBagStore.getState().clearBag(); });

  it('the duplicate store is gone and nothing imports it', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../store/clubVariantStore.ts'))).toBe(false);
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const f of ['store/roundStore.ts', 'services/intents/setClubVariantHandler.ts']) {
      expect(strip(read(f))).not.toMatch(/clubVariantStore/);
    }
  });

  it('a spoken declaration reaches the BAG — the roster, not a side table', () => {
    const store = useClubBagStore.getState();
    store.registerClub('DR', { source: 'camera', model: 'Stealth 2' });
    // Exactly what setClubVariantHandler now calls, with the club said in words.
    const id = store.declareVariant('driver', 'Burner 2');
    expect(id).toBeTruthy();

    const dr = useClubBagStore.getState().clubs.DR;
    expect(dr.variants.map((v) => v.label)).toEqual(expect.arrayContaining(['Stealth 2', 'Burner 2']));
    expect(inPlayVariant(dr)?.label).toBe('Burner 2');
    // And the label a shot gets stamped with is that same one, asked by name.
    expect(useClubBagStore.getState().variantLabelFor('Driver')).toBe('Burner 2');
    expect(useClubBagStore.getState().variantLabelFor('DR')).toBe('Burner 2');
  });

  it('declaring a variant of a club you do not own registers it rather than refusing', () => {
    // The commonest state before any scan is an empty bag. Arguing with the player there is absurd.
    const id = useClubBagStore.getState().declareVariant('3 wood', 'Rocketballz');
    expect(id).toBeTruthy();
    expect(useClubBagStore.getState().clubs['3W']).toBeTruthy();
    expect(useClubBagStore.getState().variantLabelFor('3W')).toBe('Rocketballz');
  });

  it('saying the same variant twice does not grow the roster', () => {
    const store = useClubBagStore.getState();
    store.declareVariant('driver', 'Burner 2');
    store.declareVariant('Driver', 'burner 2');
    expect(useClubBagStore.getState().clubs.DR.variants).toHaveLength(1);
  });

  it('the legacy blob folds forward, and an empty one does not latch the flag', () => {
    const store = useClubBagStore.getState();
    // An empty fold must NOT mark the job done — a cloud snapshot restored later still carries it.
    store.absorbLegacyVariants({});
    expect(useClubBagStore.getState()._legacyVariantsAbsorbed).toBeFalsy();

    useClubBagStore.getState().absorbLegacyVariants({ Driver: 'Burner 2', '7I': 'Old blades' });
    expect(useClubBagStore.getState().variantLabelFor('Driver')).toBe('Burner 2');
    expect(useClubBagStore.getState().variantLabelFor('7I')).toBe('Old blades');
    expect(useClubBagStore.getState()._legacyVariantsAbsorbed).toBe(true);

    // Idempotent: a second run cannot double the roster.
    useClubBagStore.getState().absorbLegacyVariants({ Driver: 'Something else' });
    expect(useClubBagStore.getState().variantLabelFor('Driver')).toBe('Burner 2');
  });

  it('the name-to-id inverse is derived from the catalog, not hand-written again', () => {
    const src = read('store/clubStatsStore.ts');
    expect(src).toMatch(/Object\.entries\(CLUB_ID_TO_NAME\)\.map/);
    const { clubNameToClubId, clubIdToClubName, CLUB_ORDER } = require('../../store/clubStatsStore');
    for (const name of CLUB_ORDER) {
      const id = clubNameToClubId(name);
      expect(id).toBeTruthy();                                   // every club round-trips
      if (name !== 'Putter') expect(clubIdToClubName(id)).toBe(name);
    }
    expect(clubNameToClubId('Putter')).toBe('PT');               // the ladder excludes it; the bag does not
  });
});
