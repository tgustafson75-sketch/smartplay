/**
 * Mapbox static-image scale — ONE constant, used by every projection in the app AND the server's vision
 * cross-check (api/course-verify). Measured 2026-09-23: 78271.5 m/px at z0 for Mapbox's 512-px tiles
 * (the old 156543 was the 256-px web-mercator figure and halved every distance on the map). Pure, so
 * server code can import it; services/mapboxImagery re-exports it for existing callers.
 */
export const MAPBOX_Z0_METERS_PER_PX = 78271.51696;

export function mapboxMetersPerPixel(lat: number, zoom: number): number {
  return (MAPBOX_Z0_METERS_PER_PX * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/** Mapbox `pk.` tokens are PUBLIC client tokens, designed to ship in client code (see mapboxImagery's
 *  note on why a hardcoded fallback is required for OTA bundles). One copy, for app and server. */
export const MAPBOX_PUBLIC_FALLBACK =
  'pk.eyJ1Ijoic21hcnRwbGF5Y2FkZGllIiwiYSI6ImNtb28yZm9wNzE2YXYyb3B4aTZpdzVxd2sifQ.-8O0hpwyO5XRNPz5cc541w';
