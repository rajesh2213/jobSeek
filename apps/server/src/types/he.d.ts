declare module "he" {
  /** Decode HTML entities to their character equivalents. */
  export function decode(text: string, options?: { isAttributeValue?: boolean }): string;
}
