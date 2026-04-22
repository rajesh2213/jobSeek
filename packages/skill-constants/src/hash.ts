/**
 * Deterministic, dependency-free string hash for DICTIONARY_VERSION
 * (works in Node and browser without crypto.subtle for sync boot).
 */
export function djb2Hash32(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i)!;
    h = h | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
