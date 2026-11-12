/**
 * Calendar helpers for the Persian fiscal year and dashboard date filters.
 *
 * Iran has used a fixed UTC+03:30 offset since 2022, so day boundaries are
 * calculated against that offset. All money dates are stored as UTC ms.
 */

const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
  2192, 2262, 2324, 2394, 2456, 3178,
];

// The Jalaali algorithms use truncation toward zero (`~~`), not floor.
// This matters for negative month offsets in the Gregorian conversion.
function div(a: number, b: number) {
  return Math.trunc(a / b);
}

function mod(a: number, b: number) {
  return a - Math.trunc(a / b) * b;
}

function jalCal(jy: number, withoutLeap = false) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm = 0;
  let jump = 0;

  if (jy < jp || jy >= BREAKS[bl - 1]) {
    throw new Error("سال شمسی خارج از محدوده پشتیبانی است.");
  }

  for (let i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }

  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  let leap = 0;
  if (!withoutLeap) {
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
  }

  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number) {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number) {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy, false);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm: number;
  let jd: number;

  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }

  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

export function jalaliToGregorian(jy: number, jm: number, jd: number) {
  return d2g(j2d(jy, jm, jd));
}

export function gregorianToJalali(gy: number, gm: number, gd: number) {
  return d2j(g2d(gy, gm, gd));
}

export function tehranParts(timestamp: number) {
  const shifted = new Date(timestamp + IRAN_OFFSET_MS);
  return {
    gy: shifted.getUTCFullYear(),
    gm: shifted.getUTCMonth() + 1,
    gd: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

export function startOfTehranDay(timestamp: number) {
  const { gy, gm, gd } = tehranParts(timestamp);
  return Date.UTC(gy, gm - 1, gd) - IRAN_OFFSET_MS;
}

export function endOfTehranDay(timestamp: number) {
  return startOfTehranDay(timestamp) + DAY_MS - 1;
}

export function jalaliDateToTimestamp(jy: number, jm: number, jd: number) {
  const g = jalaliToGregorian(jy, jm, jd);
  return Date.UTC(g.gy, g.gm - 1, g.gd) - IRAN_OFFSET_MS;
}

export function timestampToJalali(timestamp: number) {
  return gregorianToJalali(
    tehranParts(timestamp).gy,
    tehranParts(timestamp).gm,
    tehranParts(timestamp).gd,
  );
}

export function currentJalaliYear(timestamp = Date.now()) {
  return timestampToJalali(timestamp).jy;
}

export function jalaliMonthStart(jy: number, jm: number) {
  return jalaliDateToTimestamp(jy, jm, 1);
}

export function jalaliMonthEnd(jy: number, jm: number) {
  const next =
    jm === 12
      ? { jy: jy + 1, jm: 1 }
      : { jy, jm: jm + 1 };
  return jalaliMonthStart(next.jy, next.jm) - 1;
}

export function currentFiscalYear(timestamp = Date.now()) {
  const { jy } = timestampToJalali(timestamp);
  return {
    year: jy,
    name: `سال مالی ${new Intl.NumberFormat("fa-IR", {
      useGrouping: false,
    }).format(jy)}`,
    startAt: jalaliMonthStart(jy, 1),
    endAt: jalaliMonthEnd(jy, 12),
  };
}

const monthName = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
  month: "long",
  timeZone: "Asia/Tehran",
});

const shortMonthName = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
  month: "short",
  timeZone: "Asia/Tehran",
});

export function jalaliMonthLabel(jy: number, jm: number) {
  const g = jalaliToGregorian(jy, jm, 15);
  return monthName.format(new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 12)));
}

export function jalaliShortMonthLabel(jy: number, jm: number) {
  const g = jalaliToGregorian(jy, jm, 15);
  return shortMonthName.format(new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 12)));
}

export function jalaliDateLabel(timestamp: number) {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tehran",
  }).format(new Date(timestamp));
}

export type PeriodKey =
  | "today"
  | "week"
  | "month"
  | "lastMonth"
  | "quarter"
  | "year"
  | "custom";

export interface PeriodRange {
  key: PeriodKey;
  label: string;
  startAt: number;
  endAt: number;
  previousStartAt: number;
  previousEndAt: number;
}

/**
 * Builds a period in the Persian calendar. "This week" starts on Saturday,
 * following the Iranian working week.
 */
export function getPeriodRange(
  key: PeriodKey,
  now = Date.now(),
  custom?: { from?: number; to?: number },
): PeriodRange {
  const parts = tehranParts(now);
  const jalali = timestampToJalali(now);
  const todayStart = startOfTehranDay(now);

  let startAt: number;
  let endAt: number;
  let previousStartAt: number;
  let previousEndAt: number;
  let label: string;

  switch (key) {
    case "today": {
      startAt = todayStart;
      endAt = endOfTehranDay(now);
      previousStartAt = startAt - DAY_MS;
      previousEndAt = startAt - 1;
      label = `امروز · ${jalaliDateLabel(now)}`;
      break;
    }
    case "week": {
      // JS weekday: Sunday=0 … Saturday=6. Days since Saturday:
      const daysSinceSaturday = (parts.weekday + 1) % 7;
      startAt = todayStart - daysSinceSaturday * DAY_MS;
      endAt = endOfTehranDay(now);
      // Compare the same Sat→today slice from last week.
      previousStartAt = startAt - 7 * DAY_MS;
      previousEndAt = endAt - 7 * DAY_MS;
      label = "این هفته (شنبه تا امروز)";
      break;
    }
    case "month": {
      const previous =
        jalali.jm === 1
          ? { jy: jalali.jy - 1, jm: 12 }
          : { jy: jalali.jy, jm: jalali.jm - 1 };
      startAt = jalaliMonthStart(jalali.jy, jalali.jm);
      endAt = endOfTehranDay(now);
      previousStartAt = jalaliMonthStart(previous.jy, previous.jm);
      previousEndAt = Math.min(
        previousStartAt + (endAt - startAt),
        jalaliMonthEnd(previous.jy, previous.jm),
      );
      label = `این ماه · ${jalaliMonthLabel(jalali.jy, jalali.jm)}`;
      break;
    }
    case "lastMonth": {
      const previous =
        jalali.jm === 1
          ? { jy: jalali.jy - 1, jm: 12 }
          : { jy: jalali.jy, jm: jalali.jm - 1 };
      const beforePrevious =
        previous.jm === 1
          ? { jy: previous.jy - 1, jm: 12 }
          : { jy: previous.jy, jm: previous.jm - 1 };
      startAt = jalaliMonthStart(previous.jy, previous.jm);
      endAt = jalaliMonthEnd(previous.jy, previous.jm);
      previousStartAt = jalaliMonthStart(
        beforePrevious.jy,
        beforePrevious.jm,
      );
      previousEndAt = jalaliMonthEnd(
        beforePrevious.jy,
        beforePrevious.jm,
      );
      label = `ماه گذشته · ${jalaliMonthLabel(previous.jy, previous.jm)}`;
      break;
    }
    case "quarter": {
      let year = jalali.jy;
      let month = jalali.jm - 2;
      if (month <= 0) {
        month += 12;
        year -= 1;
      }
      startAt = jalaliMonthStart(year, month);
      endAt = endOfTehranDay(now);
      previousStartAt = startAt - (endAt - startAt + 1);
      previousEndAt = startAt - 1;
      label = "سه ماه اخیر";
      break;
    }
    case "year": {
      startAt = jalaliMonthStart(jalali.jy, 1);
      endAt = endOfTehranDay(now);
      // The same elapsed slice of the previous Persian year.
      const previousYear = jalali.jy - 1;
      previousStartAt = jalaliMonthStart(previousYear, 1);
      const previousSameDay = Math.min(
        jalaliDateToTimestamp(previousYear, jalali.jm, jalali.jd),
        jalaliMonthEnd(previousYear, jalali.jm),
      );
      previousEndAt = endOfTehranDay(previousSameDay);
      label = "سال جاری";
      break;
    }
    case "custom": {
      const from = custom?.from ?? now - 30 * DAY_MS;
      const to = custom?.to ?? now;
      startAt = startOfTehranDay(Math.min(from, to));
      endAt = endOfTehranDay(Math.max(from, to));
      previousStartAt = startAt - (endAt - startAt + 1);
      previousEndAt = startAt - 1;
      label = `بازه دلخواه · ${jalaliDateLabel(startAt)} تا ${jalaliDateLabel(
        endAt,
      )}`;
      break;
    }
    default:
      startAt = jalaliMonthStart(jalali.jy, jalali.jm);
      endAt = endOfTehranDay(now);
      previousStartAt = startAt - (endAt - startAt + 1);
      previousEndAt = startAt - 1;
      label = "این ماه";
  }

  return {
    key,
    label,
    startAt,
    endAt,
    previousStartAt,
    previousEndAt,
  };
}

export interface MonthBucket {
  key: string;
  label: string;
  startAt: number;
  endAt: number;
}

export function monthBucketsBetween(startAt: number, endAt: number): MonthBucket[] {
  const first = timestampToJalali(startAt);
  const last = timestampToJalali(endAt);
  const buckets: MonthBucket[] = [];

  let jy = first.jy;
  let jm = first.jm;
  let guard = 0;
  while (guard < 60) {
    const start = jalaliMonthStart(jy, jm);
    if (start > endAt) break;
    const end = jalaliMonthEnd(jy, jm);
    buckets.push({
      key: `${jy}-${jm}`,
      label: jalaliMonthLabel(jy, jm),
      startAt: start,
      endAt: end,
    });
    guard += 1;
    if (jy === last.jy && jm === last.jm) break;
    jm += 1;
    if (jm > 12) {
      jm = 1;
      jy += 1;
    }
  }

  return buckets;
}

export function dayBucketsBetween(startAt: number, endAt: number) {
  const buckets: { key: string; label: string; startAt: number; endAt: number }[] =
    [];
  let cursor = startOfTehranDay(startAt);
  let guard = 0;
  while (cursor <= endAt && guard < 400) {
    const jalali = timestampToJalali(cursor);
    buckets.push({
      key: `${jalali.jy}-${jalali.jm}-${jalali.jd}`,
      label: new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
        day: "numeric",
        month: "short",
      }).format(new Date(cursor + IRAN_OFFSET_MS)),
      startAt: cursor,
      endAt: cursor + DAY_MS - 1,
    });
    cursor += DAY_MS;
    guard += 1;
  }
  return buckets;
}

export function weekBucketsBetween(startAt: number, endAt: number) {
  const buckets: { key: string; label: string; startAt: number; endAt: number }[] =
    [];
  let cursor = startOfTehranDay(startAt);
  let guard = 0;
  while (cursor <= endAt && guard < 80) {
    const end = Math.min(cursor + 7 * DAY_MS - 1, endAt);
    const jalali = timestampToJalali(cursor);
    buckets.push({
      key: `${jalali.jy}-${jalali.jm}-${jalali.jd}`,
      label: new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
        day: "numeric",
        month: "short",
      }).format(new Date(cursor + IRAN_OFFSET_MS)),
      startAt: cursor,
      endAt: end,
    });
    cursor = end + 1;
    guard += 1;
  }
  return buckets;
}
