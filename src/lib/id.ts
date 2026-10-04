/** Short random id for hand-made nails/edges/pins/groups/layers, e.g. `n-k3j9x2a1`. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += (b % 36).toString(36);
  return `${prefix}-${s}`;
}
