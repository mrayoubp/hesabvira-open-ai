import { AccountPicker } from "@/components/accounting/AccountPicker";
import { DocumentSheet } from "@/components/accounting/DocumentSheet";
import {
  PageHeader,
  Panel,
  PanelHeader,
  WorkspaceLoader,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  DOCUMENT_KIND_LABELS,
  documentStatusMeta,
  isoDateValue,
  printAccountingView,
  timestampFromDateInput,
} from "@/lib/accounting";
import { getErrorMessage } from "@/lib/errors";
import {
  currencyUnit,
  formatJalali,
  formatJalaliLong,
  formatNumber,
} from "@/lib/format";
import { parseAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  BookOpen,
  CheckCircle2,
  Eye,
  FilePenLine,
  History,
  Info,
  Loader2,
  LockKeyhole,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

type DocumentDetail = FunctionReturnType<typeof api.accountingDocuments.get>;
type AccountRow = FunctionReturnType<typeof api.accounts.list>[number];

interface EditorLine {
  key: string;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
}

function newKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyLine(): EditorLine {
  return {
    key: newKey(),
    accountId: "",
    description: "",
    debit: "",
    credit: "",
  };
}

function clampDate(timestamp: number, startAt: number, endAt: number) {
  return Math.min(Math.max(timestamp, startAt), endAt);
}

function DocumentEditorForm({
  initial,
}: {
  initial: DocumentDetail | null;
}) {
  const {
    businessId,
    workspace,
    branches,
    fiscalYears,
    branchId: workspaceBranchId,
    fiscalYearId: workspaceFiscalYearId,
    currency,
    canWrite,
    user,
  } = useWorkspace();
  const navigate = useNavigate();
  const unit = currencyUnit(currency);

  const accounts = useQuery(
    api.accounts.list,
    businessId ? { businessId, includeInactive: true } : "skip",
  );
  const create = useMutation(api.accountingDocuments.create);
  const updateDraft = useMutation(api.accountingDocuments.updateDraft);
  const submitDocument = useMutation(api.accountingDocuments.submit);
  const returnToDraft = useMutation(api.accountingDocuments.returnToDraft);
  const removeDraft = useMutation(api.accountingDocuments.removeDraft);
  const postDocument = useMutation(api.accountingDocuments.post);
  const reverseDocument = useMutation(api.accountingDocuments.reverse);
  const createCorrection = useMutation(
    api.accountingDocuments.createCorrection,
  );

  const initialFiscalYearId =
    initial?.fiscalYear?._id ?? workspaceFiscalYearId ?? "";
  const [now] = useState(() => Date.now());
  const initialFiscalYear = fiscalYears.find(
    (year) => year._id === initialFiscalYearId,
  );
  const fiscalStart =
    initialFiscalYear?.startAt ?? initial?.fiscalYear?.startAt ?? now;
  const fiscalEnd =
    initialFiscalYear?.endAt ?? initial?.fiscalYear?.endAt ?? now;
  const initialDate = initial?.documentDate
    ? initial.documentDate
    : clampDate(now, fiscalStart, fiscalEnd);

  const [fiscalYearId, setFiscalYearId] = useState(initialFiscalYearId);
  const [branchId, setBranchId] = useState(
    initial?.branch?._id ?? workspaceBranchId ?? "",
  );
  const [date, setDate] = useState(isoDateValue(initialDate));
  const [description, setDescription] = useState(
    initial?.description ?? "",
  );
  const [lines, setLines] = useState<EditorLine[]>(
    initial
      ? initial.lines.map((line) => ({
          key: line._id,
          accountId: line.accountId,
          description: line.description,
          debit: line.debit ? String(line.debit) : "",
          credit: line.credit ? String(line.credit) : "",
        }))
      : [emptyLine(), emptyLine()],
  );
  const [action, setAction] = useState<
    "draft" | "submit" | "post" | "return" | null
  >(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [adjustKind, setAdjustKind] = useState<"reverse" | "correction" | null>(
    null,
  );
  const [adjustDate, setAdjustDate] = useState(isoDateValue(initialDate));
  const [adjustDescription, setAdjustDescription] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectedFiscalYear = fiscalYears.find(
    (year) => year._id === fiscalYearId,
  );
  const effectiveFiscal = selectedFiscalYear ?? initial?.fiscalYear ?? null;
  const selectedBranch = branches.find((branch) => branch._id === branchId);
  const accountMap = new Map<string, AccountRow>(
    (accounts ?? []).map((account) => [account._id, account]),
  );
  const status = initial?.status ?? "draft";
  const isClosed =
    effectiveFiscal?.status === "closed" ||
    initial?.fiscalYear?.status === "closed";
  const editable =
    canWrite &&
    !isClosed &&
    (!initial ||
      (initial.status === "draft" && initial.kind === "normal"));
  const canAct = canWrite && !isClosed;
  const dateTimestamp = timestampFromDateInput(date);
  const dateInRange =
    Number.isFinite(dateTimestamp) &&
    dateTimestamp >= fiscalStart &&
    dateTimestamp <= fiscalEnd;

  const parsedLines = lines.map((line) => {
    const debit = parseAmount(line.debit);
    const credit = parseAmount(line.credit);
    return {
      ...line,
      debitValue: debit,
      creditValue: credit,
      account: accountMap.get(line.accountId) ?? null,
    };
  });
  const totalDebit = parsedLines.reduce(
    (sum, line) => sum + line.debitValue,
    0,
  );
  const totalCredit = parsedLines.reduce(
    (sum, line) => sum + line.creditValue,
    0,
  );
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  const lineIssues: string[] = [];
  parsedLines.forEach((line, index) => {
    if (
      !line.accountId &&
      !line.debitValue &&
      !line.creditValue &&
      !line.description
    ) {
      return;
    }
    if (!line.accountId) {
      lineIssues.push(`ردیف ${index + 1}: حساب انتخاب نشده است.`);
    }
    if (line.account && !line.account.active) {
      lineIssues.push(`ردیف ${index + 1}: حساب غیرفعال است.`);
    }
    if (line.account && !line.account.postable) {
      lineIssues.push(`ردیف ${index + 1}: این حساب اجازه ثبت مستقیم ندارد.`);
    }
    if (!line.debitValue && !line.creditValue) {
      lineIssues.push(`ردیف ${index + 1}: مبلغ بدهکار یا بستانکار را وارد کنید.`);
    }
    if (line.debitValue > 0 && line.creditValue > 0) {
      lineIssues.push(`ردیف ${index + 1}: فقط یک طرف بدهکار یا بستانکار مجاز است.`);
    }
  });
  if (
    parsedLines.filter(
      (line) =>
        line.accountId ||
        line.debitValue ||
        line.creditValue ||
        line.description,
    ).length === 0
  ) {
    lineIssues.push("حداقل یک ردیف با حساب و مبلغ لازم است.");
  }

  const updateLine = (key: string, patch: Partial<EditorLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const buildPayloadLines = () => {
    if (!businessId) throw new Error("کسب‌وکار در دسترس نیست.");
    if (lineIssues.length > 0) throw new Error(lineIssues[0]);
    if (!description.trim()) throw new Error("شرح سند را وارد کنید.");
    if (!dateInRange) throw new Error("تاریخ سند باید داخل دوره مالی باشد.");
    if (!fiscalYearId) throw new Error("دوره مالی انتخاب نشده است.");
    if (!branchId) throw new Error("شعبه انتخاب نشده است.");

    const rows = parsedLines
      .filter(
        (line) =>
          line.accountId ||
          line.debit ||
          line.credit ||
          line.description,
      )
      .map((line) => ({
        accountId: line.accountId as Id<"accounts">,
        description: line.description.trim(),
        debit: line.debitValue,
        credit: line.creditValue,
      }));
    return {
      businessId,
      fiscalYearId: fiscalYearId as Id<"fiscalYears">,
      branchId: branchId as Id<"branches">,
      documentDate: dateTimestamp,
      description: description.trim(),
      lines: rows,
    };
  };

  const saveExistingDraft = async () => {
    const payload = buildPayloadLines();
    await updateDraft({
      ...payload,
      documentId: initial!._id as Id<"accountingDocuments">,
    });
  };

  const handleSaveDraft = async () => {
    if (!businessId) return;
    setAction("draft");
    try {
      const payload = buildPayloadLines();
      if (initial) {
        await saveExistingDraft();
        toast.success("پیش‌نویس سند به‌روزرسانی شد.");
      } else {
        const result = await create({ ...payload, status: "draft" });
        toast.success(`پیش‌نویس سند ${result.number} ذخیره شد.`);
        navigate(`/dashboard/accounting/documents/${result.documentId}`, {
          replace: true,
        });
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setAction(null);
    }
  };

  const handleSubmit = async () => {
    if (!businessId) return;
    setAction("submit");
    try {
      const payload = buildPayloadLines();
      if (!balanced) throw new Error("برای ارسال، سند باید متوازن باشد.");
      if (initial) {
        if (initial.status === "draft") {
          await saveExistingDraft();
          await submitDocument({
            businessId,
            documentId: initial._id as Id<"accountingDocuments">,
          });
        }
        toast.success("سند برای تأیید ارسال شد.");
      } else {
        const result = await create({ ...payload, status: "pending" });
        toast.success(`سند ${result.number} برای تأیید ارسال شد.`);
        navigate(`/dashboard/accounting/documents/${result.documentId}`, {
          replace: true,
        });
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setAction(null);
    }
  };

  const handlePost = async () => {
    if (!businessId) return;
    setAction("post");
    try {
      const payload = buildPayloadLines();
      if (!balanced) throw new Error("سند نامتوازن قابل قطعی‌شدن نیست.");
      if (initial) {
        if (initial.status === "draft") await saveExistingDraft();
        await postDocument({
          businessId,
          documentId: initial._id as Id<"accountingDocuments">,
        });
        toast.success("سند قطعی و در دفتر کل ثبت شد.");
      } else {
        const result = await create({ ...payload, status: "draft" });
        try {
          await postDocument({
            businessId,
            documentId: result.documentId,
          });
          toast.success(`سند ${result.number} قطعی شد.`);
        } catch (error) {
          toast.error(
            `${getErrorMessage(error)} پیش‌نویس ${result.number} ذخیره ماند.`,
          );
        }
        navigate(`/dashboard/accounting/documents/${result.documentId}`, {
          replace: true,
        });
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setAction(null);
    }
  };

  const handleDeleteDraft = async () => {
    if (!businessId || !initial) return;
    setDeleting(true);
    try {
      await removeDraft({
        businessId,
        documentId: initial._id as Id<"accountingDocuments">,
      });
      toast.success("پیش‌نویس سند حذف شد.");
      navigate("/dashboard/accounting/documents", { replace: true });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const handleReturn = async () => {
    if (!businessId || !initial) return;
    setAction("return");
    try {
      await returnToDraft({
        businessId,
        documentId: initial._id as Id<"accountingDocuments">,
      });
      toast.success("سند به پیش‌نویس برگشت.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setAction(null);
    }
  };

  const handleAdjust = async () => {
    if (!businessId || !initial || !adjustKind) return;
    const timestamp = timestampFromDateInput(adjustDate);
    if (!Number.isFinite(timestamp)) {
      toast.error("تاریخ معتبر نیست.");
      return;
    }
    setAdjusting(true);
    try {
      if (adjustKind === "reverse") {
        const result = await reverseDocument({
          businessId,
          documentId: initial._id as Id<"accountingDocuments">,
          reversalDate: timestamp,
          description: adjustDescription.trim() || undefined,
        });
        toast.success(`سند معکوس ${result.number} ثبت شد.`);
        setAdjustKind(null);
      } else {
        const result = await createCorrection({
          businessId,
          documentId: initial._id as Id<"accountingDocuments">,
          correctionDate: timestamp,
          description: adjustDescription.trim() || undefined,
        });
        toast.success(`پیش‌نویس اصلاحی ${result.number} ساخته شد.`);
        setAdjustKind(null);
        navigate(
          `/dashboard/accounting/documents/${result.correctionId}`,
        );
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setAdjusting(false);
    }
  };

  const handlePrint = () => {
    printAccountingView(
      initial ? `سند حسابداری ${initial.number}` : "پیش‌نویس سند حسابداری",
    );
  };

  const sheetLines = parsedLines
    .filter(
      (line) =>
        line.accountId || line.debit || line.credit || line.description,
    )
    .map((line) => ({
      key: line.key,
      accountCode: line.account?.code ?? "—",
      accountName: line.account?.name ?? "حساب انتخاب نشده",
      linkedEntityName: line.account?.linkedEntityName ?? null,
      description: line.description,
      debit: line.debitValue,
      credit: line.creditValue,
    }));

  const statusMeta = documentStatusMeta(status);

  if (!businessId || !workspace) return <WorkspaceLoader />;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          initial
            ? `${DOCUMENT_KIND_LABELS[initial.kind]} · ${initial.number}`
            : "سند حسابداری جدید"
        }
        title={initial ? `سند ${initial.number}` : "ثبت سند حسابداری"}
        description={
          initial
            ? `${initial.description} · ثبت‌کننده ${initial.createdByName}`
            : "سند را با حداقل دو ردیف بدهکار و بستانکار متوازن ثبت کنید. پیش‌نویس نامتوازن ذخیره می‌شود اما قطعی نمی‌شود."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 px-3.5"
            >
              <Link to="/dashboard/accounting/documents">
                <ArrowLeft className="size-4" />
                اسناد
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPreviewOpen(true)}
              className="h-9 gap-1.5 rounded-xl"
            >
              <Eye className="size-4" />
              پیش‌نمایش
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="h-9 gap-1.5 rounded-xl"
            >
              <Printer className="size-4" />
              چاپ
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                toast.info("در پنجره چاپ، «ذخیره به PDF» را انتخاب کنید.");
                window.setTimeout(handlePrint, 250);
              }}
              className="h-9 gap-1.5 rounded-xl px-3.5"
            >
              <FilePenLine className="size-4" />
              PDF
            </Button>
          </div>
        }
      />

      {isClosed ? (
        <div className="flex items-start gap-2 rounded-[18px] border border-gold/25 bg-gold-soft/35 px-4 py-3 text-[10px] leading-6 text-[#7a6122] dark:bg-gold-soft/5 dark:text-gold">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" />
          دوره مالی این سند بسته شده است؛ سند فقط قابل مشاهده و چاپ است.
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="سربرگ سند"
            description="شماره در Backend و به‌صورت یکتا برای همین دوره مالی تولید می‌شود."
            action={
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold",
                  statusMeta.badge,
                )}
              >
                <span className={cn("size-1.5 rounded-full", statusMeta.dot)} />
                {statusMeta.label}
              </span>
            }
          />
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-[10px]">شماره سند</Label>
              <div className="num flex h-9 items-center rounded-xl border border-hairline bg-background/60 px-2.5 font-mono text-[11px] text-ink-soft" dir="ltr">
                {initial?.number ?? "پس از ذخیره"}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-date" className="text-[10px]">
                تاریخ سند
              </Label>
              <Input
                id="doc-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                disabled={!editable}
                dir="ltr"
                className={cn(
                  "num rounded-xl border-hairline bg-background text-start text-[10px]",
                  !dateInRange && "border-destructive",
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">دوره مالی</Label>
              <Select
                value={fiscalYearId}
                onValueChange={(value) => {
                  setFiscalYearId(value);
                  const year = fiscalYears.find((row) => row._id === value);
                  if (year) {
                    setDate(
                      isoDateValue(
                        clampDate(timestampFromDateInput(date), year.startAt, year.endAt),
                      ),
                    );
                  }
                }}
                disabled={Boolean(initial) || !canWrite}
              >
                <SelectTrigger className="rounded-xl border-hairline bg-background text-[10px]">
                  <SelectValue placeholder="انتخاب دوره" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {fiscalYears.map((year) => (
                    <SelectItem
                      key={year._id}
                      value={year._id}
                      disabled={year.status === "closed"}
                    >
                      {year.name}
                      {year.status === "closed" ? " (بسته)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">شعبه</Label>
              <Select
                value={branchId}
                onValueChange={setBranchId}
                disabled={!canWrite}
              >
                <SelectTrigger className="rounded-xl border-hairline bg-background text-[10px]">
                  <SelectValue placeholder="انتخاب شعبه" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {branches.map((branch) => (
                    <SelectItem key={branch._id} value={branch._id}>
                      {branch.name} — {branch.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="border-t border-hairline/40 px-4 py-3">
            <Label htmlFor="doc-description" className="text-[10px]">
              شرح سند <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="doc-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              maxLength={500}
              disabled={!editable}
              placeholder="مثلاً ثبت هزینه اجاره دفتر — خرداد ۱۴۰۵"
              className="mt-1.5 resize-none rounded-xl border-hairline bg-background text-xs"
            />
            <p className="mt-1 text-[8px] text-ink-soft">
              {formatJalaliLong(dateTimestamp) || "تاریخ نامعتبر"} ·{" "}
              {selectedBranch?.name ?? "شعبه‌ای انتخاب نشده"}
            </p>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader
            title="کنترل توازن"
            description="کنترل نهایی در Backend دوباره انجام می‌شود."
          />
          <div className="space-y-2 px-4 pb-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-hairline/50 bg-background/60 p-3">
                <p className="text-[8px] text-ink-soft">جمع بدهکار</p>
                <p className="num mt-1 truncate text-[15px] font-bold text-ink">
                  {formatNumber(totalDebit)}
                </p>
                <p className="mt-0.5 text-[8px] text-ink-soft">{unit}</p>
              </div>
              <div className="rounded-xl border border-hairline/50 bg-background/60 p-3">
                <p className="text-[8px] text-ink-soft">جمع بستانکار</p>
                <p className="num mt-1 truncate text-[15px] font-bold text-ink">
                  {formatNumber(totalCredit)}
                </p>
                <p className="mt-0.5 text-[8px] text-ink-soft">{unit}</p>
              </div>
            </div>
            <div
              className={cn(
                "flex items-center justify-between rounded-xl border px-3 py-2.5",
                balanced
                  ? "border-brand/20 bg-brand-soft/40 text-brand dark:bg-brand-soft/10"
                  : "border-gold/30 bg-gold-soft/30 text-[#7a6122] dark:bg-gold-soft/5 dark:text-gold",
              )}
            >
              <span className="flex items-center gap-1.5 text-[9px] font-semibold">
                {balanced ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <AlertTriangle className="size-3.5" />
                )}
                {balanced ? "سند متوازن است" : "سند متوازن نیست"}
              </span>
              <span className="num text-[10px] font-bold">
                اختلاف: {formatNumber(Math.abs(totalDebit - totalCredit))}
              </span>
            </div>
            {!dateInRange ? (
              <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-[8px] leading-4 text-destructive">
                تاریخ خارج از دوره مالی انتخاب‌شده است.
              </p>
            ) : null}
            {lineIssues.length > 0 ? (
              <ul className="space-y-1 rounded-xl border border-gold/25 bg-gold-soft/25 px-3 py-2 dark:bg-gold-soft/5">
                {lineIssues.slice(0, 3).map((issue) => (
                  <li
                    key={issue}
                    className="flex items-start gap-1 text-[8px] leading-4 text-[#7a6122] dark:text-gold"
                  >
                    <AlertTriangle className="mt-0.5 size-2.5 shrink-0" />
                    {issue}
                  </li>
                ))}
              </ul>
            ) : null}
            {initial ? (
              <dl className="space-y-1.5 border-t border-hairline/50 pt-2 text-[8px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-soft">ثبت‌کننده</dt>
                  <dd className="font-semibold text-ink">{initial.createdByName}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-soft">تاریخ ثبت</dt>
                  <dd className="num text-ink">{formatJalali(initial.createdAt)}</dd>
                </div>
                {initial.postedAt ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-soft">تاریخ قطعی</dt>
                    <dd className="num text-ink">{formatJalali(initial.postedAt)}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="flex items-start gap-1.5 rounded-xl bg-background/60 px-3 py-2 text-[8px] leading-4 text-ink-soft">
                <Info className="mt-0.5 size-3 shrink-0" />
                شماره سند و تاریخ ثبت پس از ذخیره توسط سرور تعیین می‌شود.
              </p>
            )}
          </div>
        </Panel>
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="ردیف‌های سند"
          description="فقط حساب‌های تفصیلی فعال؛ هر ردیف دقیقاً یک طرف بدهکار یا بستانکار."
          action={
            editable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLines((current) =>
                    current.length >= 200
                      ? current
                      : [...current, emptyLine()],
                  )
                }
                className="h-8 gap-1.5 rounded-lg text-[9px]"
              >
                <Plus className="size-3.5" />
                افزودن ردیف
              </Button>
            ) : null
          }
        />

        <div className="hidden overflow-x-auto lg:block">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 ps-4 text-[9px] text-ink-soft">#</TableHead>
                <TableHead className="min-w-64 text-[9px] text-ink-soft">
                  حساب
                </TableHead>
                <TableHead className="min-w-48 text-[9px] text-ink-soft">
                  شرح ردیف
                </TableHead>
                <TableHead className="w-32 text-[9px] text-ink-soft">
                  بدهکار ({unit})
                </TableHead>
                <TableHead className="w-32 text-[9px] text-ink-soft">
                  بستانکار ({unit})
                </TableHead>
                <TableHead className="w-10 pe-4 text-[9px] text-ink-soft" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {parsedLines.map((line, index) => (
                <TableRow key={line.key}>
                  <TableCell className="num ps-4 text-[9px] text-ink-soft">
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <AccountPicker
                      accounts={accounts ?? []}
                      value={line.accountId || null}
                      onChange={(accountId) =>
                        updateLine(line.key, { accountId })
                      }
                      disabled={!editable}
                      onlyPostable
                      placeholder="حساب تفصیلی…"
                    />
                    {line.account?.linkedEntityName ? (
                      <p className="mt-0.5 truncate text-[8px] text-ink-soft">
                        تفصیلی: {line.account.linkedEntityName}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={line.description}
                      onChange={(event) =>
                        updateLine(line.key, {
                          description: event.target.value,
                        })
                      }
                      disabled={!editable}
                      maxLength={300}
                      placeholder="شرح اختیاری ردیف"
                      className="h-9 rounded-lg border-hairline bg-background text-[10px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={line.debit}
                      onChange={(event) =>
                        updateLine(line.key, {
                          debit: event.target.value,
                          credit: event.target.value ? "" : line.credit,
                        })
                      }
                      disabled={!editable}
                      inputMode="numeric"
                      dir="ltr"
                      placeholder="0"
                      className={cn(
                        "num h-9 rounded-lg border-hairline bg-background text-start text-[10px]",
                        line.debit && "border-brand/40 bg-brand-soft/20",
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={line.credit}
                      onChange={(event) =>
                        updateLine(line.key, {
                          credit: event.target.value,
                          debit: event.target.value ? "" : line.debit,
                        })
                      }
                      disabled={!editable}
                      inputMode="numeric"
                      dir="ltr"
                      placeholder="0"
                      className={cn(
                        "num h-9 rounded-lg border-hairline bg-background text-start text-[10px]",
                        line.credit && "border-gold/40 bg-gold-soft/20",
                      )}
                    />
                  </TableCell>
                  <TableCell className="pe-4">
                    {editable ? (
                      <button
                        type="button"
                        onClick={() =>
                          setLines((current) =>
                            current.length <= 1
                              ? current
                              : current.filter((row) => row.key !== line.key),
                          )
                        }
                        className="rounded-lg p-1.5 text-ink-soft hover:bg-destructive/5 hover:text-destructive"
                        aria-label={`حذف ردیف ${index + 1}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3 p-3 lg:hidden">
          {parsedLines.map((line, index) => (
            <div
              key={line.key}
              className="rounded-2xl border border-hairline/60 bg-background/50 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="num text-[9px] font-semibold text-ink-soft">
                  ردیف {index + 1}
                </span>
                {editable ? (
                  <button
                    type="button"
                    onClick={() =>
                      setLines((current) =>
                        current.length <= 1
                          ? current
                          : current.filter((row) => row.key !== line.key),
                      )
                    }
                    className="rounded-lg p-1 text-ink-soft hover:text-destructive"
                    aria-label={`حذف ردیف ${index + 1}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <AccountPicker
                accounts={accounts ?? []}
                value={line.accountId || null}
                onChange={(accountId) => updateLine(line.key, { accountId })}
                disabled={!editable}
                onlyPostable
                placeholder="حساب تفصیلی…"
              />
              <Input
                value={line.description}
                onChange={(event) =>
                  updateLine(line.key, { description: event.target.value })
                }
                disabled={!editable}
                maxLength={300}
                placeholder="شرح ردیف"
                className="mt-2 h-9 rounded-lg border-hairline bg-background text-[10px]"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input
                  value={line.debit}
                  onChange={(event) =>
                    updateLine(line.key, {
                      debit: event.target.value,
                      credit: event.target.value ? "" : line.credit,
                    })
                  }
                  disabled={!editable}
                  inputMode="numeric"
                  dir="ltr"
                  placeholder={`بدهکار (${unit})`}
                  className="num h-9 rounded-lg border-hairline bg-background text-start text-[10px]"
                />
                <Input
                  value={line.credit}
                  onChange={(event) =>
                    updateLine(line.key, {
                      credit: event.target.value,
                      debit: event.target.value ? "" : line.debit,
                    })
                  }
                  disabled={!editable}
                  inputMode="numeric"
                  dir="ltr"
                  placeholder={`بستانکار (${unit})`}
                  className="num h-9 rounded-lg border-hairline bg-background text-start text-[10px]"
                />
              </div>
            </div>
          ))}
          {editable ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setLines((current) => [...current, emptyLine()])}
              className="w-full gap-1.5 rounded-xl border-dashed text-[10px]"
            >
              <Plus className="size-3.5" />
              افزودن ردیف
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 bg-background/40 px-4 py-3">
          <span className="text-[9px] text-ink-soft">
            {parsedLines.length} ردیف · {unit}
          </span>
          <div className="flex flex-wrap items-center gap-2 text-[9px]">
            <span className="rounded-lg bg-card px-2 py-1">
              بدهکار:{" "}
              <b className="num text-ink">{formatNumber(totalDebit)}</b>
            </span>
            <span className="rounded-lg bg-card px-2 py-1">
              بستانکار:{" "}
              <b className="num text-ink">{formatNumber(totalCredit)}</b>
            </span>
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {canAct && (!initial || initial.status === "draft") ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleSaveDraft}
              disabled={action !== null || !editable}
              className="gap-1.5 rounded-xl"
            >
              {action === "draft" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              ذخیره پیش‌نویس
            </Button>
          ) : null}
          {initial?.status === "draft" && canAct ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={action !== null || deleting}
                  className="gap-1.5 rounded-xl text-destructive hover:text-destructive"
                >
                  {deleting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  حذف پیش‌نویس
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-[24px] text-start">
                <AlertDialogHeader className="text-start">
                  <AlertDialogTitle className="text-base">
                    حذف پیش‌نویس سند
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-[11px] leading-6">
                    پیش‌نویس سند {initial.number} و تمام ردیف‌های آن حذف
                    می‌شود. شماره مصرف‌شده دوباره استفاده نخواهد شد. این عملیات
                    فقط برای اسناد پیش‌نویس مجاز است.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 sm:justify-start">
                  <AlertDialogAction
                    onClick={handleDeleteDraft}
                    disabled={deleting}
                    className="gap-1.5 rounded-xl bg-destructive text-white hover:bg-destructive/90"
                  >
                    {deleting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    حذف قطعی پیش‌نویس
                  </AlertDialogAction>
                  <AlertDialogCancel className="rounded-xl">
                    انصراف
                  </AlertDialogCancel>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {canAct && (!initial || initial.status === "draft") ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleSubmit}
              disabled={action !== null || !balanced || !editable}
              className="gap-1.5 rounded-xl"
            >
              {action === "submit" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              ارسال برای تأیید
            </Button>
          ) : null}
          {canAct && (!initial || initial.status === "draft" || initial.status === "pending") ? (
            <Button
              type="button"
              onClick={handlePost}
              disabled={action !== null || !balanced || !editable && initial?.status !== "pending"}
              className="gap-1.5 rounded-xl"
            >
              {action === "post" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              ثبت قطعی
            </Button>
          ) : null}
          {initial?.status === "pending" && canAct ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleReturn}
              disabled={action !== null}
              className="gap-1.5 rounded-xl"
            >
              {action === "return" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              بازگشت به پیش‌نویس
            </Button>
          ) : null}
        </div>

        {initial && initial.kind === "normal" && canAct ? (
          <div className="flex flex-wrap gap-2">
            {initial.status === "posted" && !initial.linked.reversal ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setAdjustKind("correction");
                    setAdjustDescription("");
                    setAdjustDate(isoDateValue(clampDate(Date.now(), fiscalStart, fiscalEnd)));
                  }}
                  className="gap-1.5 rounded-xl text-[10px]"
                >
                  <FilePenLine className="size-3.5" />
                  سند اصلاحی
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setAdjustKind("reverse");
                    setAdjustDescription("");
                    setAdjustDate(isoDateValue(clampDate(Date.now(), fiscalStart, fiscalEnd)));
                  }}
                  className="gap-1.5 rounded-xl text-[10px]"
                >
                  <ArrowRightLeft className="size-3.5" />
                  سند معکوس
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {initial?.history.length ? (
        <Panel className="overflow-hidden">
          <PanelHeader
            title="تاریخچه سند"
            description="هر تغییر در یک ردیف حسابرسی جداگانه ثبت شده است."
          />
          <ul className="divide-y divide-hairline/40 px-4 pb-3">
            {initial.history.map((entry) => (
              <li key={entry._id} className="flex gap-3 py-2.5">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-cream/60 text-ink-soft dark:bg-white/[0.05]">
                  <History className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-semibold text-ink">
                    {entry.summary}
                  </p>
                  <p className="mt-0.5 text-[8px] text-ink-soft">
                    {entry.actorName} ·{" "}
                    <span className="num">{formatJalali(entry.createdAt)}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {initial?.linked.original || initial?.linked.reversal ? (
        <Panel className="p-3">
          <div className="flex flex-wrap gap-2 text-[9px]">
            {initial.linked.original ? (
              <Link
                to={`/dashboard/accounting/documents/${initial.linked.original._id}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline/60 bg-background/60 px-3 py-2 text-ink hover:border-brand/30"
              >
                <BookOpen className="size-3.5 text-brand" />
                سند مرتبط: {initial.linked.original.number}
              </Link>
            ) : null}
            {initial.linked.reversal ? (
              <Link
                to={`/dashboard/accounting/documents/${initial.linked.reversal._id}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline/60 bg-background/60 px-3 py-2 text-ink hover:border-brand/30"
              >
                <ArrowRightLeft className="size-3.5 text-gold" />
                سند معکوس: {initial.linked.reversal.number}
              </Link>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <div className="hidden print:block">
        <DocumentSheet
          businessName={workspace.business.name}
          number={initial?.number ?? "پیش‌نویس"}
          documentDate={dateTimestamp || initialDate}
          description={description || "—"}
          status={status}
          kind={initial?.kind ?? "normal"}
          branchName={selectedBranch?.name ?? "—"}
          fiscalYearName={effectiveFiscal?.name ?? "—"}
          createdByName={initial?.createdByName ?? user?.name ?? user?.email ?? "کاربر"}
          lines={sheetLines}
          currency={currency}
        />
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[24px] border-white/70 bg-card/95 p-3 backdrop-blur-xl dark:border-white/10 sm:max-w-4xl">
          <DialogHeader className="sr-only">
            <DialogTitle>پیش‌نمایش سند</DialogTitle>
            <DialogDescription>نمای چاپی سند حسابداری</DialogDescription>
          </DialogHeader>
          <DocumentSheet
            businessName={workspace.business.name}
            number={initial?.number ?? "پیش‌نویس"}
            documentDate={dateTimestamp || initialDate}
            description={description || "—"}
            status={status}
            kind={initial?.kind ?? "normal"}
            branchName={selectedBranch?.name ?? "—"}
            fiscalYearName={effectiveFiscal?.name ?? "—"}
            createdByName={initial?.createdByName ?? user?.name ?? user?.email ?? "کاربر"}
            lines={sheetLines}
            currency={currency}
          />
          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              type="button"
              onClick={() => printAccountingView("پیش‌نمایش سند حسابداری")}
              className="gap-1.5 rounded-xl"
            >
              <Printer className="size-4" />
              چاپ / PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreviewOpen(false)}
              className="rounded-xl"
            >
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={adjustKind !== null}
        onOpenChange={(next) => !next && setAdjustKind(null)}
      >
        <DialogContent className="rounded-[24px] border-white/70 bg-card/95 text-start backdrop-blur-xl dark:border-white/10 sm:max-w-md">
          <DialogHeader className="text-start">
            <DialogTitle className="text-base">
              {adjustKind === "reverse" ? "ثبت سند معکوس" : "ایجاد سند اصلاحی"}
            </DialogTitle>
            <DialogDescription className="text-[10px] leading-5">
              {adjustKind === "reverse"
                ? "سند معکوس با جای بدهکار و بستانکار ثبت می‌شود. سند اصلی حذف نمی‌شود و وضعیت آن «معکوس‌شده» می‌شود."
                : "یک پیش‌نویس با همان ردیف‌ها ساخته می‌شود تا اصلاحات را اعمال و سپس قطعی کنید. هنگام قطعی‌شدن، سند اصلی به‌صورت خودکار معکوس و سپس اصلاحیه ثبت می‌شود."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="adjust-date" className="text-xs">
                تاریخ سند {adjustKind === "reverse" ? "معکوس" : "اصلاحی"}
              </Label>
              <Input
                id="adjust-date"
                type="date"
                value={adjustDate}
                onChange={(event) => setAdjustDate(event.target.value)}
                dir="ltr"
                className="num rounded-xl border-hairline bg-background text-start text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjust-description" className="text-xs">
                شرح (اختیاری)
              </Label>
              <Textarea
                id="adjust-description"
                value={adjustDescription}
                onChange={(event) => setAdjustDescription(event.target.value)}
                rows={2}
                maxLength={500}
                className="resize-none rounded-xl border-hairline bg-background text-xs"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              type="button"
              onClick={handleAdjust}
              disabled={adjusting}
              className="gap-1.5 rounded-xl"
            >
              {adjusting ? <Loader2 className="size-4 animate-spin" /> : null}
              {adjustKind === "reverse" ? "ثبت معکوس" : "ساخت پیش‌نویس اصلاحی"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAdjustKind(null)}
              disabled={adjusting}
              className="rounded-xl"
            >
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DocumentEditor() {
  const { documentId } = useParams<{ documentId: string }>();
  const { businessId } = useWorkspace();

  const detail = useQuery(
    api.accountingDocuments.get,
    businessId && documentId
      ? {
          businessId,
          documentId: documentId as Id<"accountingDocuments">,
        }
      : "skip",
  );

  if (!businessId) return <WorkspaceLoader />;

  if (documentId) {
    if (!detail) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-20 rounded-[26px]" />
          <Skeleton className="h-64 rounded-[26px]" />
          <Skeleton className="h-40 rounded-[26px]" />
        </div>
      );
    }
    return <DocumentEditorForm key={detail._id} initial={detail} />;
  }

  return <DocumentEditorForm key="new" initial={null} />;
}
