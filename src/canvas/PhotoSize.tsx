import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Units } from '@/contracts/design';
import type { PhotoSpec } from '@/contracts/plan';
import { convert } from '@/lib/units';

const PhotoSizeContext = createContext<{ photo: PhotoSpec; units: Units } | null>(null);

/** Display sizing without adding fields to the frozen design or scene contracts. */
export function PhotoSizeProvider({ photo, units, children }: { photo: PhotoSpec; units: Units; children: ReactNode }) {
  const value = useMemo(() => ({ photo, units }), [photo, units]);
  return <PhotoSizeContext.Provider value={value}>{children}</PhotoSizeContext.Provider>;
}

export function usePhotoSize(units: Units): PhotoSpec | undefined {
  const value = useContext(PhotoSizeContext);
  return useMemo(() => value ? {
    width: convert(value.photo.width, value.units, units),
    height: convert(value.photo.height, value.units, units),
    gap: convert(value.photo.gap, value.units, units),
  } : undefined, [value, units]);
}
