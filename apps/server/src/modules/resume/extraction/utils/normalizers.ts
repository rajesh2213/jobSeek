const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

export function normalizeUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim().replace(/[.,;)\]>'"]+$/g, "");
  if (!s) return undefined;
  if (!/^https?:\/\//i.test(s)) {
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(s)) {
      s = `https://${s}`;
    } else {
      return undefined;
    }
  }
  return s.slice(0, 500);
}

export function normalizePhone(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return undefined;
  return plus ? `+${digits}` : digits;
}

/** Returns normalized `YYYY-MM` or `YYYY` or `present`. */
export function normalizeDate(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  if (/(present|current|now)/i.test(s)) return "present";

  const monthYear = s.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[\s,/-]*(\d{4})/,
  );
  if (monthYear) {
    const mm = MONTHS[monthYear[1]!.toLowerCase()];
    const yyyy = monthYear[2]!;
    return mm ? `${yyyy}-${mm}` : yyyy;
  }

  const year = s.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  if (year) return year[1]!;
  return undefined;
}

export function parseDateRange(line: string): { startDate?: string; endDate?: string } {
  const compact = line.replace(/[–—]/g, "-");
  const parts = compact.split(/\s+-\s+|\s+to\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { startDate: normalizeDate(parts[0]), endDate: normalizeDate(parts[1]) };
  }

  const years = compact.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/g) ?? [];
  if (years.length >= 2) return { startDate: years[0], endDate: years[1] };
  if (years.length === 1) {
    return {
      startDate: years[0],
      endDate: /(present|current|now)/i.test(compact) ? "present" : undefined,
    };
  }
  return {};
}

export function computeDurationYears(startDate?: string, endDate?: string): number | undefined {
  if (!startDate) return undefined;
  const sy = Number(startDate.slice(0, 4));
  if (!Number.isFinite(sy)) return undefined;
  const sm = startDate.length >= 7 ? Number(startDate.slice(5, 7)) : 1;
  const e = endDate === "present" ? new Date() : null;
  const ey = e ? e.getUTCFullYear() : Number((endDate ?? "").slice(0, 4));
  const em = e ? e.getUTCMonth() + 1 : (endDate && endDate.length >= 7 ? Number(endDate.slice(5, 7)) : 12);
  if (!Number.isFinite(ey) || !Number.isFinite(sm) || !Number.isFinite(em)) return undefined;
  const months = (ey - sy) * 12 + (em - sm);
  if (months < 0) return undefined;
  return Math.round((months / 12) * 10) / 10;
}
