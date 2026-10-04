import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { DesignStore, DesignStoreState } from '@/contracts/actions';

/** React hook: subscribe to a slice of the store (shallow-compared). */
export function useDesignStore<T>(store: DesignStore, selector: (s: DesignStoreState) => T): T {
  return useStore(store as unknown as StoreApi<DesignStoreState>, useShallow(selector));
}
