import { v } from "convex/values";
import { query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("legalPages").take(20);
    return rows
      .filter((row) => row.active)
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((row) => ({
        _id: row._id,
        slug: row.slug,
        title: row.title,
        version: row.version,
        updatedAt: row.updatedAt,
      }));
  },
});

export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const slug = args.slug.trim().toLowerCase();
    const row = await ctx.db
      .query("legalPages")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!row || !row.active) return null;
    return {
      _id: row._id,
      slug: row.slug,
      title: row.title,
      content: row.content,
      version: row.version,
      updatedAt: row.updatedAt,
    };
  },
});
