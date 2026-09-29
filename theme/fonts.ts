import { Platform } from 'react-native';

/**
 * 2026-09-29 — the one monospace family. Every `fontFamily` that wants fixed-width digits uses this;
 * a raw 'monospace' literal anywhere in app/ or components/ fails __tests__/narrowScreens.test.tsx.
 *
 * 'monospace' is an ANDROID generic family. iOS has no font by that name: RN logs "Unrecognized font
 * family" and silently renders the proportional system font, so digits jitter as a readout changes.
 * Menlo ships on every iOS version and resolves on both the old and new architecture ('ui-monospace'
 * only resolves under Fabric). It has Regular and Bold faces; heavier weights map to Bold.
 */
export const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });
