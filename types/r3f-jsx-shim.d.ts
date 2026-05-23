/**
 * 2026-05-22 — @react-three/fiber JSX intrinsic-element shim.
 *
 * fiber declares JSX.IntrinsicElements based on `typeof THREE` — when
 * three.js types are shimmed to `any` (see three-shim.d.ts), fiber's
 * own JSX augmentation produces no usable element types. This module
 * augments React.JSX directly with the elements the AR 3D overlay
 * uses, typed as `any` so the elements compile while we wait for
 * @types/three to land.
 *
 * React 19 moved JSX into the React module namespace; the legacy
 * global JSX namespace was removed. Augmentation happens via
 * `declare module 'react' { namespace JSX { ... } }` per React's
 * 2024 migration guide.
 */

import 'react';

declare module 'react' {
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type R3FElement = any;
    interface IntrinsicElements {
      group: R3FElement;
      mesh: R3FElement;
      ambientLight: R3FElement;
      directionalLight: R3FElement;
      pointLight: R3FElement;
      spotLight: R3FElement;
      sphereGeometry: R3FElement;
      boxGeometry: R3FElement;
      ringGeometry: R3FElement;
      planeGeometry: R3FElement;
      tubeGeometry: R3FElement;
      bufferGeometry: R3FElement;
      meshStandardMaterial: R3FElement;
      meshBasicMaterial: R3FElement;
      meshPhongMaterial: R3FElement;
      lineBasicMaterial: R3FElement;
      line: R3FElement;
      points: R3FElement;
      perspectiveCamera: R3FElement;
    }
  }
}
