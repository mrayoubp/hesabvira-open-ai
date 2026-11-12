import type { SubscriptionStatus } from "../schema";

/**
 * Phase 11 billing primitives.
 *
 * Prices are integer Toman values. Durations are whole months and are added in
 * UTC so a 3/12-month subscription does not drift with local daylight saving.
 * No external gateway dependency is imported here; gateway adapters are kept
 * behind server actions so credentials never reach the browser.
 */

export const BILLING_SETTINGS_KEY = "global";

export const DEFAULT_BILLING = {
  testMode: true,
  provider: "test" as const,
  gatewayLabel: "درگاه آزمایشی حساب ویرا",
  graceDays: 7,
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: "فعال",
  pending_payment: "در انتظار پرداخت",
  expired: "منقضی‌شده",
  cancelled: "لغوشده",
  grace: "در مهلت تمدید",
};

export function addMonths(timestamp: number, months: number) {
  const source = new Date(timestamp);
  const day = source.getUTCDate();
  const target = new Date(
    Date.UTC(
      source.getUTCFullYear(),
      source.getUTCMonth() + months,
      1,
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
      source.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}

/** A human-safe, globally unique invoice number (not a sequential guess). */
export function makeInvoiceNumber(now = Date.now()) {
  return `SUB-${now.toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`;
}

export function makeIdempotencyKey(invoiceId: string, kind: string) {
  return `${kind}:${invoiceId}`;
}

/**
 * Effective state is computed lazily so a delayed cron can never grant write
 * access after endAt. Read/export access always remains available.
 */
export function effectiveSubscriptionStatus(
  status: SubscriptionStatus,
  endAt: number | undefined,
  now: number,
  graceDays: number,
): SubscriptionStatus {
  if (status === "active") {
    if (endAt !== undefined && endAt < now) {
      const graceEnd = endAt + graceDays * 24 * 60 * 60 * 1000;
      return now <= graceEnd ? "grace" : "expired";
    }
    return "active";
  }
  if (status === "grace") {
    const graceEnd =
      (endAt ?? now) + graceDays * 24 * 60 * 60 * 1000;
    return now <= graceEnd ? "grace" : "expired";
  }
  return status;
}

export function subscriptionStatusMessage(status: SubscriptionStatus | "legacy") {
  switch (status) {
    case "legacy":
    case "active":
      return "اشتراک فعال است.";
    case "pending_payment":
      return "اشتراک در انتظار پرداخت است. برای ثبت اطلاعات جدید، پرداخت را کامل کنید.";
    case "grace":
      return "دوره اشتراک پایان یافته و در مهلت تمدید هستید. ثبت اطلاعات جدید تا تمدید محدود است.";
    case "expired":
      return "اشتراک منقضی شده است. مشاهده و خروجی اطلاعات باز است، اما ثبت اطلاعات جدید نیاز به تمدید دارد.";
    case "cancelled":
      return "اشتراک لغو یا معلق شده است. برای ثبت اطلاعات جدید، اشتراک را دوباره فعال کنید.";
  }
}

export function isWriteAllowed(status: SubscriptionStatus | "legacy") {
  return status === "active" || status === "legacy";
}

export const PLAN_LIMIT_LABELS: Record<string, string> = {
  maxUsers: "کاربر مجاز",
  maxBranches: "شعبه",
  maxWarehouses: "انبار",
  maxStorageMb: "مگابایت فایل",
};
