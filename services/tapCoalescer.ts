/**
 * 2026-09-01 (Tim, on Meta glasses: "temple tap is working but does not react as well to a stop
 * listening tap", then "it just mirrors earbud behavior… this is why it works", then "go deeper — it
 * should be making the bridge better and gated for tap buds or glasses").
 *
 * ONE PHYSICAL PRESS MUST BECOME EXACTLY ONE TAP.
 *
 * mediaKeyBridge subscribed to RemotePlay AND RemotePause and forwarded a tap from each. A single
 * press toggles the transport state, so depending on the device it can emit one event or BOTH — and
 * the bridge had no idea which had happened. Two taps went downstream from one press, and whether
 * that was survivable depended entirely on a 600ms echo guard in listeningSession that was tuned for
 * earbuds. Start-listening tolerated it (the second tap was swallowed as an echo). Stop-listening did
 * not: a duplicate landing just outside the window is honoured as a fresh tap and REOPENS the mic the
 * player just closed. That is precisely "does not react as well to a stop tap".
 *
 * Guarding downstream was the wrong place. The bridge is where a press becomes a tap, so the bridge
 * is where duplicates die. [[two-owners-is-the-root-cause]]
 *
 * WHY IT IS GATED BY DEVICE. These are not the same hardware. AVRCP from glasses travels a longer,
 * noisier path than from earbuds, and a wired remote is effectively instant. One window cannot serve
 * all three without being too tight for glasses or so wide it eats a genuine double-tap on a wire.
 */

/** What is physically producing the media key. */
export type TapDevice = 'glasses' | 'earbuds' | 'wired' | 'unknown';

/**
 * How long after a forwarded tap another event from the SAME device is treated as the same press.
 *
 * Sized to the transport, not guessed: a wire cannot jitter, earbud AVRCP arrives in tens of ms, and
 * glasses sit at the far end of a relayed Bluetooth link. Deliberately BELOW the ~800ms it takes a
 * person to deliberately tap twice, so an intentional double-tap is still two taps on every device.
 */
export const TAP_COALESCE_MS: Record<TapDevice, number> = {
  glasses: 700,
  earbuds: 350,
  wired: 150,
  unknown: 350,
};

/**
 * True when this event should become a tap. Pure — the caller owns the clock and the last-tap
 * timestamp, so this is testable without timers and cannot drift with the module's own state.
 */
export function shouldForwardTap(
  nowMs: number,
  lastForwardedAtMs: number | null,
  device: TapDevice,
): boolean {
  if (lastForwardedAtMs == null) return true;
  const gap = nowMs - lastForwardedAtMs;
  // A clock that went backwards (device sleep, NTP correction) must not swallow every future tap.
  if (gap < 0) return true;
  return gap >= TAP_COALESCE_MS[device];
}

/**
 * Classify from what the app already knows. Glasses win when the DAT bridge says a pair is connected;
 * otherwise the audio route tells wired from Bluetooth. Never throws — an unclassifiable device gets
 * the middle window rather than no coalescing at all, because forwarding a duplicate is the bug.
 */
export function classifyTapDevice(input: {
  glassesConnected?: boolean;
  route?: 'phone_speaker' | 'wired' | 'bluetooth' | 'unknown';
}): TapDevice {
  if (input.glassesConnected) return 'glasses';
  if (input.route === 'wired') return 'wired';
  if (input.route === 'bluetooth') return 'earbuds';
  return 'unknown';
}
