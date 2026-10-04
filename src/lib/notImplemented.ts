/** Used by Wave-0 stubs. Remove call sites as domains are implemented. */
export function notImplemented(what: string): never {
  throw new Error(`[not implemented] ${what}`);
}
