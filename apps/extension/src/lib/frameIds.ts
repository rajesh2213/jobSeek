/** Composite field id for tab-wide uniqueness across iframes (frame-local DOM ids repeat). */
export const COMPOSITE_FIELD_SEP = "::";

export function compositeFieldId(frameId: number, localId: string): string {
  return `${frameId}${COMPOSITE_FIELD_SEP}${localId}`;
}

export function parseCompositeFieldId(id: string): { frameId: number; localId: string } | null {
  const i = id.indexOf(COMPOSITE_FIELD_SEP);
  if (i <= 0) return null;
  const frameId = Number(id.slice(0, i));
  if (!Number.isFinite(frameId)) return null;
  return { frameId, localId: id.slice(i + COMPOSITE_FIELD_SEP.length) };
}

export function domFieldId(field: { id: string; localId?: string }): string {
  return field.localId ?? parseCompositeFieldId(field.id)?.localId ?? field.id;
}
