import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  attendanceStatusValidator,
  contractStatusValidator,
  employeeStatusValidator,
  employmentTypeValidator,
  leaveTypeValidator,
  requestStatusValidator,
} from "./schema";
import {
  nextCounter,
  requireMembership,
  writeAudit,
} from "./lib/tenant";
import {
  dayStart,
  employeeName,
  HR_PERMISSIONS,
  inclusiveDays,
  maskEmployee,
  membershipHasPermission,
  permissionsFor,
  requireHrPermission,
  type HrPermission,
} from "./lib/hr";
import { assertFileForBusiness } from "./lib/files";
import { assertBranchCapacity } from "./lib/subscriptionAccess";
import {
  optionalString,
  requireInt,
  requireString,
  validateEmail,
  validatePhone,
} from "./lib/validation";
import { currentJalaliYear } from "./lib/calendar";

const employmentType = employmentTypeValidator;
const employeeStatus = employeeStatusValidator;
const attendanceStatus = attendanceStatusValidator;
const leaveType = leaveTypeValidator;
const requestStatus = requestStatusValidator;
const contractStatus = contractStatusValidator;

async function branchForBusiness(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  branchId: Id<"branches">,
) {
  const branch = await ctx.db.get(branchId);
  if (!branch || branch.businessId !== businessId || branch.archivedAt) {
    throw new ConvexError("شعبه انتخاب‌شده در این کسب‌وکار یافت نشد.");
  }
  if (branch.active === false) {
    throw new ConvexError("شعبه غیرفعال قابل انتخاب نیست.");
  }
  return branch;
}

async function employeeForBusiness(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  employeeId: Id<"employees">,
) {
  const employee = await ctx.db.get(employeeId);
  if (!employee || employee.businessId !== businessId) {
    throw new ConvexError("پرسنل در این کسب‌وکار یافت نشد.");
  }
  return employee;
}

function validateNationalId(value: string) {
  const nationalId = value.trim();
  if (!/^\d{10}$/.test(nationalId)) {
    throw new ConvexError("کد ملی باید دقیقاً ۱۰ رقم باشد.");
  }
  return nationalId;
}

async function uniqueEmployeeCode(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  code: string,
  exceptId?: Id<"employees">,
) {
  const existing = await ctx.db
    .query("employees")
    .withIndex("by_business_code", (q) =>
      q.eq("businessId", businessId).eq("code", code),
    )
    .unique();
  if (existing && existing._id !== exceptId) {
    throw new ConvexError("کد پرسنلی قبلاً در این کسب‌وکار ثبت شده است.");
  }
}

async function uniqueNationalId(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  nationalId: string,
  exceptId?: Id<"employees">,
) {
  const existing = await ctx.db
    .query("employees")
    .withIndex("by_business_national", (q) =>
      q.eq("businessId", businessId).eq("nationalId", nationalId),
    )
    .unique();
  if (existing && existing._id !== exceptId) {
    throw new ConvexError("کد ملی قبلاً برای پرسنل دیگری ثبت شده است.");
  }
}

export const employees = query({
  args: {
    businessId: v.id("businesses"),
    search: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    orgUnitId: v.optional(v.id("organizationalUnits")),
    status: v.optional(employeeStatus),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { permissions } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.view",
    );
    const canViewSensitive = permissions.includes("hr.sensitive");
    const needle = args.search?.trim().toLowerCase();
    const limit = Math.min(2000, Math.max(1, Math.round(args.limit ?? 500)));

    const rows = await ctx.db
      .query("employees")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(limit);
    const filtered = rows.filter((employee) => {
      if (args.branchId && employee.branchId !== args.branchId) return false;
      if (args.orgUnitId && employee.orgUnitId !== args.orgUnitId) return false;
      if (args.status && employee.status !== args.status) return false;
      if (!needle) return true;
      const haystack = [
        employee.code,
        employee.firstName,
        employee.lastName,
        employee.jobTitle,
        employee.nationalId,
        employee.phone,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });

    return filtered.map((employee) =>
      maskEmployee(employee, canViewSensitive),
    );
  },
});

export const employee = query({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    const { permissions } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.view",
    );
    const row = await employeeForBusiness(
      ctx,
      args.businessId,
      args.employeeId,
    );
    const canSensitive = permissions.includes("hr.sensitive");
    const canPayroll =
      permissions.includes("payroll.view") ||
      permissions.includes("payroll.approve");

    const [contracts, history, documents, leaves, missions, loans, branch, unit, position, attendance] =
      await Promise.all([
        ctx.db
          .query("employmentContracts")
          .withIndex("by_business_employee", (q) =>
            q.eq("businessId", args.businessId).eq("employeeId", row._id),
          )
          .collect(),
        ctx.db
          .query("employeeJobHistory")
          .withIndex("by_business_employee", (q) =>
            q.eq("businessId", args.businessId).eq("employeeId", row._id),
          )
          .collect(),
        ctx.db
          .query("employeeDocuments")
          .withIndex("by_business_employee", (q) =>
            q.eq("businessId", args.businessId).eq("employeeId", row._id),
          )
          .collect(),
        ctx.db
          .query("leaveRequests")
          .withIndex("by_business_employee", (q) =>
            q.eq("businessId", args.businessId).eq("employeeId", row._id),
          )
          .collect(),
        ctx.db
          .query("missions")
          .withIndex("by_business_employee", (q) =>
            q.eq("businessId", args.businessId).eq("employeeId", row._id),
          )
          .collect(),
        ctx.db
          .query("employeeLoans")
          .withIndex("by_business_employee", (q) =>
            q.eq("businessId", args.businessId).eq("employeeId", row._id),
          )
          .collect(),
        ctx.db.get(row.branchId),
        row.orgUnitId ? ctx.db.get(row.orgUnitId) : null,
        row.positionId ? ctx.db.get(row.positionId) : null,
        ctx.db
          .query("attendanceRecords")
          .withIndex("by_business_employee", (q) =>
            q.eq("businessId", args.businessId).eq("employeeId", row._id),
          )
          .order("desc")
          .take(60),
      ]);

    const documentRows = await Promise.all(
      documents.map(async (document) => ({
        ...document,
        url: await ctx.storage.getUrl(document.storageId),
      })),
    );
    const salaryVisible = canSensitive || canPayroll;

    return {
      ...maskEmployee(row, canSensitive),
      branchName: branch?.name ?? "—",
      orgUnitName: unit?.name ?? null,
      positionName: position?.name ?? row.jobTitle,
      contracts: [...contracts]
        .sort((a, b) => b.startDate - a.startDate)
        .map((contract) => ({
          ...contract,
          baseSalary: salaryVisible ? contract.baseSalary : null,
          benefits: salaryVisible ? contract.benefits : null,
        })),
      jobHistory: history.sort((a, b) => b.effectiveFrom - a.effectiveFrom),
      documents: documentRows,
      leaves: leaves.sort((a, b) => b.startDate - a.startDate),
      missions: missions.sort((a, b) => b.startDate - a.startDate),
      loans: loans.map((loan) => ({
        ...loan,
        amount: salaryVisible ? loan.amount : 0,
      })),
      attendance,
      permissions: {
        sensitive: canSensitive,
        payroll: salaryVisible,
      },
    };
  },
});

export const createEmployee = mutation({
  args: {
    businessId: v.id("businesses"),
    code: v.optional(v.string()),
    firstName: v.string(),
    lastName: v.string(),
    nationalId: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    birthDate: v.optional(v.number()),
    hireDate: v.number(),
    jobTitle: v.string(),
    positionId: v.optional(v.id("jobPositions")),
    orgUnitId: v.optional(v.id("organizationalUnits")),
    branchId: v.id("branches"),
    employmentType,
    bankName: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    iban: v.optional(v.string()),
    insuranceNumber: v.optional(v.string()),
    address: v.optional(v.string()),
    emergencyContact: v.optional(v.string()),
    leaveEntitlementDays: v.number(),
    notes: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.edit",
      { write: true },
    );
    const firstName = requireString(args.firstName, "نام", { max: 80 }) as string;
    const lastName = requireString(args.lastName, "نام خانوادگی", {
      max: 100,
    }) as string;
    const nationalId = validateNationalId(args.nationalId);
    const phone = validatePhone(args.phone) as string;
    if (!phone) throw new ConvexError("شماره تماس الزامی است.");
    const email = validateEmail(args.email);
    const jobTitle = requireString(args.jobTitle, "عنوان شغلی", {
      max: 120,
    }) as string;
    const hireDate = requireInt(args.hireDate, "تاریخ استخدام", { min: 0 });
    const leaveEntitlementDays = requireInt(
      args.leaveEntitlementDays,
      "مانده مرخصی سالانه",
      { min: 0, max: 366 },
    );
    await branchForBusiness(ctx, args.businessId, args.branchId);
    if (args.orgUnitId) {
      const unit = await ctx.db.get(args.orgUnitId);
      if (!unit || unit.businessId !== args.businessId || unit.archivedAt) {
        throw new ConvexError("واحد سازمانی انتخاب‌شده یافت نشد.");
      }
    }
    if (args.positionId) {
      const position = await ctx.db.get(args.positionId);
      if (!position || position.businessId !== args.businessId) {
        throw new ConvexError("سمت انتخاب‌شده یافت نشد.");
      }
    }
    if (args.userId) {
      const linkedUser = await ctx.db.get(args.userId);
      if (!linkedUser) throw new ConvexError("کاربر انتخاب‌شده یافت نشد.");
    }

    let code = optionalString(args.code, "کد پرسنلی", 40);
    if (code) {
      await uniqueEmployeeCode(ctx, args.businessId, code);
    } else {
      const sequence = await nextCounter(ctx, args.businessId, "employee");
      code = `EMP-${String(sequence).padStart(4, "0")}`;
    }
    await uniqueNationalId(ctx, args.businessId, nationalId);

    const now = Date.now();
    const employeeId = await ctx.db.insert("employees", {
      businessId: args.businessId,
      userId: args.userId,
      code,
      firstName,
      lastName,
      nationalId,
      phone,
      email,
      birthDate: args.birthDate,
      hireDate,
      jobTitle,
      positionId: args.positionId,
      orgUnitId: args.orgUnitId,
      branchId: args.branchId,
      employmentType: args.employmentType,
      status: "active",
      bankName: optionalString(args.bankName, "نام بانک", 80),
      bankAccount: optionalString(args.bankAccount, "شماره حساب", 40),
      iban: optionalString(args.iban, "شماره شبا", 40),
      insuranceNumber: optionalString(args.insuranceNumber, "شماره بیمه", 40),
      address: optionalString(args.address, "نشانی", 500),
      emergencyContact: optionalString(
        args.emergencyContact,
        "تماس اضطراری",
        120,
      ),
      leaveEntitlementDays,
      notes: optionalString(args.notes, "یادداشت", 1000),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("employeeJobHistory", {
      businessId: args.businessId,
      employeeId,
      jobTitle,
      orgUnitId: args.orgUnitId,
      branchId: args.branchId,
      effectiveFrom: hireDate,
      createdBy: user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "employee.create",
      entity: "employees",
      entityId: employeeId,
      summary: `ایجاد پرونده پرسنلی ${firstName} ${lastName}`,
    });
    return { employeeId, code };
  },
});

export const updateEmployee = mutation({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.id("employees"),
    code: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    nationalId: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    birthDate: v.optional(v.number()),
    hireDate: v.optional(v.number()),
    jobTitle: v.optional(v.string()),
    positionId: v.optional(v.id("jobPositions")),
    orgUnitId: v.optional(v.id("organizationalUnits")),
    branchId: v.optional(v.id("branches")),
    employmentType: v.optional(employmentType),
    bankName: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    iban: v.optional(v.string()),
    insuranceNumber: v.optional(v.string()),
    address: v.optional(v.string()),
    emergencyContact: v.optional(v.string()),
    leaveEntitlementDays: v.optional(v.number()),
    notes: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.edit",
      { write: true },
    );
    const row = await employeeForBusiness(
      ctx,
      args.businessId,
      args.employeeId,
    );
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.code !== undefined) {
      const code = requireString(args.code, "کد پرسنلی", { max: 40 }) as string;
      await uniqueEmployeeCode(ctx, args.businessId, code, row._id);
      patch.code = code;
    }
    if (args.nationalId !== undefined) {
      const nationalId = validateNationalId(args.nationalId);
      await uniqueNationalId(ctx, args.businessId, nationalId, row._id);
      patch.nationalId = nationalId;
    }
    if (args.firstName !== undefined)
      patch.firstName = requireString(args.firstName, "نام", { max: 80 });
    if (args.lastName !== undefined)
      patch.lastName = requireString(args.lastName, "نام خانوادگی", {
        max: 100,
      });
    if (args.phone !== undefined) patch.phone = validatePhone(args.phone);
    if (args.email !== undefined) patch.email = validateEmail(args.email);
    if (args.birthDate !== undefined) patch.birthDate = args.birthDate;
    if (args.hireDate !== undefined)
      patch.hireDate = requireInt(args.hireDate, "تاریخ استخدام", { min: 0 });
    if (args.jobTitle !== undefined) {
      patch.jobTitle = requireString(args.jobTitle, "عنوان شغلی", {
        max: 120,
      });
    }
    if (args.branchId !== undefined) {
      await branchForBusiness(ctx, args.businessId, args.branchId);
      patch.branchId = args.branchId;
    }
    if (args.orgUnitId !== undefined) {
      const unit = await ctx.db.get(args.orgUnitId);
      if (!unit || unit.businessId !== args.businessId || unit.archivedAt) {
        throw new ConvexError("واحد سازمانی انتخاب‌شده یافت نشد.");
      }
      patch.orgUnitId = args.orgUnitId;
    }
    if (args.positionId !== undefined) {
      const position = await ctx.db.get(args.positionId);
      if (!position || position.businessId !== args.businessId) {
        throw new ConvexError("سمت انتخاب‌شده یافت نشد.");
      }
      patch.positionId = args.positionId;
    }
    if (args.employmentType !== undefined)
      patch.employmentType = args.employmentType;
    if (args.bankName !== undefined)
      patch.bankName = optionalString(args.bankName, "نام بانک", 80);
    if (args.bankAccount !== undefined)
      patch.bankAccount = optionalString(args.bankAccount, "شماره حساب", 40);
    if (args.iban !== undefined)
      patch.iban = optionalString(args.iban, "شماره شبا", 40);
    if (args.insuranceNumber !== undefined)
      patch.insuranceNumber = optionalString(
        args.insuranceNumber,
        "شماره بیمه",
        40,
      );
    if (args.address !== undefined)
      patch.address = optionalString(args.address, "نشانی", 500);
    if (args.emergencyContact !== undefined)
      patch.emergencyContact = optionalString(
        args.emergencyContact,
        "تماس اضطراری",
        120,
      );
    if (args.leaveEntitlementDays !== undefined)
      patch.leaveEntitlementDays = requireInt(
        args.leaveEntitlementDays,
        "مانده مرخصی سالانه",
        { min: 0, max: 366 },
      );
    if (args.notes !== undefined)
      patch.notes = optionalString(args.notes, "یادداشت", 1000);
    if (args.userId !== undefined) patch.userId = args.userId;

    await ctx.db.patch(row._id, patch);
    if (args.jobTitle !== undefined || args.orgUnitId !== undefined) {
      await ctx.db.insert("employeeJobHistory", {
        businessId: args.businessId,
        employeeId: row._id,
        jobTitle: (patch.jobTitle as string | undefined) ?? row.jobTitle,
        orgUnitId:
          (patch.orgUnitId as Id<"organizationalUnits"> | undefined) ??
          row.orgUnitId,
        branchId: (patch.branchId as Id<"branches"> | undefined) ?? row.branchId,
        effectiveFrom: Date.now(),
        note: "به‌روزرسانی پرونده شغلی",
        createdBy: user._id,
        createdAt: Date.now(),
      });
    }
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "employee.update",
      entity: "employees",
      entityId: row._id,
      summary: `ویرایش پرونده ${employeeName(row)}`,
    });
    return { employeeId: row._id };
  },
});

export const setEmployeeStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.id("employees"),
    status: employeeStatus,
    terminationDate: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.edit",
      { write: true },
    );
    const row = await employeeForBusiness(
      ctx,
      args.businessId,
      args.employeeId,
    );
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: args.status,
      terminationDate:
        args.status === "terminated"
          ? (args.terminationDate ?? now)
          : args.status === "active"
            ? undefined
            : row.terminationDate,
      updatedAt: now,
    });
    if (args.status === "terminated") {
      const contracts = await ctx.db
        .query("employmentContracts")
        .withIndex("by_business_employee", (q) =>
          q.eq("businessId", args.businessId).eq("employeeId", row._id),
        )
        .collect();
      for (const contract of contracts) {
        if (contract.status === "active") {
          await ctx.db.patch(contract._id, {
            status: "ended",
            endedAt: now,
            updatedAt: now,
          });
        }
      }
    }
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "employee.status",
      entity: "employees",
      entityId: row._id,
      summary: `تغییر وضعیت همکاری ${employeeName(row)} به ${args.status}${args.note ? ` — ${args.note}` : ""}`,
    });
    return { employeeId: row._id, status: args.status };
  },
});

export const addJobHistory = mutation({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.id("employees"),
    jobTitle: v.string(),
    orgUnitId: v.optional(v.id("organizationalUnits")),
    branchId: v.id("branches"),
    effectiveFrom: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.edit",
      { write: true },
    );
    const row = await employeeForBusiness(
      ctx,
      args.businessId,
      args.employeeId,
    );
    await branchForBusiness(ctx, args.businessId, args.branchId);
    const jobTitle = requireString(args.jobTitle, "عنوان شغلی", {
      max: 120,
    }) as string;
    const historyId = await ctx.db.insert("employeeJobHistory", {
      businessId: args.businessId,
      employeeId: row._id,
      jobTitle,
      orgUnitId: args.orgUnitId,
      branchId: args.branchId,
      effectiveFrom: requireInt(args.effectiveFrom, "تاریخ شروع", { min: 0 }),
      note: optionalString(args.note, "توضیح", 500),
      createdBy: user._id,
      createdAt: Date.now(),
    });
    await ctx.db.patch(row._id, {
      jobTitle,
      orgUnitId: args.orgUnitId,
      branchId: args.branchId,
      updatedAt: Date.now(),
    });
    return { historyId };
  },
});

export const addEmployeeDocument = mutation({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.id("employees"),
    title: v.string(),
    category: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.edit",
      { write: true },
    );
    const row = await employeeForBusiness(
      ctx,
      args.businessId,
      args.employeeId,
    );
    const title = requireString(args.title, "عنوان مدرک", { max: 150 }) as string;
    const category = requireString(args.category, "دسته مدرک", {
      max: 80,
    }) as string;
    const fileName = requireString(args.fileName, "نام فایل", { max: 200 }) as string;
    await assertFileForBusiness(ctx, args.businessId, args.storageId);
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new ConvexError("فایل بارگذاری‌شده در دسترس نیست.");
    const documentId = await ctx.db.insert("employeeDocuments", {
      businessId: args.businessId,
      employeeId: row._id,
      title,
      category,
      storageId: args.storageId,
      fileName,
      mimeType: optionalString(args.mimeType, "نوع فایل", 120),
      size: args.size,
      description: optionalString(args.description, "توضیح", 500),
      uploadedBy: user._id,
      createdAt: Date.now(),
    });
    return { documentId };
  },
});

/* ------------------------------------------------------------------ *
 * Employment contracts
 * ------------------------------------------------------------------ */

export const contracts = query({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.optional(v.id("employees")),
    status: v.optional(contractStatus),
    expiringDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { permissions } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.view",
    );
    const salaryVisible =
      permissions.includes("hr.sensitive") ||
      permissions.includes("payroll.view");
    let rows: Doc<"employmentContracts">[];
    if (args.employeeId) {
      rows = await ctx.db
        .query("employmentContracts")
        .withIndex("by_business_employee", (q) =>
          q
            .eq("businessId", args.businessId)
            .eq("employeeId", args.employeeId as Id<"employees">),
        )
        .take(500);
    } else {
      rows = await ctx.db
        .query("employmentContracts")
        .withIndex("by_business", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(2000);
    }
    const now = Date.now();
    const threshold =
      now + Math.max(1, Math.min(365, args.expiringDays ?? 30)) * 86_400_000;
    const filtered = rows.filter((contract) => {
      if (args.status && contract.status !== args.status) return false;
      if (
        args.expiringDays !== undefined &&
        (!contract.endDate ||
          contract.endDate < now ||
          contract.endDate > threshold)
      )
        return false;
      return true;
    });
    const employeeIds = [...new Set(filtered.map((row) => row.employeeId))];
    const employees = await Promise.all(
      employeeIds.map((id) => ctx.db.get(id)),
    );
    const names = new Map(
      employees
        .filter((row): row is Doc<"employees"> => Boolean(row))
        .map((row) => [row._id as string, employeeName(row)]),
    );
    return filtered
      .sort((a, b) => b.startDate - a.startDate)
      .map((contract) => ({
        ...contract,
        employeeName: names.get(contract.employeeId as string) ?? "—",
        baseSalary: salaryVisible ? contract.baseSalary : null,
        benefits: salaryVisible ? contract.benefits : null,
        daysToEnd: contract.endDate
          ? Math.ceil((contract.endDate - now) / 86_400_000)
          : null,
      }));
  },
});

export const createContract = mutation({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.id("employees"),
    number: v.optional(v.string()),
    type: employmentType,
    startDate: v.number(),
    endDate: v.optional(v.number()),
    baseSalary: v.number(),
    benefits: v.number(),
    paymentTerms: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.edit",
      { write: true },
    );
    const employee = await employeeForBusiness(
      ctx,
      args.businessId,
      args.employeeId,
    );
    const startDate = requireInt(args.startDate, "تاریخ شروع قرارداد", {
      min: 0,
    });
    if (args.endDate !== undefined && args.endDate < startDate) {
      throw new ConvexError("تاریخ پایان قرارداد نباید قبل از شروع باشد.");
    }
    const baseSalary = requireInt(args.baseSalary, "حقوق پایه", { min: 0 });
    const benefits = requireInt(args.benefits, "مزایا", { min: 0 });
    let number = optionalString(args.number, "شماره قرارداد", 60);
    if (!number) {
      const sequence = await nextCounter(
        ctx,
        args.businessId,
        `contract:${employee._id}`,
      );
      number = `CT-${employee.code}-${String(sequence).padStart(2, "0")}`;
    }
    const duplicate = await ctx.db
      .query("employmentContracts")
      .withIndex("by_business", (q) =>
        q.eq("businessId", args.businessId),
      )
      .filter((q) => q.eq(q.field("number"), number))
      .unique();
    if (duplicate) throw new ConvexError("شماره قرارداد تکراری است.");
    const now = Date.now();
    const contractId = await ctx.db.insert("employmentContracts", {
      businessId: args.businessId,
      employeeId: employee._id,
      number,
      type: args.type,
      startDate,
      endDate: args.endDate,
      baseSalary,
      benefits,
      paymentTerms:
        requireString(args.paymentTerms, "شرایط پرداخت", { max: 500 }) ?? "",
      status: "active",
      notes: optionalString(args.notes, "یادداشت", 1000),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "contract.create",
      entity: "employmentContracts",
      entityId: contractId,
      summary: `ثبت قرارداد ${number} برای ${employeeName(employee)}`,
    });
    return { contractId, number };
  },
});

export const renewContract = mutation({
  args: {
    businessId: v.id("businesses"),
    contractId: v.id("employmentContracts"),
    startDate: v.number(),
    endDate: v.optional(v.number()),
    baseSalary: v.number(),
    benefits: v.number(),
    paymentTerms: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.edit",
      { write: true },
    );
    const contract = await ctx.db.get(args.contractId);
    if (!contract || contract.businessId !== args.businessId) {
      throw new ConvexError("قرارداد در این کسب‌وکار یافت نشد.");
    }
    if (contract.status !== "active") {
      throw new ConvexError("فقط قرارداد فعال قابل تمدید است.");
    }
    if (args.startDate <= contract.startDate) {
      throw new ConvexError("شروع قرارداد جدید باید بعد از قرارداد قبلی باشد.");
    }
    if (args.endDate !== undefined && args.endDate < args.startDate) {
      throw new ConvexError("تاریخ پایان قرارداد معتبر نیست.");
    }
    const employee = await employeeForBusiness(
      ctx,
      args.businessId,
      contract.employeeId,
    );
    const sequence = await nextCounter(
      ctx,
      args.businessId,
      `contract:${employee._id}`,
    );
    const number = `CT-${employee.code}-${String(sequence).padStart(2, "0")}`;
    const now = Date.now();
    await ctx.db.patch(contract._id, {
      status: "renewed",
      endedAt: args.startDate - 1,
      updatedAt: now,
    });
    const contractId = await ctx.db.insert("employmentContracts", {
      businessId: args.businessId,
      employeeId: employee._id,
      number,
      type: contract.type,
      startDate: args.startDate,
      endDate: args.endDate,
      baseSalary: requireInt(args.baseSalary, "حقوق پایه", { min: 0 }),
      benefits: requireInt(args.benefits, "مزایا", { min: 0 }),
      paymentTerms:
        requireString(args.paymentTerms, "شرایط پرداخت", { max: 500 }) ?? "",
      status: "active",
      previousContractId: contract._id,
      notes: optionalString(args.notes, "یادداشت", 1000),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "contract.renew",
      entity: "employmentContracts",
      entityId: contractId,
      summary: `تمدید قرارداد ${contract.number} با ${number}`,
    });
    return { contractId, number };
  },
});

export const endContract = mutation({
  args: {
    businessId: v.id("businesses"),
    contractId: v.id("employmentContracts"),
    endedAt: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.edit",
      { write: true },
    );
    const contract = await ctx.db.get(args.contractId);
    if (!contract || contract.businessId !== args.businessId) {
      throw new ConvexError("قرارداد در این کسب‌وکار یافت نشد.");
    }
    if (contract.status !== "active") {
      throw new ConvexError("این قرارداد قبلاً بسته شده است.");
    }
    await ctx.db.patch(contract._id, {
      status: "ended",
      endedAt: args.endedAt,
      notes: args.note
        ? `${contract.notes ? `${contract.notes}\n` : ""}${args.note}`
        : contract.notes,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "contract.end",
      entity: "employmentContracts",
      entityId: contract._id,
      summary: `پایان قرارداد ${contract.number}`,
    });
    return { contractId: contract._id };
  },
});

/* ------------------------------------------------------------------ *
 * Attendance
 * ------------------------------------------------------------------ */

const DEFAULT_ATTENDANCE = {
  workStartMinute: 8 * 60,
  workEndMinute: 17 * 60,
  graceMinutes: 10,
  expectedDailyMinutes: 8 * 60,
  workDays: [0, 1, 2, 3, 4, 5],
};

export const attendanceSettings = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "attendance.manage");
    const row = await ctx.db
      .query("attendanceSettings")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .unique();
    return (
      row ?? {
        _id: null,
        businessId: args.businessId,
        ...DEFAULT_ATTENDANCE,
        updatedBy: null,
        updatedAt: null,
      }
    );
  },
});

export const updateAttendanceSettings = mutation({
  args: {
    businessId: v.id("businesses"),
    workStartMinute: v.number(),
    workEndMinute: v.number(),
    graceMinutes: v.number(),
    expectedDailyMinutes: v.number(),
    workDays: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "attendance.manage",
      { write: true },
    );
    const start = requireInt(args.workStartMinute, "ساعت شروع", {
      min: 0,
      max: 1439,
    });
    const end = requireInt(args.workEndMinute, "ساعت پایان", {
      min: 0,
      max: 1439,
    });
    if (end <= start) {
      throw new ConvexError("ساعت پایان باید بعد از ساعت شروع باشد.");
    }
    const workDays = [...new Set(args.workDays.map((day) => Math.round(day)))];
    if (workDays.some((day) => day < 0 || day > 6)) {
      throw new ConvexError("روز کاری باید بین ۰ (یکشنبه) تا ۶ (شنبه) باشد.");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("attendanceSettings")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .unique();
    const payload = {
      businessId: args.businessId,
      workStartMinute: start,
      workEndMinute: end,
      graceMinutes: requireInt(args.graceMinutes, "مهلت تأخیر", {
        min: 0,
        max: 180,
      }),
      expectedDailyMinutes: requireInt(
        args.expectedDailyMinutes,
        "دقیقه کاری روزانه",
        { min: 1, max: 1440 },
      ),
      workDays: workDays.sort((a, b) => a - b),
      updatedBy: user._id,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { settingsId: existing._id };
    }
    const settingsId = await ctx.db.insert("attendanceSettings", payload);
    return { settingsId };
  },
});

async function computeAttendance(
  ctx: Parameters<typeof requireMembership>[0],
  input: {
    businessId: Id<"businesses">;
    employee: Doc<"employees">;
    date: number;
    checkInMinute?: number;
    checkOutMinute?: number;
    status?: (typeof attendanceStatus)["type"];
    note?: string;
    source: "manual" | "import" | "device" | "api";
  },
) {
  const settings = (await ctx.db
    .query("attendanceSettings")
    .withIndex("by_business", (q) => q.eq("businessId", input.businessId))
    .unique()) ?? DEFAULT_ATTENDANCE;
  const inMinute = input.checkInMinute;
  const outMinute = input.checkOutMinute;
  if (inMinute !== undefined && (inMinute < 0 || inMinute > 1439)) {
    throw new ConvexError("دقیقه ورود معتبر نیست.");
  }
  if (outMinute !== undefined && (outMinute < 0 || outMinute > 1439)) {
    throw new ConvexError("دقیقه خروج معتبر نیست.");
  }
  if (inMinute !== undefined && outMinute !== undefined && outMinute < inMinute) {
    throw new ConvexError("ساعت خروج نمی‌تواند قبل از ورود باشد.");
  }
  const expected = settings.expectedDailyMinutes;
  const hasTimes = inMinute !== undefined && outMinute !== undefined;
  const work = hasTimes ? (outMinute as number) - (inMinute as number) : 0;
  const late =
    inMinute !== undefined
      ? Math.max(0, inMinute - settings.workStartMinute - settings.graceMinutes)
      : 0;
  const overtime = hasTimes ? Math.max(0, work - expected) : 0;
  let status: (typeof attendanceStatus)["type"] =
    input.status ?? (hasTimes ? (late > 0 ? "late" : "present") : "absent");
  if (status === "leave" || status === "mission" || status === "holiday") {
    const approvedLeave = await ctx.db
      .query("leaveRequests")
      .withIndex("by_business_employee", (q) =>
        q
          .eq("businessId", input.businessId)
          .eq("employeeId", input.employee._id),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "approved"),
          q.lte(q.field("startDate"), input.date),
          q.gte(q.field("endDate"), input.date),
        ),
      )
      .first();
    if (status === "leave" && !approvedLeave) {
      throw new ConvexError("برای ثبت مرخصی، درخواست تأییدشده لازم است.");
    }
  }
  const absence =
    status === "absent"
      ? expected
      : status === "leave" || status === "mission" || status === "holiday"
        ? 0
        : Math.max(0, expected - work);
  return {
    workMinutes: work,
    expectedMinutes: expected,
    lateMinutes: late,
    overtimeMinutes: overtime,
    absenceMinutes: absence,
    status,
  };
}

export const recordAttendance = mutation({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.id("employees"),
    date: v.number(),
    checkInMinute: v.optional(v.number()),
    checkOutMinute: v.optional(v.number()),
    status: v.optional(attendanceStatus),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "attendance.manage",
      { write: true },
    );
    const employee = await employeeForBusiness(
      ctx,
      args.businessId,
      args.employeeId,
    );
    const date = dayStart(args.date);
    const computed = await computeAttendance(ctx, {
      businessId: args.businessId,
      employee,
      date,
      checkInMinute: args.checkInMinute,
      checkOutMinute: args.checkOutMinute,
      status: args.status,
      note: args.note,
      source: "manual",
    });
    const existing = await ctx.db
      .query("attendanceRecords")
      .withIndex("by_employee_date", (q) =>
        q.eq("employeeId", employee._id).eq("date", date),
      )
      .unique();
    const now = Date.now();
    const payload = {
      businessId: args.businessId,
      branchId: employee.branchId,
      employeeId: employee._id,
      date,
      checkInMinute: args.checkInMinute,
      checkOutMinute: args.checkOutMinute,
      ...computed,
      source: "manual" as const,
      note: optionalString(args.note, "توضیح", 500),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    };
    let recordId: Id<"attendanceRecords">;
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      recordId = existing._id;
    } else {
      recordId = await ctx.db.insert("attendanceRecords", payload);
    }
    return { recordId, ...computed };
  },
});

export const importAttendance = mutation({
  args: {
    businessId: v.id("businesses"),
    rows: v.array(
      v.object({
        employeeId: v.id("employees"),
        date: v.number(),
        checkInMinute: v.optional(v.number()),
        checkOutMinute: v.optional(v.number()),
        status: v.optional(attendanceStatus),
        note: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "attendance.manage",
      { write: true },
    );
    if (args.rows.length === 0 || args.rows.length > 500) {
      throw new ConvexError("برای هر بار ورود، بین ۱ تا ۵۰۰ ردیف مجاز است.");
    }
    const now = Date.now();
    let accepted = 0;
    for (const row of args.rows) {
      const employee = await employeeForBusiness(
        ctx,
        args.businessId,
        row.employeeId,
      );
      const date = dayStart(row.date);
      const computed = await computeAttendance(ctx, {
        businessId: args.businessId,
        employee,
        date,
        checkInMinute: row.checkInMinute,
        checkOutMinute: row.checkOutMinute,
        status: row.status,
        source: "import",
      });
      const existing = await ctx.db
        .query("attendanceRecords")
        .withIndex("by_employee_date", (q) =>
          q.eq("employeeId", employee._id).eq("date", date),
        )
        .unique();
      const payload = {
        businessId: args.businessId,
        branchId: employee.branchId,
        employeeId: employee._id,
        date,
        checkInMinute: row.checkInMinute,
        checkOutMinute: row.checkOutMinute,
        ...computed,
        source: "import" as const,
        note: optionalString(row.note, "توضیح", 500),
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, payload);
      } else {
        await ctx.db.insert("attendanceRecords", payload);
      }
      accepted += 1;
    }
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "attendance.import",
      entity: "attendanceRecords",
      entityId: `${now}`,
      summary: `ورود ${accepted} ردیف حضور و غیاب از فایل`,
    });
    return { accepted };
  },
});

export const attendance = query({
  args: {
    businessId: v.id("businesses"),
    from: v.number(),
    to: v.number(),
    branchId: v.optional(v.id("branches")),
    orgUnitId: v.optional(v.id("organizationalUnits")),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "hr.view");
    const rows = await ctx.db
      .query("attendanceRecords")
      .withIndex("by_business_date", (q) =>
        q
          .eq("businessId", args.businessId)
          .gte("date", dayStart(args.from))
          .lte("date", dayStart(args.to)),
      )
      .take(5000);
    const employeeRows = await ctx.db
      .query("employees")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(2000);
    const employees = new Map(employeeRows.map((row) => [row._id as string, row]));
    const filtered = rows.filter((row) => {
      if (args.branchId && row.branchId !== args.branchId) return false;
      if (args.employeeId && row.employeeId !== args.employeeId) return false;
      if (args.orgUnitId) {
        const employee = employees.get(row.employeeId as string);
        if (!employee || employee.orgUnitId !== args.orgUnitId) return false;
      }
      return true;
    });
    return filtered
      .map((row) => {
        const employee = employees.get(row.employeeId as string);
        return {
          ...row,
          employeeName: employee ? employeeName(employee) : "—",
          employeeCode: employee?.code ?? "—",
        };
      })
      .sort((a, b) => b.date - a.date);
  },
});

export const attendanceReport = query({
  args: {
    businessId: v.id("businesses"),
    from: v.number(),
    to: v.number(),
    branchId: v.optional(v.id("branches")),
    orgUnitId: v.optional(v.id("organizationalUnits")),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "hr.view");
    const rows = await ctx.db
      .query("attendanceRecords")
      .withIndex("by_business_date", (q) =>
        q
          .eq("businessId", args.businessId)
          .gte("date", dayStart(args.from))
          .lte("date", dayStart(args.to)),
      )
      .take(5000);
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(2000);
    const byId = new Map(employees.map((row) => [row._id as string, row]));
    const grouped = new Map<
      string,
      {
        employeeId: string;
        name: string;
        code: string;
        days: number;
        workMinutes: number;
        overtimeMinutes: number;
        lateMinutes: number;
        absenceMinutes: number;
        leaveDays: number;
        missionDays: number;
      }
    >();
    for (const row of rows) {
      const employee = byId.get(row.employeeId as string);
      if (!employee) continue;
      if (args.branchId && row.branchId !== args.branchId) continue;
      if (args.orgUnitId && employee.orgUnitId !== args.orgUnitId) continue;
      const key = employee._id as string;
      const entry =
        grouped.get(key) ??
        {
          employeeId: key,
          name: employeeName(employee),
          code: employee.code,
          days: 0,
          workMinutes: 0,
          overtimeMinutes: 0,
          lateMinutes: 0,
          absenceMinutes: 0,
          leaveDays: 0,
          missionDays: 0,
        };
      entry.days += 1;
      entry.workMinutes += row.workMinutes;
      entry.overtimeMinutes += row.overtimeMinutes;
      entry.lateMinutes += row.lateMinutes;
      entry.absenceMinutes += row.absenceMinutes;
      if (row.status === "leave") entry.leaveDays += 1;
      if (row.status === "mission") entry.missionDays += 1;
      grouped.set(key, entry);
    }
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "fa"));
  },
});

/* ------------------------------------------------------------------ *
 * Leave and missions
 * ------------------------------------------------------------------ */

async function leaveUsed(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  employeeId: Id<"employees">,
  year: number,
) {
  const rows = await ctx.db
    .query("leaveRequests")
    .withIndex("by_business_employee", (q) =>
      q.eq("businessId", businessId).eq("employeeId", employeeId),
    )
    .filter((q) => q.eq(q.field("status"), "approved"))
    .collect();
  return rows
    .filter((row) => row.type === "annual" && currentJalaliYear(row.startDate) === year)
    .reduce((sum, row) => sum + row.days, 0);
}

export const leaveBalance = query({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.id("employees"),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "hr.view");
    const employee = await employeeForBusiness(
      ctx,
      args.businessId,
      args.employeeId,
    );
    const year = args.year ?? currentJalaliYear(Date.now());
    const used = await leaveUsed(
      ctx,
      args.businessId,
      employee._id,
      year,
    );
    const pendingRows = await ctx.db
      .query("leaveRequests")
      .withIndex("by_business_employee", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("employeeId", employee._id),
      )
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    const pending = pendingRows
      .filter(
        (row) =>
          row.type === "annual" &&
          currentJalaliYear(row.startDate) === year,
      )
      .reduce((sum, row) => sum + row.days, 0);
    return {
      year,
      entitlement: employee.leaveEntitlementDays,
      used,
      pending,
      remaining: Math.max(0, employee.leaveEntitlementDays - used - pending),
    };
  },
});

export const leaveRequests = query({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.optional(v.id("employees")),
    status: v.optional(requestStatus),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "hr.view");
    const rows = args.employeeId
      ? await ctx.db
          .query("leaveRequests")
          .withIndex("by_business_employee", (q) =>
            q
              .eq("businessId", args.businessId)
              .eq("employeeId", args.employeeId as Id<"employees">),
          )
          .take(1000)
      : await ctx.db
          .query("leaveRequests")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(2000);
    const filtered = rows.filter(
      (row) => !args.status || row.status === args.status,
    );
    const employeeIds = [...new Set(filtered.map((row) => row.employeeId))];
    const employees = await Promise.all(
      employeeIds.map((id) => ctx.db.get(id)),
    );
    const names = new Map(
      employees
        .filter((row): row is Doc<"employees"> => Boolean(row))
        .map((row) => [row._id as string, employeeName(row)]),
    );
    return filtered
      .sort((a, b) => b.startDate - a.startDate)
      .map((row) => ({
        ...row,
        employeeName: names.get(row.employeeId as string) ?? "—",
      }));
  },
});

export const createLeaveRequest = mutation({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.id("employees"),
    type: leaveType,
    startDate: v.number(),
    endDate: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, permissions } = await requireHrPermission(
      ctx,
      args.businessId,
      "leave.request",
    );
    const employee = await employeeForBusiness(
      ctx,
      args.businessId,
      args.employeeId,
    );
    if (
      !permissions.includes("hr.edit") &&
      employee.userId !== user._id
    ) {
      throw new ConvexError("اجازه ثبت درخواست برای پرسنل دیگر را ندارید.");
    }
    const startDate = dayStart(args.startDate);
    const endDate = dayStart(args.endDate);
    const days = inclusiveDays(startDate, endDate);
    const reason = requireString(args.reason, "علت درخواست", {
      max: 500,
    }) as string;
    const overlap = await ctx.db
      .query("leaveRequests")
      .withIndex("by_business_employee", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("employeeId", employee._id),
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "rejected"),
          q.neq(q.field("status"), "cancelled"),
          q.lte(q.field("startDate"), endDate),
          q.gte(q.field("endDate"), startDate),
        ),
      )
      .first();
    if (overlap) {
      throw new ConvexError("درخواست مرخصی با یک درخواست فعال دیگر هم‌پوشانی دارد.");
    }
    if (args.type === "annual") {
      const year = currentJalaliYear(startDate);
      const used = await leaveUsed(ctx, args.businessId, employee._id, year);
      if (used + days > employee.leaveEntitlementDays) {
        throw new ConvexError(
          `مانده مرخصی سالانه کافی نیست؛ مانده ${Math.max(0, employee.leaveEntitlementDays - used)} روز است.`,
        );
      }
    }
    const now = Date.now();
    const requestId = await ctx.db.insert("leaveRequests", {
      businessId: args.businessId,
      branchId: employee.branchId,
      employeeId: employee._id,
      type: args.type,
      startDate,
      endDate,
      days,
      reason,
      status: "pending",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("leaveRequestHistory", {
      businessId: args.businessId,
      requestId,
      toStatus: "pending",
      actorId: user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "leave.request",
      entity: "leaveRequests",
      entityId: requestId,
      summary: `درخواست مرخصی ${days} روزه برای ${employeeName(employee)}`,
    });
    return { requestId, days };
  },
});

export const decideLeaveRequest = mutation({
  args: {
    businessId: v.id("businesses"),
    requestId: v.id("leaveRequests"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "leave.approve",
      { write: true },
    );
    const request = await ctx.db.get(args.requestId);
    if (!request || request.businessId !== args.businessId) {
      throw new ConvexError("درخواست مرخصی یافت نشد.");
    }
    if (request.status !== "pending") {
      throw new ConvexError("این درخواست قبلاً بررسی شده است.");
    }
    const employee = await employeeForBusiness(
      ctx,
      args.businessId,
      request.employeeId,
    );
    if (args.decision === "approved" && request.type === "annual") {
      const year = currentJalaliYear(request.startDate);
      const used = await leaveUsed(
        ctx,
        args.businessId,
        employee._id,
        year,
      );
      if (used + request.days > employee.leaveEntitlementDays) {
        throw new ConvexError("مانده مرخصی سالانه برای تأیید کافی نیست.");
      }
    }
    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: args.decision,
      decidedBy: user._id,
      decidedAt: now,
      decisionNote: optionalString(args.note, "توضیح", 500),
      updatedAt: now,
    });
    await ctx.db.insert("leaveRequestHistory", {
      businessId: args.businessId,
      requestId: request._id,
      fromStatus: "pending",
      toStatus: args.decision,
      note: optionalString(args.note, "توضیح", 500),
      actorId: user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "leave.decide",
      entity: "leaveRequests",
      entityId: request._id,
      summary: `${args.decision === "approved" ? "تأیید" : "رد"} مرخصی ${employeeName(employee)}`,
    });
    return { requestId: request._id, status: args.decision };
  },
});

export const cancelLeaveRequest = mutation({
  args: {
    businessId: v.id("businesses"),
    requestId: v.id("leaveRequests"),
  },
  handler: async (ctx, args) => {
    const { user, permissions } = await requireHrPermission(
      ctx,
      args.businessId,
      "leave.request",
    );
    const request = await ctx.db.get(args.requestId);
    if (!request || request.businessId !== args.businessId) {
      throw new ConvexError("درخواست مرخصی یافت نشد.");
    }
    const employee = await employeeForBusiness(
      ctx,
      args.businessId,
      request.employeeId,
    );
    if (!permissions.includes("hr.edit") && employee.userId !== user._id) {
      throw new ConvexError("اجازه لغو این درخواست را ندارید.");
    }
    if (request.status !== "pending") {
      throw new ConvexError("فقط درخواست در انتظار قابل لغو است.");
    }
    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: "cancelled",
      decidedBy: user._id,
      decidedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("leaveRequestHistory", {
      businessId: args.businessId,
      requestId: request._id,
      fromStatus: "pending",
      toStatus: "cancelled",
      actorId: user._id,
      createdAt: now,
    });
    return { requestId: request._id, status: "cancelled" as const };
  },
});

export const leaveHistory = query({
  args: {
    businessId: v.id("businesses"),
    requestId: v.id("leaveRequests"),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "hr.view");
    return await ctx.db
      .query("leaveRequestHistory")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .order("asc")
      .collect();
  },
});

export const missions = query({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.optional(v.id("employees")),
    status: v.optional(requestStatus),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "hr.view");
    const rows = args.employeeId
      ? await ctx.db
          .query("missions")
          .withIndex("by_business_employee", (q) =>
            q
              .eq("businessId", args.businessId)
              .eq("employeeId", args.employeeId as Id<"employees">),
          )
          .take(1000)
      : await ctx.db
          .query("missions")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(2000);
    const filtered = rows.filter(
      (row) => !args.status || row.status === args.status,
    );
    const employeeIds = [...new Set(filtered.map((row) => row.employeeId))];
    const employees = await Promise.all(
      employeeIds.map((id) => ctx.db.get(id)),
    );
    const names = new Map(
      employees
        .filter((row): row is Doc<"employees"> => Boolean(row))
        .map((row) => [row._id as string, employeeName(row)]),
    );
    return filtered
      .sort((a, b) => b.startDate - a.startDate)
      .map((row) => ({
        ...row,
        employeeName: names.get(row.employeeId as string) ?? "—",
      }));
  },
});

export const createMission = mutation({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.id("employees"),
    startDate: v.number(),
    endDate: v.number(),
    destination: v.string(),
    purpose: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, permissions } = await requireHrPermission(
      ctx,
      args.businessId,
      "leave.request",
    );
    const employee = await employeeForBusiness(
      ctx,
      args.businessId,
      args.employeeId,
    );
    if (!permissions.includes("hr.edit") && employee.userId !== user._id) {
      throw new ConvexError("اجازه ثبت مأموریت برای پرسنل دیگر را ندارید.");
    }
    const startDate = dayStart(args.startDate);
    const endDate = dayStart(args.endDate);
    inclusiveDays(startDate, endDate);
    const now = Date.now();
    const missionId = await ctx.db.insert("missions", {
      businessId: args.businessId,
      branchId: employee.branchId,
      employeeId: employee._id,
      startDate,
      endDate,
      destination: requireString(args.destination, "مقصد", {
        max: 200,
      }) as string,
      purpose: requireString(args.purpose, "هدف مأموریت", {
        max: 500,
      }) as string,
      status: "pending",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    return { missionId };
  },
});

export const decideMission = mutation({
  args: {
    businessId: v.id("businesses"),
    missionId: v.id("missions"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "leave.approve",
      { write: true },
    );
    const mission = await ctx.db.get(args.missionId);
    if (!mission || mission.businessId !== args.businessId) {
      throw new ConvexError("مأموریت یافت نشد.");
    }
    if (mission.status !== "pending") {
      throw new ConvexError("این مأموریت قبلاً بررسی شده است.");
    }
    await ctx.db.patch(mission._id, {
      status: args.decision,
      decidedBy: user._id,
      decidedAt: Date.now(),
      decisionNote: optionalString(args.note, "توضیح", 500),
      updatedAt: Date.now(),
    });
    return { missionId: mission._id, status: args.decision };
  },
});

/* ------------------------------------------------------------------ *
 * Branches, organisational units and positions
 * ------------------------------------------------------------------ */

export const branches = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("branches")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const [employees, warehouses, accounts, funds] = await Promise.all([
      ctx.db
        .query("employees")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(2000),
      ctx.db
        .query("warehouses")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(500),
      ctx.db
        .query("bankAccounts")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(500),
      ctx.db
        .query("cashFunds")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(500),
    ]);
    return rows
      .filter((row) => !row.archivedAt)
      .map((branch) => ({
        ...branch,
        employeeCount: employees.filter(
          (row) => row.branchId === branch._id && row.status !== "terminated",
        ).length,
        warehouseCount: warehouses.filter(
          (row) => row.branchId === branch._id && row.active,
        ).length,
        bankAccountCount: accounts.filter(
          (row) => row.branchId === branch._id,
        ).length,
        cashFundCount: funds.filter((row) => row.branchId === branch._id).length,
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  },
});

export const createBranch = mutation({
  args: {
    businessId: v.id("businesses"),
    name: v.string(),
    code: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    managerEmployeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "branches.manage",
      { manage: true },
    );
    await assertBranchCapacity(ctx, args.businessId);
    const name = requireString(args.name, "نام شعبه", { max: 120 }) as string;
    const code = (requireString(args.code, "کد شعبه", { max: 30 }) as string)
      .toUpperCase()
      .replace(/\s/g, "-");
    const duplicate = await ctx.db
      .query("branches")
      .withIndex("by_business_code", (q) =>
        q.eq("businessId", args.businessId).eq("code", code),
      )
      .unique();
    if (duplicate) throw new ConvexError("کد شعبه تکراری است.");
    if (args.managerEmployeeId) {
      await employeeForBusiness(ctx, args.businessId, args.managerEmployeeId);
    }
    const now = Date.now();
    const branchId = await ctx.db.insert("branches", {
      businessId: args.businessId,
      name,
      code,
      isPrimary: false,
      address: optionalString(args.address, "نشانی", 500),
      phone: validatePhone(args.phone),
      email: validateEmail(args.email),
      managerEmployeeId: args.managerEmployeeId,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "branch.create",
      entity: "branches",
      entityId: branchId,
      summary: `ایجاد شعبه ${name}`,
    });
    return { branchId };
  },
});

export const updateBranch = mutation({
  args: {
    businessId: v.id("businesses"),
    branchId: v.id("branches"),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    managerEmployeeId: v.optional(v.id("employees")),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "branches.manage",
      { manage: true },
    );
    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.businessId !== args.businessId || branch.archivedAt) {
      throw new ConvexError("شعبه یافت نشد.");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined)
      patch.name = requireString(args.name, "نام شعبه", { max: 120 });
    if (args.address !== undefined)
      patch.address = optionalString(args.address, "نشانی", 500);
    if (args.phone !== undefined) patch.phone = validatePhone(args.phone);
    if (args.email !== undefined) patch.email = validateEmail(args.email);
    if (args.managerEmployeeId !== undefined) {
      await employeeForBusiness(ctx, args.businessId, args.managerEmployeeId);
      patch.managerEmployeeId = args.managerEmployeeId;
    }
    if (args.active !== undefined) {
      if (!args.active && branch.isPrimary) {
        throw new ConvexError("شعبه اصلی قابل غیرفعال‌سازی نیست.");
      }
      patch.active = args.active;
    }
    await ctx.db.patch(branch._id, patch);
    if (patch.name) {
      const warehouses = await ctx.db
        .query("warehouses")
        .withIndex("by_business", (q) =>
          q.eq("businessId", args.businessId),
        )
        .collect();
      // Warehouse keeps its own name; only the branch assignment changes.
      void warehouses;
    }
    return { branchId: branch._id };
  },
});

export const orgUnits = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "hr.view");
    const rows = await ctx.db
      .query("organizationalUnits")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(2000);
    return rows
      .filter((row) => !row.archivedAt)
      .map((row) => ({
        ...row,
        employeeCount: employees.filter(
          (employee) =>
            employee.orgUnitId === row._id &&
            employee.status !== "terminated",
        ).length,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  },
});

export const createOrgUnit = mutation({
  args: {
    businessId: v.id("businesses"),
    name: v.string(),
    code: v.string(),
    parentId: v.optional(v.id("organizationalUnits")),
    branchId: v.optional(v.id("branches")),
    managerEmployeeId: v.optional(v.id("employees")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.edit",
      { write: true },
    );
    const code = (requireString(args.code, "کد واحد", { max: 30 }) as string)
      .toUpperCase()
      .replace(/\s/g, "-");
    const duplicate = await ctx.db
      .query("organizationalUnits")
      .withIndex("by_business_code", (q) =>
        q.eq("businessId", args.businessId).eq("code", code),
      )
      .unique();
    if (duplicate) throw new ConvexError("کد واحد سازمانی تکراری است.");
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.businessId !== args.businessId) {
        throw new ConvexError("واحد والد یافت نشد.");
      }
    }
    if (args.branchId) {
      await branchForBusiness(ctx, args.businessId, args.branchId);
    }
    if (args.managerEmployeeId) {
      await employeeForBusiness(ctx, args.businessId, args.managerEmployeeId);
    }
    const now = Date.now();
    const unitId = await ctx.db.insert("organizationalUnits", {
      businessId: args.businessId,
      branchId: args.branchId,
      name: requireString(args.name, "نام واحد", { max: 120 }) as string,
      code,
      parentId: args.parentId,
      managerEmployeeId: args.managerEmployeeId,
      description: optionalString(args.description, "توضیح", 500),
      active: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    return { unitId };
  },
});

export const updateOrgUnit = mutation({
  args: {
    businessId: v.id("businesses"),
    unitId: v.id("organizationalUnits"),
    name: v.optional(v.string()),
    parentId: v.optional(v.id("organizationalUnits")),
    managerEmployeeId: v.optional(v.id("employees")),
    description: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "hr.edit", { write: true });
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.businessId !== args.businessId || unit.archivedAt) {
      throw new ConvexError("واحد سازمانی یافت نشد.");
    }
    if (args.parentId === unit._id) {
      throw new ConvexError("واحد نمی‌تواند والد خودش باشد.");
    }
    if (args.parentId) {
      let cursor: Doc<"organizationalUnits"> | null = await ctx.db.get(
        args.parentId,
      );
      if (!cursor || cursor.businessId !== args.businessId) {
        throw new ConvexError("واحد والد یافت نشد.");
      }
      const seen = new Set<string>();
      while (cursor) {
        if (cursor._id === unit._id) {
          throw new ConvexError("این رابطه ساختار درختی را حلقه‌ای می‌کند.");
        }
        if (!cursor.parentId || seen.has(cursor._id as string)) break;
        seen.add(cursor._id as string);
        cursor = await ctx.db.get(cursor.parentId);
      }
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined)
      patch.name = requireString(args.name, "نام واحد", { max: 120 });
    if (args.parentId !== undefined) patch.parentId = args.parentId;
    if (args.managerEmployeeId !== undefined) {
      if (args.managerEmployeeId) {
        await employeeForBusiness(ctx, args.businessId, args.managerEmployeeId);
      }
      patch.managerEmployeeId = args.managerEmployeeId;
    }
    if (args.description !== undefined)
      patch.description = optionalString(args.description, "توضیح", 500);
    if (args.active !== undefined) patch.active = args.active;
    await ctx.db.patch(unit._id, patch);
    return { unitId: unit._id };
  },
});

export const positions = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "hr.view");
    return await ctx.db
      .query("jobPositions")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});

export const createPosition = mutation({
  args: {
    businessId: v.id("businesses"),
    name: v.string(),
    code: v.string(),
    orgUnitId: v.optional(v.id("organizationalUnits")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "hr.edit",
      { write: true },
    );
    const code = (requireString(args.code, "کد سمت", { max: 30 }) as string)
      .toUpperCase()
      .replace(/\s/g, "-");
    const duplicate = await ctx.db
      .query("jobPositions")
      .withIndex("by_business_code", (q) =>
        q.eq("businessId", args.businessId).eq("code", code),
      )
      .unique();
    if (duplicate) throw new ConvexError("کد سمت تکراری است.");
    const now = Date.now();
    const positionId = await ctx.db.insert("jobPositions", {
      businessId: args.businessId,
      name: requireString(args.name, "نام سمت", { max: 120 }) as string,
      code,
      orgUnitId: args.orgUnitId,
      description: optionalString(args.description, "توضیح", 500),
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    void user;
    return { positionId };
  },
});

/* ------------------------------------------------------------------ *
 * Member permission administration
 * ------------------------------------------------------------------ */

export const members = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "branches.manage");
    const rows = await ctx.db
      .query("businessMembers")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const users = await Promise.all(rows.map((row) => ctx.db.get(row.userId)));
    return rows.map((row, index) => ({
      _id: row._id as string,
      userId: row.userId as string,
      role: row.role,
      displayName:
        row.displayName ??
        users[index]?.name ??
        users[index]?.email ??
        "کاربر",
      email: users[index]?.email ?? null,
      permissions: [...new Set(permissionsFor(row))],
    }));
  },
});

export const setMemberPermissions = mutation({
  args: {
    businessId: v.id("businesses"),
    memberId: v.id("businessMembers"),
    permissions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      manage: true,
    });
    const member = await ctx.db.get(args.memberId);
    if (!member || member.businessId !== args.businessId) {
      throw new ConvexError("عضو کسب‌وکار یافت نشد.");
    }
    if (member.role === "owner") {
      throw new ConvexError("مجوزهای مالک کسب‌وکار قابل محدودسازی نیست.");
    }
    const allowed = new Set<string>(HR_PERMISSIONS);
    const permissions = [...new Set(args.permissions)].filter((permission) =>
      allowed.has(permission),
    );
    await ctx.db.patch(member._id, {
      permissions,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "member.permissions",
      entity: "businessMembers",
      entityId: member._id,
      summary: `به‌روزرسانی ${permissions.length} مجوز سازمانی`,
    });
    return { memberId: member._id, permissions };
  },
});

/**
 * ---------------------------------------------------------------
 * Permission introspection for the UI. It never returns salary data.
 * ---------------------------------------------------------------
 */
export const access = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { membership } = await requireMembership(ctx, args.businessId);
    const permissions = permissionsFor(membership);
    return {
      role: membership.role,
      permissions,
      can: Object.fromEntries(
        HR_PERMISSIONS.map((permission) => [
          permission,
          membershipHasPermission(membership, permission as HrPermission),
        ]),
      ) as Record<HrPermission, boolean>,
    };
  },
});
