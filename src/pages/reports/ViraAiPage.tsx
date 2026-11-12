import { PageHeader, Panel } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { REPORT_BY_KEY } from "@/convex/lib/reportCatalog";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Clipboard,
  Cloud,
  Cpu,
  Loader2,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

interface ProviderStatus {
  connected: boolean;
  mode: string;
  provider: string;
  model: string | null;
  message: string;
}

const SUGGESTIONS = [
  {
    label: "سود خالص این ماه",
    prompt: "سود خالص این ماه چقدر بوده است؟",
    icon: "profit",
  },
  {
    label: "بیشترین هزینه",
    prompt: "بیشترین هزینه مربوط به کدام بخش است؟",
    icon: "expense",
  },
  {
    label: "بدهکاران عمده",
    prompt: "کدام مشتریان بیشترین بدهی را دارند؟",
    icon: "debt",
  },
  {
    label: "روند فروش",
    prompt: "فروش این ماه نسبت به ماه قبل چه تغییری داشته؟",
    icon: "sales",
  },
  {
    label: "موجودی کم",
    prompt: "کدام کالاها موجودی کمی دارند؟",
    icon: "stock",
  },
  {
    label: "وضعیت نقدینگی",
    prompt: "وضعیت نقدینگی کسب‌وکار چگونه است؟",
    icon: "cash",
  },
];

function relativeTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(diff / 60_000));
  if (minutes < 60) return `${minutes.toLocaleString("fa-IR")} دقیقه پیش`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours.toLocaleString("fa-IR")} ساعت پیش`;
  return formatJalali(timestamp);
}

function AnswerBody({ content }: { content: string }) {
  return (
    <div className="space-y-1.5 text-[11.5px] leading-7 text-ink">
      {content.split("\n").map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-1" />;
        if (trimmed.startsWith("•") || trimmed.startsWith("-")) {
          return (
            <div key={index} className="flex gap-2">
              <span className="mt-[11px] size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
              <p>{trimmed.replace(/^[•-]\s*/, "")}</p>
            </div>
          );
        }
        if (/^\d+[.)]/.test(trimmed)) {
          return (
            <p key={index} className="font-semibold text-brand-deep">
              {trimmed}
            </p>
          );
        }
        return <p key={index}>{trimmed}</p>;
      })}
    </div>
  );
}

export default function ViraAiPage() {
  const { businessId, workspace, activeFiscalYear, role } = useWorkspace();
  const conversations = useQuery(
    api.ai.conversations,
    businessId ? { businessId } : "skip",
  );
  const providerStatus = useAction(api.ai.providerStatus);
  const ask = useAction(api.ai.ask);
  const archiveConversation = useMutation(api.ai.archiveConversation);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<Id<"aiConversations"> | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messages = useQuery(
    api.ai.messages,
    businessId && activeId
      ? { businessId, conversationId: activeId }
      : "skip",
  );
  const didAutoSelect = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    providerStatus({})
      .then((result) => setStatus(result))
      .catch((error) => setStatusError(getErrorMessage(error)));
  }, [providerStatus]);

  useEffect(() => {
    if (didAutoSelect.current || !conversations?.length) return;
    const latest = conversations.find((row) => !row.archivedAt);
    if (latest) {
      didAutoSelect.current = true;
      setActiveId(latest._id);
    }
  }, [conversations]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages?.length, sending, pendingQuestion]);

  const visibleConversations =
    conversations?.filter((row) => !row.archivedAt) ?? [];
  const activeConversation = visibleConversations.find(
    (row) => row._id === activeId,
  );

  const send = async (text = draft) => {
    const content = text.trim();
    if (!content || !businessId || sending) return;
    setDraft("");
    setAskError(null);
    setSending(true);
    setPendingQuestion(content);
    try {
      const result = await ask({
        businessId,
        conversationId: activeId ?? undefined,
        content,
      });
      setActiveId(result.conversationId);
      didAutoSelect.current = true;
      if (result.error) {
        setAskError(result.error);
      }
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (error) {
      setAskError(getErrorMessage(error));
      setDraft(content);
    } finally {
      setSending(false);
      setPendingQuestion(null);
    }
  };

  const startNewConversation = () => {
    setActiveId(null);
    didAutoSelect.current = true;
    setAskError(null);
    setDraft("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const copyAnswer = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      toast.error("مرورگر اجازه کپی به حافظه را نداد.");
    }
  };

  const archive = async (id: Id<"aiConversations">) => {
    if (!businessId) return;
    try {
      await archiveConversation({ businessId, conversationId: id });
      if (activeId === id) setActiveId(null);
      toast.success("گفتگو آرشیو شد.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const showWelcome = !activeId || (!messages?.length && !sending);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="VIRĀ AI · EVIDENCE-BASED FINANCE"
        title="ویرا AI"
        description="دستیار مالی فارسی حساب ویرا؛ پاسخ‌ها فقط از داده مجاز همین کسب‌وکار، با ارجاع به گزارش و اعلام صریح نبود اطلاعات ساخته می‌شوند."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[9.5px] font-semibold",
                status?.connected
                  ? "border-brand/25 bg-brand-soft text-brand"
                  : "border-gold/30 bg-gold-soft text-[#7a6122]",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  status?.connected ? "bg-brand" : "bg-gold",
                )}
                aria-hidden
              />
              {status
                ? status.connected
                  ? `متصل به ${status.provider}`
                  : "موتور تحلیل محلی"
                : "بررسی وضعیت سرویس…"}
            </span>
            <Button
              type="button"
              onClick={startNewConversation}
              className="rounded-xl bg-brand text-cream hover:bg-brand-deep"
            >
              <MessageSquarePlus className="size-4" aria-hidden />
              گفتگوی جدید
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <Panel className="overflow-hidden">
            <div className="relative overflow-hidden bg-brand-deep px-4 py-4 text-cream">
              <span className="absolute -left-8 -top-10 size-28 rounded-full border border-gold/20" />
              <div className="relative flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-2xl border border-gold/40 bg-brand text-gold">
                  <Bot className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-[11px] font-extrabold">ویرا · تحلیلگر حساب ویرا</p>
                  <p className="mt-0.5 text-[8.5px] text-cream/60">
                    {workspace?.business.name ?? "فضای کاری"}
                  </p>
                </div>
              </div>
              <div className="relative mt-3 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
                <p className="flex items-center gap-1.5 text-[8.5px] font-semibold text-gold">
                  {status?.connected ? (
                    <Cloud className="size-3" aria-hidden />
                  ) : (
                    <Cpu className="size-3" aria-hidden />
                  )}
                  {status?.provider ?? "در حال بررسی…"}
                </p>
                <p className="mt-1 text-[8px] leading-5 text-cream/60">
                  {status?.message ??
                    "وضعیت اتصال از سمت سرور کنترل می‌شود؛ کلید سرویس هرگز به مرورگر ارسال نمی‌شود."}
                </p>
              </div>
            </div>
            <div className="p-2">
              <p className="px-2 pb-1 pt-1.5 text-[8px] font-semibold tracking-wide text-ink-soft">
                تاریخچه گفتگوها
              </p>
              {!visibleConversations.length ? (
                <p className="px-2 py-3 text-[9px] leading-5 text-ink-soft">
                  هنوز گفتگویی ثبت نشده است. اولین پرسش را بپرسید تا تاریخچه
                  همین‌جا ساخته شود.
                </p>
              ) : (
                <div className="max-h-[320px] space-y-1 overflow-y-auto xl:max-h-[430px]">
                  {visibleConversations.map((row) => (
                    <div
                      key={row._id}
                      className={cn(
                        "group flex items-center gap-1 rounded-xl px-1.5 py-1 transition",
                        activeId === row._id
                          ? "bg-brand-soft"
                          : "hover:bg-background/70",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveId(row._id);
                          setAskError(null);
                          didAutoSelect.current = true;
                        }}
                        className="min-w-0 flex-1 rounded-lg px-1.5 py-1.5 text-right"
                      >
                        <p
                          className={cn(
                            "line-clamp-1 text-[9.5px] font-semibold",
                            activeId === row._id ? "text-brand-deep" : "text-ink",
                          )}
                        >
                          {row.title}
                        </p>
                        <p className="mt-0.5 text-[7.5px] text-ink-soft">
                          {relativeTime(row.lastMessageAt)} ·{" "}
                          {row.messageCount.toLocaleString("fa-IR")} پیام
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void archive(row._id)}
                        className="rounded-md p-1 text-ink-soft opacity-0 transition hover:bg-destructive/5 hover:text-destructive group-hover:opacity-100"
                        title="آرشیو گفتگو"
                      >
                        <Archive className="size-3" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          <Panel className="p-4">
            <p className="flex items-center gap-1.5 text-[9.5px] font-extrabold text-ink">
              <ShieldCheck className="size-3.5 text-brand" aria-hidden />
              مرزهای اعتماد ویرا
            </p>
            <ul className="mt-2 space-y-1.5 text-[8.5px] leading-5 text-ink-soft">
              <li>فقط داده‌های مجاز نقش شما خوانده می‌شود.</li>
              <li>هیچ رکورد بین کسب‌وکارها ترکیب نمی‌شود.</li>
              <li>سند مالی بدون تأیید شما ثبت یا تغییر نمی‌کند.</li>
              <li>در نبود داده، پاسخ صریح «اطلاعات کافی نیست» است.</li>
            </ul>
            <p className="mt-3 rounded-lg bg-background/70 px-2.5 py-2 text-[8px] leading-5 text-ink-soft">
              نقش شما: <strong className="font-semibold text-ink">{role ?? "—"}</strong>
              {activeFiscalYear ? ` · دوره ${activeFiscalYear.name}` : ""}
            </p>
          </Panel>
        </aside>

        <Panel className="flex min-h-[600px] flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-hairline/70 bg-white/70 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Sparkles className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[10.5px] font-bold text-ink">
                  {activeConversation?.title ?? "گفتگوی تازه با ویرا"}
                </p>
                <p className="text-[8px] text-ink-soft">
                  پاسخ‌ها بر پایه دفاتر تا لحظه اجرا؛ زمان پاسخ ممکن است چند ثانیه
                  طول بکشد.
                </p>
              </div>
            </div>
            <Link
              to="/dashboard/reports"
              className="hidden shrink-0 items-center gap-1 rounded-lg border border-hairline px-2.5 py-1.5 text-[9px] font-semibold text-ink-soft transition hover:border-brand/30 hover:text-brand sm:inline-flex"
            >
              مرکز گزارشات
              <ArrowLeft className="size-3" aria-hidden />
            </Link>
          </div>

          <div className="relative flex-1 overflow-y-auto bg-[#fbfaf5] px-3 py-5 sm:px-5">
            <div className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(#d9d5c6_0.7px,transparent_0.7px)] [background-size:18px_18px]" />
            <div className="relative mx-auto max-w-3xl space-y-4">
              {showWelcome ? (
                <div className="mx-auto max-w-2xl py-4 text-center">
                  <span className="relative mx-auto flex size-16 items-center justify-center rounded-[22px] border border-gold/30 bg-brand-deep text-2xl font-black text-gold shadow-[0_24px_50px_-30px_rgba(22,58,46,0.8)]">
                    و
                    <span className="absolute -left-2 top-1 flex size-5 items-center justify-center rounded-full border-2 border-[#fbfaf5] bg-gold text-brand-deep">
                      <Sparkles className="size-2.5" aria-hidden />
                    </span>
                  </span>
                  <h2 className="mt-4 text-[19px] font-black text-ink">
                    امروز چه چیزی را با هم بررسی کنیم؟
                  </h2>
                  <p className="mx-auto mt-2 max-w-lg text-[10px] leading-6 text-ink-soft">
                    می‌توانید درباره سود، هزینه، فروش، مطالبات، نقدینگی یا موجودی
                    بپرسید. اگر داده کافی نباشد، ویرا به‌جای حدس، صریحاً اعلام
                    می‌کند.
                  </p>
                  <div className="mt-5 grid gap-2 text-right sm:grid-cols-2">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion.prompt}
                        type="button"
                        onClick={() => {
                          setDraft(suggestion.prompt);
                          inputRef.current?.focus();
                        }}
                        className="group flex items-center gap-2.5 rounded-xl border border-hairline/80 bg-white/80 px-3 py-2.5 transition hover:border-brand/30 hover:bg-brand-soft/40"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gold-soft text-[#8a6c2c]">
                          <Wand2 className="size-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[9.5px] font-bold text-ink">
                            {suggestion.label}
                          </span>
                          <span className="mt-0.5 line-clamp-1 block text-[8px] text-ink-soft">
                            {suggestion.prompt}
                          </span>
                        </span>
                        <ChevronRight className="size-3 text-ink-soft/50 transition group-hover:-translate-x-0.5 group-hover:text-brand" aria-hidden />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {messages?.map((message) => {
                const isUser = message.role === "user";
                return (
                  <div
                    key={message._id}
                    className={cn(
                      "flex gap-2.5",
                      isUser ? "flex-row-reverse" : "flex-row",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-xl text-[10px] font-black",
                        isUser
                          ? "bg-cream text-brand-deep"
                          : "border border-gold/30 bg-brand-deep text-gold",
                      )}
                    >
                      {isUser ? "شما" : "و"}
                    </span>
                    <div
                      className={cn(
                        "min-w-0 max-w-[88%] rounded-2xl px-3.5 py-3 shadow-sm sm:max-w-[82%]",
                        isUser
                          ? "rounded-tr-md bg-brand text-cream"
                          : "rounded-tl-md border border-hairline/70 bg-white text-ink",
                      )}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-line text-[11px] leading-6">
                          {message.content}
                        </p>
                      ) : (
                        <>
                          <AnswerBody content={message.content} />
                          {message.citations.length ? (
                            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-hairline/60 pt-2">
                              <span className="inline-flex items-center gap-1 rounded-md bg-mist px-1.5 py-0.5 text-[7.5px] font-semibold text-[#2d6470]">
                                <Check className="size-2.5" aria-hidden />
                                شواهد
                              </span>
                              {message.citations.map((citation, index) => {
                                const report = citation.reportKey
                                  ? REPORT_BY_KEY.get(citation.reportKey)
                                  : null;
                                return (
                                  <span
                                    key={`${citation.label}-${index}`}
                                    className="inline-flex items-center gap-1 rounded-md border border-[#d9eaf2] bg-white px-1.5 py-0.5 text-[7.5px] text-[#355764]"
                                    title={citation.detail}
                                  >
                                    {citation.label}
                                    {report ? (
                                      <Link
                                        to={`/dashboard/reports/${report.key}`}
                                        className="font-semibold text-[#2d6470] underline decoration-dotted"
                                      >
                                        گزارش
                                      </Link>
                                    ) : null}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="mt-2 border-t border-hairline/60 pt-1.5 text-[7.5px] text-ink-soft">
                              این پاسخ به داده ثبت‌شده کسب‌وکار ارجاع داده شده
                              است؛ در نبود داده، ویرا عددی نمی‌سازد.
                            </p>
                          )}
                          {message.error ? (
                            <p className="mt-2 rounded-lg bg-destructive/5 px-2 py-1 text-[8px] text-destructive">
                              {message.error}
                            </p>
                          ) : null}
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-[7.5px] text-ink-soft">
                              {message.provider === "external" || message.provider === "zai"
                                ? "پاسخ با سرویس خارجی"
                                : "موتور تحلیل محلی"}{" "}
                              · {formatJalali(message.createdAt)}
                            </span>
                            <button
                              type="button"
                              onClick={() => void copyAnswer(message._id, message.content)}
                              className="inline-flex items-center gap-1 rounded p-1 text-[7.5px] text-ink-soft hover:bg-background hover:text-brand"
                            >
                              {copiedId === message._id ? (
                                <Check className="size-3" aria-hidden />
                              ) : (
                                <Clipboard className="size-3" aria-hidden />
                              )}
                              {copiedId === message._id ? "کپی شد" : "کپی"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {sending ? (
                <div className="flex flex-row gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-xl border border-gold/30 bg-brand-deep text-[10px] font-black text-gold">
                    و
                  </span>
                  <div className="rounded-2xl rounded-tl-md border border-hairline/70 bg-white px-3.5 py-3">
                    {pendingQuestion ? (
                      <p className="mb-2 border-b border-hairline/60 pb-2 text-[9px] text-ink-soft">
                        در حال بررسی: {pendingQuestion}
                      </p>
                    ) : null}
                    <div className="flex items-center gap-2 text-[9px] text-ink-soft">
                      <Loader2 className="size-3.5 animate-spin text-gold" aria-hidden />
                      خواندن داده مجاز، محاسبه و آماده‌سازی شواهد…
                    </div>
                  </div>
                </div>
              ) : null}

              {askError ? (
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-[9px] leading-5 text-destructive">
                  {askError}
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
          </div>

          <div className="border-t border-hairline/70 bg-surface px-3 py-3 sm:px-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
              className="mx-auto max-w-3xl"
            >
              <div className="flex items-end gap-2 rounded-2xl border border-hairline bg-background/40 p-1.5 transition focus-within:border-brand/35 focus-within:bg-white">
                <Input
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={1200}
                  disabled={!businessId || sending}
                  placeholder="مثلاً: سود خالص این ماه چقدر بوده است؟"
                  className="h-10 flex-1 border-0 bg-transparent text-[11px] shadow-none focus-visible:ring-0"
                />
                <Button
                  type="submit"
                  disabled={!businessId || sending || draft.trim().length < 2}
                  className="size-9 shrink-0 rounded-xl bg-brand p-0 text-cream hover:bg-brand-deep"
                  aria-label="ارسال پرسش"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-4 -scale-x-100" aria-hidden />
                  )}
                </Button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 text-[7.5px] text-ink-soft">
                <span>
                  ویرا هیچ سند مالی را بدون تأیید صریح شما ثبت یا تغییر نمی‌دهد.
                </span>
                <span>{draft.length.toLocaleString("fa-IR")} / ۱۲۰۰</span>
              </div>
              {statusError ? (
                <p className="mt-1 text-[8px] text-destructive">{statusError}</p>
              ) : null}
              {!businessId ? (
                <p className="mt-1 text-[8px] text-destructive">
                  برای گفتگو ابتدا کسب‌وکار فعال را انتخاب کنید.
                </p>
              ) : null}
            </form>
          </div>
        </Panel>
      </div>

      {!status && !statusError ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : null}
    </div>
  );
}
