import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { currentFiscalYear } from "./calendar";
import { ensureChartOfAccounts } from "./accounts";
import { writeAudit } from "./tenant";

export interface ProvisionWorkspaceInput {
  name: string;
  subscriptionRequired?: boolean;
  businessType?: string;
  city?: string;
  economicCode?: string;
  contactPhone?: string;
  onboardingKey?: string;
}

/**
 * Creates a tenant plus the owner membership and all operational defaults.
 * Used by the Phase 11 onboarding mutation. The public legacy `businesses.ensure`
 * intentionally cannot call this, so a signed-in user cannot bypass checkout
 * by hitting an auto-provision endpoint.
 */
export async function provisionBusinessWorkspace(
  ctx: MutationCtx,
  user: Doc<"users">,
  input: ProvisionWorkspaceInput,
) {
  const now = Date.now();
  const slug = `biz-${now.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const businessId = await ctx.db.insert("businesses", {
    name: input.name,
    slug,
    currency: "IRT",
    currencyDecimals: 0,
    taxRateBps: 900,
    createdBy: user._id,
    createdAt: now,
    updatedAt: now,
    subscriptionRequired: input.subscriptionRequired ?? true,
    businessType: input.businessType,
    city: input.city,
    economicCode: input.economicCode,
    contactPhone: input.contactPhone,
    onboardingKey: input.onboardingKey,
  });

  await ctx.db.insert("businessMembers", {
    businessId,
    userId: user._id,
    role: "owner",
    displayName: user.name,
    createdAt: now,
    updatedAt: now,
  });

  const business = await ctx.db.get(businessId);
  if (business) await ensureWorkspaceDefaults(ctx, business);

  await writeAudit(ctx, {
    businessId,
    actorId: user._id,
    action: "business.create",
    entity: "businesses",
    entityId: businessId,
    summary: `ایجاد فضای کاری «${input.name}»`,
  });

  return businessId;
}

/**
 * Ensures the organisation context every operational document needs.
 * This is idempotent and safe to call on every app boot.
 */
export async function ensureWorkspaceDefaults(
  ctx: MutationCtx,
  business: Doc<"businesses">,
) {
  const now = Date.now();
  const branches = await ctx.db
    .query("branches")
    .withIndex("by_business", (q) => q.eq("businessId", business._id))
    .collect();

  let primaryBranch = branches.find((branch) => branch.isPrimary);
  if (!primaryBranch && branches.length > 0) {
    primaryBranch = branches[0];
    if (!primaryBranch.isPrimary) {
      await ctx.db.patch(primaryBranch._id, { isPrimary: true, updatedAt: now });
      primaryBranch = { ...primaryBranch, isPrimary: true };
    }
  }

  if (!primaryBranch) {
    const branchId = await ctx.db.insert("branches", {
      businessId: business._id,
      name: "شعبه اصلی",
      code: "BR-0001",
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    });
    primaryBranch = (await ctx.db.get(branchId)) ?? undefined;
  }

  const fiscalYears = await ctx.db
    .query("fiscalYears")
    .withIndex("by_business", (q) => q.eq("businessId", business._id))
    .collect();

  let activeFiscalYear = fiscalYears.find(
    (fiscalYear) =>
      fiscalYear.status === "open" &&
      fiscalYear.startAt <= now &&
      fiscalYear.endAt >= now,
  );

  if (!activeFiscalYear) {
    const current = currentFiscalYear(now);
    activeFiscalYear = fiscalYears.find(
      (fiscalYear) => fiscalYear.startAt === current.startAt,
    );
    if (!activeFiscalYear) {
      const fiscalYearId = await ctx.db.insert("fiscalYears", {
        businessId: business._id,
        name: current.name,
        startAt: current.startAt,
        endAt: current.endAt,
        status: "open",
        createdAt: now,
      });
      activeFiscalYear = (await ctx.db.get(fiscalYearId)) ?? undefined;
    }
  }

  await ensureChartOfAccounts(ctx, business._id, business.createdBy);

  return {
    primaryBranch,
    fiscalYears,
    activeFiscalYear,
  };
}

export async function findFiscalYearForTimestamp(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  timestamp: number,
) {
  const fiscalYears = await ctx.db
    .query("fiscalYears")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  const match = fiscalYears.find(
    (fiscalYear) =>
      fiscalYear.startAt <= timestamp && fiscalYear.endAt >= timestamp,
  );
  if (match) return match;

  const defaults = await ctx.db
    .query("fiscalYears")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  return (
    defaults.find((fiscalYear) => fiscalYear.status === "open") ?? defaults[0]
  );
}

/**
 * Assigns the operational branch / fiscal-year pair at write time. Existing
 * documents without these fields are still handled by the reporting fallbacks.
 */
export async function resolveDocumentScope(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  occurredAt: number,
) {
  const branches = await ctx.db
    .query("branches")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  const branch =
    branches.find((item) => item.isPrimary) ??
    branches.find((item) => !item.archivedAt);
  const fiscalYear = await findFiscalYearForTimestamp(
    ctx,
    businessId,
    occurredAt,
  );

  return {
    branchId: branch?._id,
    fiscalYearId: fiscalYear?._id,
  };
}
