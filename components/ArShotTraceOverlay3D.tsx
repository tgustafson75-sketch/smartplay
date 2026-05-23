/**
 * 2026-05-22 — AR Shot Trace Overlay 3D — bare entry (web-safe stub).
 *
 * The native variant (ArShotTraceOverlay3D.native.tsx) is the real 3D
 * scene using @react-three/fiber/native + expo-gl + three + expo-three.
 * This file is the TYPE SOURCE that TypeScript reads + the bundle Metro
 * picks on web. It pulls in NO native-only packages so Vercel's
 * `expo export --platform web` succeeds.
 *
 * Web runtime: returns null. The ArShotTrace router only routes here
 * when arRenderCapability.detectArCapability() reports 'three_gl', and
 * the web variant of the capability probe always returns 'svg', so this
 * stub is effectively unreachable at runtime on web — but the bundler
 * still needs the import path to resolve, hence this file.
 */

import type { ArShotTraceOverlayProps } from './ArShotTraceOverlay';

export type { ArShotTraceOverlayProps, CameraPose, QualityTier } from './ArShotTraceOverlay';

export default function ArShotTraceOverlay3D(_props: ArShotTraceOverlayProps): null {
  void _props;
  return null;
}
