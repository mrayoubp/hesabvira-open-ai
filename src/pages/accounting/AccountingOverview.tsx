import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/app/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  DOCUMENT_KIND_LABELS,
  documentStatusMeta,
} from "@/lib/accounting";
import { getErrorMessage } from "@/lib/errors";
import {
  currencyUnit,
  formatJalali,
  formatMoney,
  formatNumber,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CalendarCheck2,
  CalendarRange,
  CheckCircle2,
  CircleDollarSign,
  FileClock,
  FilePlus2,
  FileText,
  ListTree,
  Loader2,
  LockKeyhole,
  Scale,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

function Kpi({
  label,
  value,
  hint,
  icon,
  tone = "brand",
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: "brand" | "gold" | "danger" | "mist";
}) {
  const tones = {
    brand: "bg-brand-soft text-brand",
    gold: "bg-gold-soft text-[#7a6122] dark:text-gold",
    danger: "bg-destructive/10 text-destructive",
    mist: "bg-mist/60 text-[#245c5c] dark:bg-mist/20 dark:text-[#a9d5e2]",
  };
  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold text-ink-soft">{label}</span>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-xl",
            tones[tone],
          )}
        >
          {icon}
        </span>
      </div>
      <p className="num mt-3 truncate text-[21px] font-bold text-ink">{value}</p>
      <p className="mt-1 truncate text-[8px] text-ink-soft">{hint}</p>
    </Panel>
  );
}

function NumberingDialog({
  open,
  onOpenChange,
  businessId,
  fiscalYearId,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId: Id<"businesses">;
  fiscalYearId: Id<"fiscalYears">;
  current: { prefix: string; padding: number };
}) {
  const updateSettings = useMutation(api.accountingDocuments.updateSettings);
  const [prefix, setPrefix] = useState(current.prefix);
  const [padding, setPadding] = useState(String(current.padding));
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsedPadding = Number(padding);
    if (!Number.isInteger(parsedPadding) || parsedPadding < 3 || parsedPadding > 10) {
      toast.error("تعداد ارقام باید عددی بین ۳ تا ۱۰ باشد.");
      return;
    }
    setSaving(true);
    try {
      await updateSettings({
        businessId,
        fiscalYearId,
        prefix,
        padding: parsedPadding,
      });
      toast.success("الگوی شماره‌گذاری ذخیره شد.");
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] border-white/70 bg-card/95 text-start backdrop-blur-xl dark:border-white/10 sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="text-base">الگوی شماره‌گذاری اسناد</DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            شماره هر سند یک‌بار در Backend و به‌صورت اتمیک تولید می‌شود. تغییر
            الگو روی شماره‌های قبلی اثر ندارد.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="doc-prefix" className="text-xs">
              پیشوند
            </Label>
            <Input
              id="doc-prefix"
              value={prefix}
              onChange={(event) => setPrefix(event.target.value.toUpperCase())}
              maxLength={12}
              dir="ltr"
              className="rounded-xl border-hairline bg-background font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-padding" className="text-xs">
              تعداد ارقام شماره
            </Label>
            <Input
              id="doc-padding"
              value={padding}
              onChange={(event) => setPadding(event.target.value)}
              inputMode="numeric"
              dir="ltr"
              className="rounded-xl border-hairline bg-background font-mono text-xs"
            />
          </div>
          <p className="rounded-xl bg-background/70 px-3 py-2 font-mono text-[10px] text-ink-soft" dir="ltr">
            {prefix || "JV"}-[سال]-{
              String(1).padStart(
                Math.min(10, Math.max(3, Number(padding) || 4)),
                "0",
              )
            }
          </p>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit" disabled={saving} className="gap-1.5 rounded-xl">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              ذخیره الگو
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-xl"
            >
              انصراف
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AccountingOverview() {
  const {
    businessId,
    fiscalYearId,
    currency,
    canWrite,
    canManage,
    activeFiscalYear,
  } = useWorkspace();
  const unit = currencyUnit(currency);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState(false);

  const accounts = useQuery(
    api.accounts.list,
    businessId ? { businessId } : "skip",
  );
  const documents = useQuery(
    api.accountingDocuments.list,
    businessId && fiscalYearId
      ? { businessId, fiscalYearId, page: 1, pageSize: 6 }
      : "skip",
  );
  const preview = useQuery(
    api.fiscalClosing.preview,
    businessId && fiscalYearId ? { businessId, fiscalYearId } : "skip",
  );
  const settings = useQuery(
    api.accountingDocuments.settings,
    businessId && fiscalYearId ? { businessId, fiscalYearId } : "skip",
  );
  const closeFiscalYear = useMutation(api.fiscalClosing.close);
  const createOpening = useMutation(api.fiscalClosing.createOpening);
  const ensureDefaults = useMutation(api.accounts.ensureDefaults);

  if (!businessId || !fiscalYearId) {
    return (
      <EmptyState
        icon={<CalendarRange className="size-5" />}
        title="دوره مالی فعالی وجود ندارد"
        description="برای ثبت اسناد دوبل، ابتدا دوره مالی و شعبه فضای کاری باید ساخته شود."
      />
    );
  }

  const handleClose = async () => {
    setClosing(true);
    try {
      const result = await closeFiscalYear({ businessId, fiscalYearId });
      toast.success(
        result.closingNumber
          ? `دوره بسته شد و سند اختتامیه ${result.closingNumber} ثبت شد.`
          : "دوره مالی بدون گردش سود و زیان بسته شد.",
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setClosing(false);
    }
  };

  const handleOpening = async () => {
    setOpening(true);
    try {
      const result = await createOpening({ businessId, fiscalYearId });
      toast.success(`سند افتتاحیه ${result.number} ثبت شد.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setOpening(false);
    }
  };

  const counts = preview?.counts;
  const balanced = preview
    ? preview.finalized.difference === 0
    : null;
  const isEmpty = documents?.total === 0 && accounts?.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="حسابداری دوبل · دفتر کل"
        title="نمای کلی حسابداری"
        description="کدینگ چندسطحی، اسناد متوازن، دفتر روزنامه و گزارش‌های واقعی. فقط اسناد قطعی وارد دفتر کل و تراز می‌شوند."
        actions={
          <>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 px-3.5"
            >
              <Link to="/dashboard/accounting/accounts">
                <ListTree className="size-4" />
                کدینگ حساب‌ها
              </Link>
            </Button>
            {canWrite ? (
              <Button
                asChild
                size="sm"
                className="h-9 gap-1.5 rounded-xl px-3.5"
              >
                <Link to="/dashboard/accounting/documents/new">
                  <FilePlus2 className="size-4" />
                  سند جدید
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {accounts && accounts.length === 0 ? (
        <Panel className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 text-gold" />
              <div>
                <p className="text-[11px] font-bold text-ink">
                  کدینگ حساب‌ها هنوز ساخته نشده
                </p>
                <p className="mt-1 text-[9px] leading-5 text-ink-soft">
                  کدینگ استاندارد شامل دارایی، بدهی، سرمایه، درآمد و هزینه را
                  یک‌بار ایجاد کنید؛ داده مالی ساختگی اضافه نمی‌شود.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              disabled={!canWrite}
              onClick={() =>
                ensureDefaults({ businessId }).then(
                  () => toast.success("کدینگ استاندارد ایجاد شد."),
                  (error) => toast.error(getErrorMessage(error)),
                )
              }
              className="rounded-xl"
            >
              ایجاد کدینگ استاندارد
            </Button>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="کل اسناد دوره"
          value={formatNumber(counts?.total ?? 0)}
          hint={activeFiscalYear?.name ?? "دوره جاری"}
          icon={<FileText className="size-4" />}
        />
        <Kpi
          label="اسناد قطعی"
          value={formatNumber(counts?.posted ?? 0)}
          hint="ثبت‌شده در دفتر کل"
          icon={<BookOpen className="size-4" />}
          tone="mist"
        />
        <Kpi
          label="در انتظار بررسی"
          value={formatNumber((counts?.draft ?? 0) + (counts?.pending ?? 0))}
          hint={`${formatNumber(counts?.draft ?? 0)} پیش‌نویس · ${formatNumber(
            counts?.pending ?? 0,
          )} در انتظار تأیید`}
          icon={<FileClock className="size-4" />}
          tone={(counts?.draft ?? 0) + (counts?.pending ?? 0) > 0 ? "gold" : "brand"}
        />
        <Kpi
          label="توازن دفتر"
          value={
            balanced === null
              ? "بدون گردش"
              : balanced
                ? "متوازن"
                : "اختلاف"
          }
          hint={`${formatNumber(preview?.finalized.debit ?? 0)} بدهکار / ${formatNumber(
            preview?.finalized.credit ?? 0,
          )} بستانکار`}
          icon={
            balanced === false ? (
              <AlertTriangle className="size-4" />
            ) : (
              <ShieldCheck className="size-4" />
            )
          }
          tone={balanced === false ? "danger" : "brand"}
        />
      </div>

      {!documents || !preview ? (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-72 rounded-[26px]" />
          <Skeleton className="h-72 rounded-[26px]" />
        </div>
      ) : isEmpty ? (
        <Panel>
          <EmptyState
            icon={<Scale className="size-5" />}
            title="دفتر حسابداری هنوز سندی ندارد"
            description="اولین سند متوازن را ثبت کنید یا از سند افتتاحیه برای انتقال مانده‌های دوره قبل استفاده کنید."
            action={
              canWrite ? (
                <Button asChild size="sm" className="rounded-xl">
                  <Link to="/dashboard/accounting/documents/new">
                    <FilePlus2 className="size-4" />
                    ثبت اولین سند
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          <Panel className="overflow-hidden">
            <PanelHeader
              title="آخرین اسناد حسابداری"
              description="شماره، شرح، تاریخ و مبلغ واقعی ثبت‌شده در همین دوره."
              action={
                <Link
                  to="/dashboard/accounting/documents"
                  className="flex items-center gap-1 text-[9px] font-semibold text-brand hover:underline"
                >
                  همه اسناد
                  <ArrowLeft className="size-3" />
                </Link>
              }
            />
            {documents.items.length === 0 ? (
              <EmptyState
                icon={<FileText className="size-5" />}
                title="سندی در این دوره نیست"
                description="سند جدید بسازید یا دوره مالی دیگری را از هدر انتخاب کنید."
                className="py-8"
              />
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="ps-4 text-[9px] text-ink-soft">
                          شماره
                        </TableHead>
                        <TableHead className="text-[9px] text-ink-soft">
                          شرح
                        </TableHead>
                        <TableHead className="text-[9px] text-ink-soft">
                          تاریخ
                        </TableHead>
                        <TableHead className="text-[9px] text-ink-soft">
                          مبلغ ({unit})
                        </TableHead>
                        <TableHead className="text-[9px] text-ink-soft">
                          وضعیت
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.items.map((document) => {
                        const meta = documentStatusMeta(document.status);
                        return (
                          <TableRow key={document._id}>
                            <TableCell className="ps-4">
                              <Link
                                to={`/dashboard/accounting/documents/${document._id}`}
                                className="num font-mono text-[10px] font-semibold text-brand hover:underline"
                              >
                                {document.number}
                              </Link>
                            </TableCell>
                            <TableCell className="max-w-52">
                              <p className="truncate text-[10px] text-ink">
                                {document.description}
                              </p>
                              <p className="mt-0.5 text-[8px] text-ink-soft">
                                {DOCUMENT_KIND_LABELS[document.kind]}
                              </p>
                            </TableCell>
                            <TableCell className="num text-[9px] text-ink-soft">
                              {formatJalali(document.documentDate)}
                            </TableCell>
                            <TableCell className="num text-[10px] font-semibold text-ink">
                              {formatNumber(document.totalDebit)}
                            </TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-semibold",
                                  meta.badge,
                                )}
                              >
                                <span className={cn("size-1.5 rounded-full", meta.dot)} />
                                {meta.label}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <ul className="divide-y divide-hairline/40 md:hidden">
                  {documents.items.map((document) => {
                    const meta = documentStatusMeta(document.status);
                    return (
                      <li key={document._id} className="p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            to={`/dashboard/accounting/documents/${document._id}`}
                            className="num font-mono text-[11px] font-semibold text-brand"
                          >
                            {document.number}
                          </Link>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[8px]",
                              meta.badge,
                            )}
                          >
                            {meta.label}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] text-ink">
                          {document.description}
                        </p>
                        <div className="mt-1 flex justify-between text-[8px] text-ink-soft">
                          <span className="num">{formatJalali(document.documentDate)}</span>
                          <span className="num">
                            {formatMoney(document.totalDebit, currency)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/50 px-4 py-2.5">
              <div className="flex flex-wrap gap-2 text-[8px] text-ink-soft">
                <span className="rounded-lg bg-background/70 px-2 py-1">
                  بدهکار:{" "}
                  <b className="num text-ink">
                    {formatNumber(preview.finalized.debit)}
                  </b>
                </span>
                <span className="rounded-lg bg-background/70 px-2 py-1">
                  بستانکار:{" "}
                  <b className="num text-ink">
                    {formatNumber(preview.finalized.credit)}
                  </b>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button asChild variant="outline" size="sm" className="h-7 rounded-lg text-[9px]">
                  <Link to="/dashboard/accounting/journal">دفتر روزنامه</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-7 rounded-lg text-[9px]">
                  <Link to="/dashboard/accounting/ledger">دفتر کل</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-7 rounded-lg text-[9px]">
                  <Link to="/dashboard/accounting/trial-balance">تراز آزمایشی</Link>
                </Button>
              </div>
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel className="overflow-hidden">
              <PanelHeader
                title="کنترل و بستن دوره"
                description="بستن فقط وقتی مجاز است که سند باز یا ناسازگار وجود نداشته باشد."
                action={
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[8px] font-semibold",
                      preview.fiscalYear.status === "closed"
                        ? "bg-muted text-ink-soft"
                        : "bg-brand-soft text-brand",
                    )}
                  >
                    {preview.fiscalYear.status === "closed" ? (
                      <LockKeyhole className="size-3" />
                    ) : (
                      <CalendarCheck2 className="size-3" />
                    )}
                    {preview.fiscalYear.status === "closed" ? "بسته‌شده" : "باز"}
                  </span>
                }
              />
              <div className="space-y-2 px-4 pb-3">
                {[
                  {
                    label: "سند پیش‌نویس",
                    value: preview.counts.draft,
                    ok: preview.counts.draft === 0,
                  },
                  {
                    label: "در انتظار تأیید",
                    value: preview.counts.pending,
                    ok: preview.counts.pending === 0,
                  },
                  {
                    label: "سند قطعی ناسازگار",
                    value: preview.finalized.unbalancedDocuments,
                    ok: preview.finalized.unbalancedDocuments === 0,
                  },
                  {
                    label: "اختلاف بدهکار/بستانکار",
                    value: preview.finalized.difference,
                    ok: preview.finalized.difference === 0,
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between rounded-xl border border-hairline/50 bg-background/60 px-3 py-2"
                  >
                    <span className="text-[9px] text-ink-soft">{row.label}</span>
                    <span
                      className={cn(
                        "num flex items-center gap-1 text-[10px] font-semibold",
                        row.ok ? "text-brand" : "text-destructive",
                      )}
                    >
                      {row.ok ? (
                        <CheckCircle2 className="size-3" />
                      ) : (
                        <AlertTriangle className="size-3" />
                      )}
                      {formatNumber(row.value)}
                    </span>
                  </div>
                ))}
                {preview.reasons.length > 0 ? (
                  <ul className="space-y-1 rounded-xl border border-gold/25 bg-gold-soft/30 px-3 py-2 dark:bg-gold-soft/5">
                    {preview.reasons.map((reason) => (
                      <li
                        key={reason}
                        className="flex items-start gap-1.5 text-[8px] leading-4 text-[#7a6122] dark:text-gold"
                      >
                        <AlertTriangle className="mt-0.5 size-2.5 shrink-0" />
                        {reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {preview.closingDocument ? (
                  <Link
                    to={`/dashboard/accounting/documents/${preview.closingDocument._id}`}
                    className="flex items-center justify-between rounded-xl border border-brand/20 bg-brand-soft/40 px-3 py-2 text-[9px] font-semibold text-brand hover:bg-brand-soft/60 dark:bg-brand-soft/10"
                  >
                    <span>سند اختتامیه {preview.closingDocument.number}</span>
                    <ArrowLeft className="size-3" />
                  </Link>
                ) : null}
                {preview.openingDocument ? (
                  <Link
                    to={`/dashboard/accounting/documents/${preview.openingDocument._id}`}
                    className="flex items-center justify-between rounded-xl border border-hairline/60 bg-background/60 px-3 py-2 text-[9px] font-semibold text-ink hover:border-brand/30"
                  >
                    <span>سند افتتاحیه {preview.openingDocument.number}</span>
                    <ArrowLeft className="size-3" />
                  </Link>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5 border-t border-hairline/50 px-4 py-3">
                {preview.fiscalYear.status === "open" ? (
                  <>
                    {!preview.openingDocument ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canWrite || opening}
                        onClick={handleOpening}
                        className="w-full gap-1.5 rounded-xl text-[10px]"
                      >
                        {opening ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <CalendarCheck2 className="size-3.5" />
                        )}
                        ثبت سند افتتاحیه از دوره قبل
                      </Button>
                    ) : null}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!canManage || !preview.canClose || closing}
                          className="w-full gap-1.5 rounded-xl text-[10px]"
                        >
                          {closing ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <LockKeyhole className="size-3.5" />
                          )}
                          بستن قطعی دوره مالی
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rounded-[24px] text-start">
                        <AlertDialogHeader className="text-start">
                          <AlertDialogTitle className="text-base">
                            بستن {preview.fiscalYear.name}؟
                          </AlertDialogTitle>
                          <AlertDialogDescription className="text-[11px] leading-6">
                            سند اختتامیه به‌صورت خودکار ثبت می‌شود و پس از بستن،
                            ثبت یا ویرایش سند در این دوره مجاز نیست. این عملیات
                            قابل بازگشت خودکار نیست.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="gap-2 sm:justify-start">
                          <AlertDialogAction
                            onClick={handleClose}
                            className="rounded-xl bg-destructive text-white hover:bg-destructive/90"
                          >
                            بستن دوره
                          </AlertDialogAction>
                          <AlertDialogCancel className="rounded-xl">
                            انصراف
                          </AlertDialogCancel>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    {!canManage ? (
                      <p className="text-center text-[8px] text-ink-soft">
                        بستن دوره فقط برای مالک یا مدیر کسب‌وکار مجاز است.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-center text-[8px] text-ink-soft">
                    این دوره بسته شده و اسناد آن فقط قابل مشاهده و چاپ‌اند.
                  </p>
                )}
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <PanelHeader
                title="ابزارهای دفتر"
                description="گزارش‌های تحلیلی از اسناد قطعی همین دوره."
              />
              <div className="grid gap-1.5 px-4 pb-4 text-[10px]">
                {[
                  {
                    to: "/dashboard/accounting/journal",
                    label: "دفتر روزنامه",
                    description: "ریز آرتیکل‌ها با فیلتر تاریخ و حساب",
                    icon: BookOpen,
                  },
                  {
                    to: "/dashboard/accounting/ledger",
                    label: "دفتر کل",
                    description: "مانده اول، گردش و مانده پایان حساب",
                    icon: Scale,
                  },
                  {
                    to: "/dashboard/accounting/subsidiary",
                    label: "دفتر معین",
                    description: "گردش معین و تفصیلی‌های زیرمجموعه",
                    icon: ListTree,
                  },
                  {
                    to: "/dashboard/accounting/trial-balance",
                    label: "تراز آزمایشی",
                    description: "کل، معین و تفصیلی با کنترل اختلاف",
                    icon: CircleDollarSign,
                  },
                ].map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="group flex items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 transition-colors hover:border-hairline/60 hover:bg-background/70"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-cream/60 text-ink-soft dark:bg-white/[0.05]">
                      <item.icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-semibold text-ink">
                        {item.label}
                      </span>
                      <span className="block truncate text-[8px] text-ink-soft">
                        {item.description}
                      </span>
                    </span>
                    <ArrowLeft className="size-3 text-ink-soft transition-transform group-hover:-translate-x-0.5" />
                  </Link>
                ))}
              </div>
            </Panel>

            {settings && canManage ? (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="flex w-full items-center justify-between rounded-[20px] border border-dashed border-hairline/80 bg-card/60 px-4 py-3 text-start transition-colors hover:border-brand/30 hover:bg-card"
              >
                <span className="flex items-center gap-2">
                  <Settings2 className="size-4 text-ink-soft" />
                  <span>
                    <span className="block text-[10px] font-semibold text-ink">
                      الگوی شماره‌گذاری
                    </span>
                    <span className="num mt-0.5 block font-mono text-[8px] text-ink-soft" dir="ltr">
                      {settings.prefix}-{settings.year}-{"0".repeat(settings.padding)}
                    </span>
                  </span>
                </span>
                <ArrowLeft className="size-3.5 text-ink-soft" />
              </button>
            ) : null}
          </div>
        </div>
      )}

      {settings && canManage ? (
        <NumberingDialog
          key={`${settings.prefix}-${settings.padding}`}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          businessId={businessId}
          fiscalYearId={fiscalYearId}
          current={settings}
        />
      ) : null}
    </div>
  );
}
