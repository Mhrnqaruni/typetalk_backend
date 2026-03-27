const UTC_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function getUtcWeekWindow(referenceDate: Date): {
  windowStart: Date;
  windowEnd: Date;
} {
  const normalized = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  ));
  const utcDay = normalized.getUTCDay();
  const dayOffset = utcDay === 0 ? -6 : 1 - utcDay;

  normalized.setUTCDate(normalized.getUTCDate() + dayOffset);

  return {
    windowStart: normalized,
    windowEnd: new Date(normalized.getTime() + UTC_WEEK_MS)
  };
}
