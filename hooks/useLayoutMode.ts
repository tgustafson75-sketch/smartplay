import { useWindowDimensions } from 'react-native';

export type LayoutMode = 'PORTRAIT_TALL' | 'PORTRAIT_STD' | 'WIDE';

export function useLayoutMode(): {
  mode: LayoutMode;
  width: number;
  height: number;
  aspect: number;
} {
  const { width, height } = useWindowDimensions();
  const aspect = height / width;

  let mode: LayoutMode;
  if (aspect > 1.95)      mode = 'PORTRAIT_TALL';  // Fold closed, ultra-tall
  else if (aspect > 1.30) mode = 'PORTRAIT_STD';   // standard phones
  else                    mode = 'WIDE';            // Fold open, tablets, landscape

  return { mode, width, height, aspect };
}
