import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  buildAssistantSnapshot,
  type AssistantSnapshot,
} from "./analytics";
import { requireMembership } from "./lib/tenant";
import { jalaliDateLabel } from "./lib/calendar";

const MAX_QUESTION = 1200;
const RATE_LIMIT_PER_MINUTE = 10;

function money(value: number, currency: string) {
  return `${Math.round(value).toLocaleString("fa-IR")} ${currency === "IRT" ? "تومان" : currency}`;
}

function pct(value: number) {
  return `${value.toLocaleString("fa-IR")}٪`;
}

function citationsFor(
  snapshot: AssistantSnapshot,
  keys: string[],
): { label: string; reportKey?: string; detail?: string }[] {
  const result = snapshot.citations
    .filter((citation) => !keys.length || keys.includes(citation.reportKey ?? ""))
    .slice(0, 6)
    .map((citation) => ({
      label: citation.label,
      reportKey: citation.reportKey,
      detail: citation.detail,
    }));
  return result.length
    ? result
    : snapshot.citations.slice(0, 4).map((citation) => ({
        label: citation.label,
        reportKey: citation.reportKey,
        detail: citation.detail,
      }));
}

function localAnswer(
  snapshot: AssistantSnapshot,
  question: string,
): {
  content: string;
  citations: { label: string; reportKey?: string; detail?: string }[];
} {
  const q = question.replace(/\s+/g, " ").trim().toLocaleLowerCase("fa");
  const hasSales = snapshot.invoiceCount > 0;
  const company = snapshot.businessName;

  if (/موجودی|انبار|کم.?موجود|کالا/.test(q)) {
    if (snapshot.lowStock.length === 0) {
      return {
        content: `در داده‌های ثبت‌شده ${snapshot.periodLabel} برای ${company}، هیچ کالایی در سطح یا زیر حداقل موجودی تعیین‌شده نیست. ارزش کل موجودی انبار در این تاریخ ${money(snapshot.inventoryValue, snapshot.currency)} است.`,
        citations: citationsFor(snapshot, ["inventory-value", "inventory-low"]),
      };
    }
    const list = snapshot.lowStock
      .slice(0, 6)
      .map(
        (row) =>
          `• ${row.name}: ${row.quantity.toLocaleString("fa-IR")} ${row.unit} (حداقل ${row.minQuantity.toLocaleString("fa-IR")})`,
      )
      .join("\n");
    return {
      content: `بر اساس گردش واقعی انبار تا ${jalaliDateLabel(snapshot.to)}، ${snapshot.lowStockCount.toLocaleString("fa-IR")} کالا در حد یا زیر حداقل موجودی است:\n${list}\n\nارزش جاری موجودی انبار ${money(snapshot.inventoryValue, snapshot.currency)} است.`,
      citations: citationsFor(snapshot, ["inventory-value", "inventory-low"]),
    };
  }

  if (/بدهکار|مطالبات|طلب|تأمین|بدهی/.test(q)) {
    if (/تأمین|بدهی/.test(q) && !/مشتری|مطالبات|طلب/.test(q)) {
      return {
        content: `مانده بدهی به تأمین‌کنندگان در داده‌های ثبت‌شده تا ${jalaliDateLabel(snapshot.to)}، ${money(snapshot.payables, snapshot.currency)} است. گزارش «سررسید پرداخت تأمین‌کنندگان» جزئیات هر فاکتور و سررسید را نشان می‌دهد.`,
        citations: citationsFor(snapshot, ["customer-debt", "cash-flow-forecast"]),
      };
    }
    if (!snapshot.canSeeSensitive) {
      return {
        content:
          "جزئیات بدهی مشتریان برای نقش شما مجاز نیست. فقط جمع مطالبات در گزارش‌های مالی قابل مشاهده است و برای جزئیات باید مدیر کسب‌وکار دسترسی لازم را بدهد.",
        citations: citationsFor(snapshot, ["customer-debt"]),
      };
    }
    if (snapshot.topDebtors.length === 0) {
      return {
        content: `در داده‌های ثبت‌شده تا ${jalaliDateLabel(snapshot.to)} هیچ مانده مطالبه‌ای برای مشتریان وجود ندارد. جمع مطالبات ${money(snapshot.receivables, snapshot.currency)} است.`,
        citations: citationsFor(snapshot, ["customer-debt"]),
      };
    }
    const list = snapshot.topDebtors
      .map((row) => `• ${row.name}: ${money(row.amount, snapshot.currency)}`)
      .join("\n");
    return {
      content: `جمع مطالبات تا ${jalaliDateLabel(snapshot.to)}، ${money(snapshot.receivables, snapshot.currency)} است. بیشترین مانده‌های مشتریان در داده واقعی:\n${list}\n\nاین مبالغ از فاکتورهای قطعی منهای دریافت و برگشت محاسبه شده است.`,
      citations: citationsFor(snapshot, ["customer-debt"]),
    };
  }

  if (/هزینه|هزینه‌ها/.test(q)) {
    if (snapshot.topExpenses.length === 0) {
      return {
        content: `در اسناد قطعی ${snapshot.periodLabel} هیچ هزینه عملیاتی شناسایی‌شده‌ای ثبت نشده است؛ بنابراین نمی‌توان بخشی را به‌عنوان بیشترین هزینه معرفی کرد.`,
        citations: citationsFor(snapshot, ["income-statement"]),
      };
    }
    const list = snapshot.topExpenses
      .slice(0, 5)
      .map((row) => `• ${row.name}: ${money(row.amount, snapshot.currency)}`)
      .join("\n");
    return {
      content: `بیشترین هزینه‌های عملیاتی ثبت‌شده در ${snapshot.periodLabel}:\n${list}\n\nجمع هزینه عملیاتی این دوره ${money(snapshot.opex, snapshot.currency)} است. این اقلام از حساب‌های هزینه اسناد قطعی استخراج شده‌اند.`,
      citations: citationsFor(snapshot, ["income-statement", "profit-analysis"]),
    };
  }

  if (/سود|زیان|حاشیه/.test(q)) {
    const diff = snapshot.netProfit - snapshot.previousNetProfit;
    return {
      content: `سود خالص ${snapshot.periodLabel} برای ${company} برابر ${money(snapshot.netProfit, snapshot.currency)} است.\n\n• فروش: ${money(snapshot.revenue, snapshot.currency)}\n• بهای تمام‌شده: ${money(snapshot.cogs, snapshot.currency)}\n• هزینه عملیاتی: ${money(snapshot.opex, snapshot.currency)}\n• حاشیه سود خالص: ${pct(snapshot.margin)}\n\nدر ${snapshot.previousLabel} سود خالص ${money(snapshot.previousNetProfit, snapshot.currency)} بود؛ تغییر ${money(diff, snapshot.currency)} است.`,
      citations: citationsFor(snapshot, ["income-statement", "profit-analysis"]),
    };
  }

  if (/فروش|درآمد|فاکتور/.test(q)) {
    if (!hasSales) {
      return {
        content: `در فاکتورهای قطعی ${snapshot.periodLabel} هیچ فروشی ثبت نشده است. برای تحلیل فروش، ابتدا باید فاکتور در بازه ثبت و قطعی شود؛ عددی به‌صورت حدسی ارائه نمی‌شود.`,
        citations: citationsFor(snapshot, ["sales-by-customer"]),
      };
    }
    const branches = snapshot.salesByBranch.length
      ? `\n\nفروش شعب:\n${snapshot.salesByBranch
          .slice(0, 5)
          .map((row) => `• ${row.name}: ${money(row.sales, snapshot.currency)}`)
          .join("\n")}`
      : "";
    return {
      content: `فروش ثبت‌شده ${snapshot.periodLabel} برابر ${money(snapshot.revenue, snapshot.currency)} از ${snapshot.invoiceCount.toLocaleString("fa-IR")} فاکتور قطعی است. نسبت به ${snapshot.previousLabel}، تغییر ${pct(snapshot.salesChange)} بوده است.${branches}`,
      citations: citationsFor(snapshot, ["sales-by-customer", "sales-by-branch"]),
    };
  }

  if (/نقد|بانک|صندوق|نقدینگی/.test(q)) {
    return {
      content: `وضعیت نقدینگی ثبت‌شده تا ${jalaliDateLabel(snapshot.to)}:\n\n• نقد و بانک: ${money(snapshot.cash, snapshot.currency)}\n• مطالبات قابل وصول: ${money(snapshot.receivables, snapshot.currency)}\n• بدهی به تأمین‌کنندگان: ${money(snapshot.payables, snapshot.currency)}\n\nبرای پیش‌بینی زمان‌بندی‌شده، گزارش «تحلیل و پیش‌بینی نقدینگی» فقط سررسیدهای ثبت‌شده را نشان می‌دهد و مقدار قطعی وعده نمی‌دهد.`,
      citations: citationsFor(snapshot, ["cash-flow-forecast"]),
    };
  }

  if (/مالیات/.test(q)) {
    if (!snapshot.canTax) {
      return {
        content:
          "مجوز مشاهده اطلاعات مالیاتی برای نقش شما فعال نیست. برای پاسخ به این پرسش، مدیر کسب‌وکار باید دسترسی tax.view را به شما بدهد.",
        citations: citationsFor(snapshot, ["tax-summary"]),
      };
    }
    return {
      content: `جمع مالیات دوره‌های باز یا ارسال‌شده و پرداخت‌نشده در داده‌های این کسب‌وکار ${money(snapshot.taxOpen, snapshot.currency)} است. این مبلغ از رکوردهای مالیاتی بازبینی‌شده دوره‌ها جمع شده است.`,
      citations: citationsFor(snapshot, ["tax-summary"]),
    };
  }

  if (/حقوق|پرسنل|دستمزد/.test(q)) {
    if (!snapshot.canPayroll) {
      return {
        content:
          "مجوز مشاهده اطلاعات حقوق و دستمزد برای نقش شما فعال نیست. برای تحلیل این بخش، دسترسی payroll.view لازم است.",
        citations: citationsFor(snapshot, ["payroll-summary"]),
      };
    }
    return {
      content: `حقوق تأییدشده و پرداخت‌نشده ${money(snapshot.payrollOpen, snapshot.currency)} است. گزارش حقوق، جمع حقوق، بیمه، مالیات و خالص پرداختی هر دوره را از داده واقعی نشان می‌دهد.`,
      citations: citationsFor(snapshot, ["payroll-summary"]),
    };
  }

  if (/گزارش|پیشنهاد/.test(q)) {
    const suggestions = [
      snapshot.salesChange < 0 ? "«تحلیل سود و زیان» برای بررسی علت کاهش فروش" : "«فروش به تفکیک مشتری» برای شناسایی مشتریان مؤثر",
      snapshot.receivables > 0 ? "«سالخوردگی مطالبات» برای پیگیری بدهی مشتریان" : null,
      snapshot.lowStockCount > 0 ? "«کالاهای کم‌موجودی» برای برنامه‌ریزی تأمین" : null,
      snapshot.cash > 0 ? "«تحلیل و پیش‌بینی نقدینگی» برای سررسیدهای نزدیک" : null,
    ].filter(Boolean);
    return {
      content: `بر اساس داده واقعی ${snapshot.periodLabel}، این گزارش‌ها برای بررسی مناسب‌تر هستند:\n${suggestions.map((row) => `• ${row}`).join("\n")}\n\nمرکز گزارشات می‌تواند همین گزارش‌ها را با فیلترهای همان دوره و شعبه اجرا کند.`,
      citations: citationsFor(snapshot, []),
    };
  }

  const alertText = snapshot.alerts.length
    ? `\n\nنکات قابل بررسی:\n${snapshot.alerts
        .slice(0, 3)
        .map((row) => `• ${row.title}: ${row.reason}`)
        .join("\n")}`
    : "";
  return {
    content: `خلاصه داده واقعی ${company} در ${snapshot.periodLabel}:\n\n• فروش: ${money(snapshot.revenue, snapshot.currency)} (تغییر ${pct(snapshot.salesChange)})\n• سود خالص: ${money(snapshot.netProfit, snapshot.currency)}\n• حاشیه سود: ${pct(snapshot.margin)}\n• نقد و بانک: ${money(snapshot.cash, snapshot.currency)}\n• مطالبات: ${money(snapshot.receivables, snapshot.currency)}\n• بدهی: ${money(snapshot.payables, snapshot.currency)}\n• ارزش موجودی: ${money(snapshot.inventoryValue, snapshot.currency)}${alertText}\n\nبرای پاسخ دقیق‌تر می‌توانید درباره سود، هزینه، فروش، مطالبات، نقدینگی یا موجودی انبار بپرسید.`,
    citations: citationsFor(snapshot, []),
  };
}

async function membershipFor(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  userId: Id<"users">,
) {
  const membership = await ctx.db
    .query("businessMembers")
    .withIndex("by_business_user", (q) =>
      q.eq("businessId", businessId).eq("userId", userId),
    )
    .unique();
  if (!membership) throw new ConvexError("دسترسی به این کسب‌وکار مجاز نیست.");
  const business = await ctx.db.get(businessId);
  if (!business || business.archivedAt) throw new ConvexError("کسب‌وکار در دسترس نیست.");
  return { membership, business };
}

export const buildContext = internalQuery({
  args: {
    businessId: v.id("businesses"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { membership } = await membershipFor(ctx, args.businessId, args.userId);
    return await buildAssistantSnapshot(ctx, args.businessId, membership);
  },
});

export const rateLimitCheck = internalQuery({
  args: {
    businessId: v.id("businesses"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await membershipFor(ctx, args.businessId, args.userId);
    const conversations = await ctx.db
      .query("aiConversations")
      .withIndex("by_business_user_updated", (q) =>
        q.eq("businessId", args.businessId).eq("userId", args.userId),
      )
      .take(30);
    const since = Date.now() - 60_000;
    let count = 0;
    for (const conversation of conversations) {
      const messages = await ctx.db
        .query("aiMessages")
        .withIndex("by_conversation_created", (q) =>
          q.eq("conversationId", conversation._id),
        )
        .order("desc")
        .take(30);
      count += messages.filter(
        (message) =>
          message.role === "user" &&
          message.userId === args.userId &&
          message.createdAt >= since,
      ).length;
    }
    return { count, allowed: count < RATE_LIMIT_PER_MINUTE };
  },
});

export const historyForPrompt = internalQuery({
  args: {
    businessId: v.id("businesses"),
    userId: v.id("users"),
    conversationId: v.id("aiConversations"),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (
      !conversation ||
      conversation.businessId !== args.businessId ||
      conversation.userId !== args.userId
    ) {
      throw new ConvexError("گفتگو یافت نشد.");
    }
    const messages = await ctx.db
      .query("aiMessages")
      .withIndex("by_conversation_created", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(8);
    return messages
      .reverse()
      .map((message) => ({ role: message.role, content: message.content }));
  },
});

export const createConversationInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    userId: v.id("users"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await membershipFor(ctx, args.businessId, args.userId);
    const now = Date.now();
    return await ctx.db.insert("aiConversations", {
      businessId: args.businessId,
      userId: args.userId,
      title: args.title.trim().slice(0, 80) || "گفتگوی جدید",
      lastMessageAt: now,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const appendMessageInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    userId: v.id("users"),
    conversationId: v.id("aiConversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    citations: v.array(
      v.object({
        label: v.string(),
        reportKey: v.optional(v.string()),
        detail: v.optional(v.string()),
      }),
    ),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    totalTokens: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await membershipFor(ctx, args.businessId, args.userId);
    const conversation = await ctx.db.get(args.conversationId);
    if (
      !conversation ||
      conversation.businessId !== args.businessId ||
      conversation.userId !== args.userId
    ) {
      throw new ConvexError("گفتگو یافت نشد.");
    }
    const now = Date.now();
    const messageId = await ctx.db.insert("aiMessages", {
      businessId: args.businessId,
      conversationId: args.conversationId,
      userId: args.userId,
      role: args.role,
      content: args.content.slice(0, 12_000),
      citations: args.citations.slice(0, 12),
      provider: args.provider,
      model: args.model,
      totalTokens: args.totalTokens,
      error: args.error?.slice(0, 500),
      createdAt: now,
    });
    await ctx.db.patch(conversation._id, {
      messageCount: conversation.messageCount + 1,
      lastMessageAt: now,
      updatedAt: now,
      title:
        conversation.messageCount === 0 && args.role === "user"
          ? args.content.trim().slice(0, 70)
          : conversation.title,
    });
    return messageId;
  },
});

export const conversations = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    return await ctx.db
      .query("aiConversations")
      .withIndex("by_business_user_updated", (q) =>
        q.eq("businessId", args.businessId).eq("userId", user._id),
      )
      .order("desc")
      .take(50);
  },
});

export const messages = query({
  args: {
    businessId: v.id("businesses"),
    conversationId: v.id("aiConversations"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    const conversation = await ctx.db.get(args.conversationId);
    if (
      !conversation ||
      conversation.businessId !== args.businessId ||
      conversation.userId !== user._id
    ) {
      throw new ConvexError("گفتگو یافت نشد.");
    }
    return await ctx.db
      .query("aiMessages")
      .withIndex("by_conversation_created", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .take(200);
  },
});

export const newConversation = mutation({
  args: { businessId: v.id("businesses"), title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    const now = Date.now();
    return await ctx.db.insert("aiConversations", {
      businessId: args.businessId,
      userId: user._id,
      title: args.title?.trim().slice(0, 80) || "گفتگوی جدید",
      lastMessageAt: now,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const archiveConversation = mutation({
  args: {
    businessId: v.id("businesses"),
    conversationId: v.id("aiConversations"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    const conversation = await ctx.db.get(args.conversationId);
    if (
      !conversation ||
      conversation.businessId !== args.businessId ||
      conversation.userId !== user._id
    ) {
      throw new ConvexError("گفتگو یافت نشد.");
    }
    await ctx.db.patch(conversation._id, { archivedAt: Date.now(), updatedAt: Date.now() });
    return { archived: true };
  },
});

function providerConfig() {
  const apiKey = process.env.ZAI_API_KEY?.trim();
  const disabled =
    process.env.AI_DISABLED === "true" || process.env.AI_DISABLED === "1";
  return {
    apiKey,
    disabled,
    baseUrl: (process.env.ZAI_API_BASE?.trim() || "https://api.z.ai/api/paas/v4").replace(/\/+$/, ""),
    model: process.env.ZAI_MODEL?.trim() || "glm-4-flash",
  };
}

export const providerStatus = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("برای مشاهده وضعیت دستیار باید وارد شوید.");
    const config = providerConfig();
    const connected = Boolean(config.apiKey) && !config.disabled;
    return {
      connected,
      mode: connected ? "external" : "local",
      provider: connected ? "Z.ai" : "موتور تحلیل محلی",
      model: connected ? config.model : null,
      message: connected
        ? "سرویس خارجی از سمت سرور تنظیم شده است."
        : config.disabled
          ? "اتصال خارجی به‌صورت عمدی غیرفعال است؛ پاسخ‌ها از موتور تحلیل محلی داده واقعی ساخته می‌شوند."
          : "کلید سرویس خارجی تنظیم نشده است؛ فقط موتور تحلیل محلی فعال است.",
    };
  },
});

export const ask = action({
  args: {
    businessId: v.id("businesses"),
    conversationId: v.optional(v.id("aiConversations")),
    content: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    conversationId: Id<"aiConversations">;
    content: string;
    citations: { label: string; reportKey?: string; detail?: string }[];
    provider: string;
    model: string | null;
    connected: boolean;
    error: string | null;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("برای گفتگو با ویرا باید وارد شوید.");
    const content = args.content.trim();
    if (content.length < 2 || content.length > MAX_QUESTION) {
      throw new ConvexError("پرسش باید بین ۲ تا ۱۲۰۰ نویسه باشد.");
    }
    const rate = await ctx.runQuery(internal.ai.rateLimitCheck, {
      businessId: args.businessId,
      userId,
    });
    if (!rate.allowed) {
      throw new ConvexError("تعداد درخواست‌های شما در یک دقیقه بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.");
    }
    const snapshot: AssistantSnapshot = await ctx.runQuery(internal.ai.buildContext, {
      businessId: args.businessId,
      userId,
    });
    const conversationId: Id<"aiConversations"> =
      args.conversationId ??
      (await ctx.runMutation(internal.ai.createConversationInternal, {
        businessId: args.businessId,
        userId,
        title: content.slice(0, 70),
      }));
    await ctx.runMutation(internal.ai.appendMessageInternal, {
      businessId: args.businessId,
      userId,
      conversationId,
      role: "user",
      content,
      citations: [],
    });

    const config = providerConfig();
    const connected = Boolean(config.apiKey) && !config.disabled;
    let answerText = "";
    let citations: { label: string; reportKey?: string; detail?: string }[] = [];
    let provider = "local";
    let model: string | undefined;
    let totalTokens: number | undefined;
    let error: string | undefined;

    if (connected) {
      try {
        const history = await ctx.runQuery(internal.ai.historyForPrompt, {
          businessId: args.businessId,
          userId,
          conversationId,
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25_000);
        const systemPrompt = [
          "تو «ویرا AI» دستیار مالی حساب ویرا هستی. فقط بر اساس snapshot واقعی زیر پاسخ بده.",
          "هیچ عددی را حدس نزن، هیچ عملیات مالی انجام نده و اطلاعات این کسب‌وکار را با کسب‌وکار دیگر ترکیب نکن.",
          "اگر داده‌ای در snapshot نیست، صریح بگو در داده‌های ثبت‌شده موجود نیست.",
          "پاسخ فارسی، کوتاه، ساخت‌یافته و همراه با ارجاع به گزارش یا منبع داده باشد.",
          `snapshot=${JSON.stringify(snapshot)}`,
        ].join("\n");
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0.2,
            max_tokens: 700,
            messages: [
              { role: "system", content: systemPrompt },
              ...history.slice(-6),
            ],
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { total_tokens?: number };
        };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text) throw new Error("پاسخ خالی از سرویس هوش مصنوعی");
        answerText = text;
        provider = "zai";
        model = config.model;
        totalTokens = data.usage?.total_tokens;
        citations = snapshot.citations.slice(0, 6).map((citation) => ({
          label: citation.label,
          reportKey: citation.reportKey,
          detail: citation.detail,
        }));
      } catch (providerError) {
        error = providerError instanceof Error ? providerError.message : "خطای سرویس هوش مصنوعی";
        const local = localAnswer(snapshot, content);
        answerText = `${local.content}\n\nتوجه: سرویس هوش مصنوعی خارجی در این لحظه پاسخ نداد؛ این پاسخ از موتور تحلیل محلی داده واقعی ساخته شد.`;
        citations = local.citations;
        provider = "local-fallback";
        model = undefined;
      }
    } else {
      const local = localAnswer(snapshot, content);
      answerText = local.content;
      citations = local.citations;
    }

    await ctx.runMutation(internal.ai.appendMessageInternal, {
      businessId: args.businessId,
      userId,
      conversationId,
      role: "assistant",
      content: answerText,
      citations,
      provider,
      model,
      totalTokens,
      error,
    });
    return {
      conversationId,
      content: answerText,
      citations,
      provider,
      model: model ?? null,
      connected,
      error: error ?? null,
    };
  },
});
