/**
 * 2026-10-27 (Tim) — Vercel Web Analytics for the WEB build of the app only (`expo export --platform
 * web`, served by the same Vercel project as the API). Metro picks this `.web.tsx` file for web; the
 * iOS/Android bundles get WebAnalytics.tsx, which renders nothing, so the package never ships in the
 * native app. App usage on phones is measured by api/usage and Sentry, not here.
 */
import React from 'react';
// Concrete file at runtime: metro.config.js keeps package `exports` off, so the '/react' subpath does
// not resolve in Metro. Types come from the public entry, which TypeScript resolves through `exports`.
const { Analytics } = require('@vercel/analytics/dist/react') as typeof import('@vercel/analytics/react');

export function WebAnalytics(): React.ReactElement {
  return <Analytics />;
}
