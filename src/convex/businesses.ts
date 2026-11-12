import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireUser } from "./lib/tenant";
import { requireString } from "./lib/validation";
import {
  ensureWorkspaceDefaults,
  provisionBusinessWorkspace,
} from "./lib/workspace";
import { permissionsFor } from "./lib/hr";

/**
 * Returns the signed-in user's workspace (business) plus their role.
 * v1 is single-workspace per user; the schema already supports many.
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const memberships = await ctx.db
      .query("businessMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const membership of memberships) {
      const business = await ctx.db.get(membership.businessId);
      if (!business || business.archivedAt) continue;

      return {
        business: {
          _id: business._id,
          name: business.name,
          currency: business.currency,
          currencyDecimals: business.currencyDecimals,
          taxRateBps: business.taxRateBps,
        },
        role: membership.role,
      };
    }

    return null;
  },
});

/**
 * Everything the authenticated shell needs to switch between workspaces and
 * their real branches / fiscal years. Access is limited to the caller's own
 * memberships; a client can never ask for another tenant's context.
 */
export const context = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;

    const memberships = await ctx.db
      .query("businessMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const workspaces = [];
    const branches = [];
    const fiscalYears = [];

    for (const membership of memberships) {
      const business = await ctx.db.get(membership.businessId);
      if (!business || business.archivedAt) continue;

      workspaces.push({
        business: {
          _id: business._id,
          name: business.name,
          slug: business.slug,
          currency: business.currency,
          currencyDecimals: business.currencyDecimals,
          taxRateBps: business.taxRateBps,
        },
        role: membership.role,
        permissions: permissionsFor(membership),
      });

      const [businessBranches, businessFiscalYears] = await Promise.all([
        ctx.db
          .query("branches")
          .withIndex("by_business", (q) =>
            q.eq("businessId", business._id),
          )
          .collect(),
        ctx.db
          .query("fiscalYears")
          .withIndex("by_business", (q) =>
            q.eq("businessId", business._id),
          )
          .collect(),
      ]);

      branches.push(
        ...businessBranches
          .filter((branch) => !branch.archivedAt)
          .map((branch) => ({
            _id: branch._id,
            businessId: branch.businessId,
            name: branch.name,
            code: branch.code,
            isPrimary: branch.isPrimary,
            address: branch.address ?? null,
            phone: branch.phone ?? null,
            managerName: branch.managerName ?? null,
            active: branch.active ?? true,
          })),
      );
      fiscalYears.push(
        ...businessFiscalYears.map((fiscalYear) => ({
          _id: fiscalYear._id,
          businessId: fiscalYear.businessId,
          name: fiscalYear.name,
          startAt: fiscalYear.startAt,
          endAt: fiscalYear.endAt,
          status: fiscalYear.status,
        })),
      );
    }

    workspaces.sort((a, b) => a.business.name.localeCompare(b.business.name, "fa"));
    branches.sort((a, b) => a.code.localeCompare(b.code));
    fiscalYears.sort((a, b) => b.startAt - a.startAt);

    return {
      user: {
        _id: user._id as string,
        name: user.name ?? null,
        email: user.email ?? null,
        image: user.image ?? null,
        isAnonymous: Boolean(user.isAnonymous),
      },
      workspaces,
      branches,
      fiscalYears,
    };
  },
});

/**
 * Idempotently backfills defaults for existing memberships. It deliberately no
 * longer creates a tenant for a brand-new account: from Phase 11, workspace
 * creation must go through the signed-in onboarding/checkout flow.
 */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    const existingMemberships = await ctx.db
      .query("businessMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    let firstBusinessId: (typeof existingMemberships)[number]["businessId"] | null =
      null;
    for (const membership of existingMemberships) {
      const business = await ctx.db.get(membership.businessId);
      if (business && !business.archivedAt) {
        await ensureWorkspaceDefaults(ctx, business);
        if (!firstBusinessId) firstBusinessId = business._id;
      }
    }
    if (!firstBusinessId) {
      throw new ConvexError(
        "هنوز فضای کاری ندارید. لطفاً فرایند ثبت‌نام و انتخاب پلن را کامل کنید.",
      );
    }
    return { businessId: firstBusinessId, created: false as const };
  },
});

/**
 * Internal-only fixture/migration helper. It is not callable from a browser
 * client and is used by the server-side test suites to create legacy tenants.
 * It can never bypass a subscription for a Phase 11 workspace because it
 * explicitly marks the tenant as legacy (subscriptionRequired: false).
 */
export const seedWorkspace = internalMutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("businessMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const membership of existing) {
      const business = await ctx.db.get(membership.businessId);
      if (business && !business.archivedAt) {
        await ensureWorkspaceDefaults(ctx, business);
        return { businessId: business._id, created: false as const };
      }
    }
    const fallbackName = user.name?.trim()
      ? `کسب‌وکار ${user.name.trim()}`
      : "فروشگاه من";
    const name = args.name
      ? (requireString(args.name, "نام کسب‌وکار", { max: 120 }) as string)
      : fallbackName;
    const businessId = await provisionBusinessWorkspace(ctx, user, {
      name,
      subscriptionRequired: false,
    });
    return { businessId, created: true as const };
  },
});
