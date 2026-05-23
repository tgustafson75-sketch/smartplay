/**
 * 2026-05-22 — three.js module shim.
 *
 * three v0.184 stopped shipping bundled .d.ts files; the canonical
 * fix is `npm install --save-dev @types/three`. Until that's wired,
 * this ambient declaration treats every three.js named export as
 * `any` so the AR 3D overlay's `import * as THREE from 'three'` +
 * `THREE.Mesh`, `THREE.Vector3`, `THREE.CatmullRomCurve3` etc all
 * resolve.
 *
 * Trade-off: any-typing inside the 3D overlay. Acceptable because
 * the overlay's three.js surface is small + co-located. Remove this
 * file the moment @types/three lands.
 *
 * IMPORTANT: this file must remain an AMBIENT declaration (no top-
 * level imports / exports) so `declare module 'three'` registers a
 * NEW module, not a module augmentation.
 */

declare module 'three' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Mesh = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Group = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Vector3 = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Object3D = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Material = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type BufferGeometry = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type CatmullRomCurve3 = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type TubeGeometry = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Curve<T = unknown> = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Vector3: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const CatmullRomCurve3: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const TubeGeometry: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const DoubleSide: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const FrontSide: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const BackSide: any;
}
