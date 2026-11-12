import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireMembership } from "./tenant";
import { jalaliMonthEnd, jalaliMonthStart } from "./calendar";

type Ctx = QueryCtx | MutationCtx;

/** Granular Phase 8 permissions. Roles still gate write/manage access. */
export const HR_PERMISSIONS = [
  "hr.view",
  "hr.sensitive",
  "hr.edit",
  "attendance.manage",
  "leave.request",
  "leave.approve",
  "payroll.view",
  "payroll.calculate",
  "payroll.approve",
  "tax.view",
  "tax.manage",
  "assets.view",
  "assets.manage",
  "branches.manage",
  "org.reports.view",
  "loans.manage",
] as const;

export type HrPermission = (typeof HR_PERMISSIONS)[number];

const ACCOUNTANT_DEFAULTS: HrPermission[] = [
  "hr.view",
  "leave.request",
  "org.reports.view",
];

export function permissionsFor(
  membership: Pick<Doc<"businessMembers">, "role" | "permissions">,
): HrPermission[] {
  if (membership.role === "owner" || membership.role === "admin") {
    return [...HR_PERMISSIONS];
  }
  const explicit = new Set(membership.permissions ?? []);
  if (membership.role === "accountant") {
    for (const permission of ACCOUNTANT_DEFAULTS) explicit.add(permission);
  }
  return HR_PERMISSIONS.filter((permission) => explicit.has(permission));
}

export function membershipHasPermission(
  membership: Pick<Doc<"businessMembers">, "role" | "permissions">,
  permission: HrPermission,
) {
  return permissionsFor(membership).includes(permission);
}

/**
 * Every HR/payroll/tax/asset endpoint goes through this gate. Sensitive fields
 * are never returned merely because a member can see the module index.
 */
export async function requireHrPermission(
  ctx: Ctx,
  businessId: Id<"businesses">,
  permission: HrPermission,
  options: { write?: boolean; manage?: boolean } = {},
) {
  const result = await requireMembership(ctx, businessId, {
    write: options.write,
    manage: options.manage,
  });
  if (!membershipHasPermission(result.membership, permission)) {
    throw new ConvexError(
      "مجوز لازم برای این بخش از اطلاعات سازمانی را ندارید.",
    );
  }
  return { ...result, permissions: permissionsFor(result.membership) };
}

export async function requireAnyPermission(
  ctx: Ctx,
  businessId: Id<"businesses">,
  permissions: HrPermission[],
  options: { write?: boolean; manage?: boolean } = {},
) {
  const result = await requireMembership(ctx, businessId, {
    write: options.write,
    manage: options.manage,
  });
  const granted = permissionsFor(result.membership);
  if (!permissions.some((permission) => granted.includes(permission))) {
    throw new ConvexError(
      "مجوز لازم برای این بخش از اطلاعات سازمانی را ندارید.",
    );
  }
  return { ...result, permissions: granted };
}

export function dayStart(timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    throw new ConvexError("تاریخ معتبر نیست.");
  }
  return Math.floor(timestamp / 86_400_000) * 86_400_000;
}

export function inclusiveDays(start: number, end: number) {
  const startDay = dayStart(start);
  const endDay = dayStart(end);
  if (endDay < startDay) {
    throw new ConvexError("تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد.");
  }
  return Math.round((endDay - startDay) / 86_400_000) + 1;
}

export function addMonths(timestamp: number, months: number) {
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

export function periodKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthBounds(year: number, month: number) {
  if (!Number.isInteger(year) || year < 1200 || year > 1700) {
    throw new ConvexError("سال دوره حقوق معتبر نیست.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ConvexError("ماه دوره حقوق معتبر نیست.");
  }
  // Payroll periods follow the Jalali calendar used by Iranian organisations.
  return {
    startAt: jalaliMonthStart(year, month),
    endAt: jalaliMonthEnd(year, month),
  };
}

export function employeeName(
  employee: Pick<Doc<"employees">, "firstName" | "lastName">,
) {
  return `${employee.firstName} ${employee.lastName}`.trim();
}

export function maskEmployee<T extends Doc<"employees">>(
  employee: T,
  canViewSensitive: boolean,
) {
  if (canViewSensitive) {
    return {
      ...employee,
      fullName: employeeName(employee),
      hasNationalId: true,
      sensitiveVisible: true,
    };
  }
  return {
    ...employee,
    nationalId: null,
    bankName: null,
    bankAccount: null,
    iban: null,
    insuranceNumber: null,
    address: null,
    emergencyContact: null,
    phone: null,
    email: null,
    birthDate: null,
    fullName: employeeName(employee),
    hasNationalId: true,
    sensitiveVisible: false,
  };
}

export function requireNonNegativeInt(
  value: number,
  label: string,
  options: { max?: number } = {},
) {
  const max = options.max ?? 9_000_000_000_000_000;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new ConvexError(`${label} باید عدد صحیح و نامنفی باشد.`);
  }
  return value;
}
