# Research — AR overlay for course view (Phase BJ Component 6)

**Capability:** ARKit (iOS) / ARCore (Android) overlay on camera feed with yardage rings, hazard markers, target lines projected in 3D space onto the real-world course view.

**Verdict: QUEUE — separate major build**

## Technical reason

AR is the largest individual feature in this entire research phase. The complexity stack:

1. **Native AR engines** are platform-specific. ARKit is Swift / Objective-C only. ARCore is Java / Kotlin only. Cross-platform RN abstractions exist (`@viro-community/react-viro` is the most-active fork, though Viro the company shut down — quality + maintenance is uncertain) but they typically lag native APIs by 6-12 months.
2. **Geo-anchoring** — putting a yardage ring at "150 yards from current GPS position" requires:
   - High-accuracy GPS (already a stretch; current SmartFinder uses standard `expo-location` Highest accuracy).
   - Compass calibration (notoriously unreliable on phones, especially on Galaxy Fold which has multiple cameras and possibly weaker IMU calibration).
   - World-tracking SLAM — works on grass but degrades when the camera is moved fast or in direct sunlight (both common on a tee box).
3. **Battery cost** — sustained AR session drains 30-50% of battery per round. Most golfers play 4+ hours; this would force a battery-pack accessory or aggressive on/off toggling.
4. **The legitimate AR competitors** in golf (Hole19, Golfshot Pro AR mode, 18Birdies) all ship AR as an opt-in toggle, not the primary distance UX, *because* of the above issues. SmartFinder + SmartVision (current vector / satellite-tile rendering) is the right primary path.

## What would have to change for BUILD TODAY

Nothing realistic in the v1.0 timeframe. This is a multi-week feature minimum:
- 1-2 weeks: AR engine selection + integration + EAS native module config
- 1 week: geo-anchoring + compass calibration UX
- 1 week: yardage ring rendering + hazard markers
- 1+ week: empirical battery / accuracy tuning on Galaxy Fold

Total: 4-6 weeks for a v1 AR mode that probably doesn't beat SmartFinder for utility.

## Recommendation

**QUEUE — defer to 1.x marquee feature consideration.** AR is a "wow demo" capability that frequently underperforms after launch (per the competitor pattern above). Better to invest the same time in:
- SmartVision satellite imagery polish (Phase S, deferred to 1.0.1).
- Hole-image pipeline (per audit recommendation: 1.0.1).
- Actually shipping the verified core flows first.

If/when AR becomes a real product priority, the most efficient path is probably to ship a *minimal* AR overlay (yardage to pin + one hazard marker, no SLAM-based world-tracking, just compass + GPS-anchored billboards) as a 6-8 hour proof of concept. That fits inside a focused phase but still post-1.0.
