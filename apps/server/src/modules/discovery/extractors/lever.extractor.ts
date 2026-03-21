export function extractLeverToken(html: string | null, careersUrl: string | null): string | null {
  const text = `${html ?? ""}\n${careersUrl ?? ""}`;
  const m = text.match(/jobs\.lever\.co\/([a-z0-9\-]+)/i);
  return m?.[1]?.toLowerCase() ?? null;
}
