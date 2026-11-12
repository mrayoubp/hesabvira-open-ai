import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/app/ui";
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
import type {
  AccountDetailKind,
  AccountLevel,
  AccountNature,
  AccountType,
} from "@/convex/schema";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  ACCOUNT_LEVEL_LABELS,
  ACCOUNT_NATURE_LABELS,
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ORDER,
} from "@/lib/accounting";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Info,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

type AccountRow = FunctionReturnType<typeof api.accounts.list>[number];

const DETAIL_KIND_LABELS: Record<AccountDetailKind, string> = {
  none: "بدون تفصیلی شناور",
  customer: "مشتری",
  supplier: "تأمین‌کننده",
  employee: "پرسنل",
  other: "سایر موجودیت‌ها",
};

const LEVEL_ORDER: AccountLevel[] = [
  "group",
  "ledger",
  "subsidiary",
  "detail",
];

const LEVEL_TONES: Record<AccountLevel, string> = {
  group: "bg-brand text-cream",
  ledger: "bg-brand/15 text-brand",
  subsidiary: "bg-gold-soft text-[#7a6122] dark:text-gold",
  detail: "bg-mist/60 text-[#245c5c] dark:bg-mist/20 dark:text-[#a9d5e2]",
};

function defaultNature(type: AccountType): AccountNature {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

function childLevel(level: AccountLevel | null): AccountLevel {
  if (!level) return "group";
  return level === "group"
    ? "ledger"
    : level === "ledger"
      ? "subsidiary"
      : "detail";
}

function AccountDialog({
  open,
  onClose,
  businessId,
  accounts,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  businessId: Id<"businesses">;
  accounts: AccountRow[];
  editing: AccountRow | null;
}) {
  const create = useMutation(api.accounts.create);
  const update = useMutation(api.accounts.update);
  const usage = useQuery(
    api.accounts.usage,
    editing ? { businessId, accountId: editing._id as Id<"accounts"> } : "skip",
  );
  const customers = useQuery(
    api.customers.list,
    open ? { businessId } : "skip",
  );

  const [code, setCode] = useState(editing?.code ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [parentId, setParentId] = useState(editing?.parentId ?? "root");
  const [type, setType] = useState<AccountType>(editing?.type ?? "asset");
  const [nature, setNature] = useState<AccountNature>(
    editing?.nature ?? "debit",
  );
  const [detailKind, setDetailKind] = useState<AccountDetailKind>(
    editing?.detailKind ?? "none",
  );
  const [linkedEntityId, setLinkedEntityId] = useState(
    editing?.linkedEntityId ?? "",
  );
  const [linkedEntityName, setLinkedEntityName] = useState(
    editing?.linkedEntityName ?? "",
  );
  const [description, setDescription] = useState(editing?.description ?? "");
  const [saving, setSaving] = useState(false);

  const parent =
    parentId === "root"
      ? null
      : accounts.find((account) => account._id === parentId) ?? null;
  const level = childLevel(parent?.level ?? null);
  const locked =
    Boolean(editing) &&
    (Boolean(usage?.used) || (editing?.childCount ?? 0) > 0);
  const systemLocked = Boolean(editing?.systemKey);

  const parentOptions = accounts.filter(
    (account) =>
      account.active &&
      account.level !== "detail" &&
      account._id !== editing?._id,
  );

  const handleParentChange = (value: string) => {
    setParentId(value);
    const nextParent =
      value === "root" ? null : accounts.find((row) => row._id === value);
    if (nextParent) {
      setType(nextParent.type);
      setNature(nextParent.nature);
    }
    if (childLevel(nextParent?.level ?? null) !== "detail") {
      setDetailKind("none");
      setLinkedEntityId("");
      setLinkedEntityName("");
    }
  };

  const handleTypeChange = (value: AccountType) => {
    setType(value);
    setNature(defaultNature(value));
  };

  const handleDetailKind = (value: AccountDetailKind) => {
    setDetailKind(value);
    setLinkedEntityId("");
    setLinkedEntityName("");
  };

  const handleCustomer = (customerId: string) => {
    setLinkedEntityId(customerId);
    const customer = customers?.find((row) => row._id === customerId);
    setLinkedEntityName(customer?.name ?? "");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{1,20}$/.test(code.trim())) {
      toast.error("کد حساب باید فقط از ارقام تشکیل شده باشد.");
      return;
    }
    if (!name.trim()) {
      toast.error("نام حساب را وارد کنید.");
      return;
    }
    if (level !== "detail" && detailKind !== "none") {
      toast.error("تفصیلی شناور فقط در سطح تفصیلی مجاز است.");
      return;
    }
    if (level === "detail" && detailKind === "customer" && !linkedEntityId) {
      toast.error("مشتری حساب تفصیلی را انتخاب کنید.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        businessId,
        code: code.trim(),
        name: name.trim(),
        parentId:
          parentId === "root" ? undefined : (parentId as Id<"accounts">),
        type,
        nature,
        detailKind,
        linkedEntityId:
          level === "detail" && detailKind !== "none"
            ? linkedEntityId || undefined
            : undefined,
        linkedEntityName:
          level === "detail" && detailKind !== "none"
            ? linkedEntityName || undefined
            : undefined,
        description: description.trim() || undefined,
      };
      if (editing) {
        await update({ ...payload, accountId: editing._id as Id<"accounts"> });
        toast.success("حساب ویرایش شد.");
      } else {
        await create(payload);
        toast.success("حساب جدید ایجاد شد.");
      }
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[24px] border-white/70 bg-card/95 text-start backdrop-blur-xl dark:border-white/10 sm:max-w-2xl">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex size-8 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <Layers3 className="size-4" />
            </span>
            {editing ? "ویرایش حساب" : "افزودن حساب به کدینگ"}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            سطح حساب از روی حساب والد تعیین می‌شود. فقط حساب تفصیلی اجازه ثبت
            مستقیم در سند دارد.
          </DialogDescription>
        </DialogHeader>

        {locked ? (
          <p className="flex items-start gap-2 rounded-xl border border-gold/25 bg-gold-soft/30 px-3 py-2 text-[9px] leading-5 text-[#7a6122] dark:bg-gold-soft/5 dark:text-gold">
            <Info className="mt-0.5 size-3 shrink-0" />
            این حساب در اسناد یا حساب‌های زیرمجموعه استفاده شده است؛ کد، سطح،
            والد و نوع آن قفل است. برای حفظ تاریخچه فقط نام، ماهیت و توضیحات
            قابل تغییر است.
          </p>
        ) : null}

        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">حساب والد</Label>
              <Select
                value={parentId}
                onValueChange={handleParentChange}
                disabled={locked || systemLocked}
              >
                <SelectTrigger className="rounded-xl border-hairline bg-background text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl">
                  <SelectItem value="root">بدون والد — گروه حساب</SelectItem>
                  {parentOptions.map((account) => (
                    <SelectItem key={account._id} value={account._id}>
                      {account.code} — {account.name} (
                      {ACCOUNT_LEVEL_LABELS[account.level]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">کد حساب</Label>
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                dir="ltr"
                placeholder="مثلاً 110103"
                disabled={locked || systemLocked}
                className="rounded-xl border-hairline bg-background font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">سطح</Label>
              <div className="flex h-9 items-center rounded-xl border border-hairline bg-background/60 px-2.5 text-[10px] text-ink-soft">
                {ACCOUNT_LEVEL_LABELS[level]}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">نام حساب</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={160}
              placeholder="نام دقیق و قابل فهم"
              className="rounded-xl border-hairline bg-background text-xs"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">نوع حساب</Label>
              <Select
                value={type}
                onValueChange={(value) => handleTypeChange(value as AccountType)}
                disabled={Boolean(parent) || locked || systemLocked}
              >
                <SelectTrigger className="rounded-xl border-hairline bg-background text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {ACCOUNT_TYPE_ORDER.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ACCOUNT_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {parent ? (
                <p className="text-[8px] text-ink-soft">
                  نوع از والد ارث می‌رسد و باید یکسان بماند.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ماهیت حساب</Label>
              <Select
                value={nature}
                onValueChange={(value) => setNature(value as AccountNature)}
                disabled={locked || systemLocked}
              >
                <SelectTrigger className="rounded-xl border-hairline bg-background text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {(["debit", "credit"] as AccountNature[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {ACCOUNT_NATURE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {level === "detail" ? (
            <div className="rounded-xl border border-hairline/60 bg-background/50 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">تفصیلی شناور</Label>
                  <Select
                    value={detailKind}
                    onValueChange={(value) =>
                      handleDetailKind(value as AccountDetailKind)
                    }
                    disabled={systemLocked}
                  >
                    <SelectTrigger className="rounded-xl border-hairline bg-background text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {(Object.keys(DETAIL_KIND_LABELS) as AccountDetailKind[]).map(
                        (value) => (
                          <SelectItem key={value} value={value}>
                            {DETAIL_KIND_LABELS[value]}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {detailKind === "customer" ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">مشتری مرتبط</Label>
                    <Select
                      value={linkedEntityId}
                      onValueChange={handleCustomer}
                    >
                      <SelectTrigger className="rounded-xl border-hairline bg-background text-xs">
                        <SelectValue placeholder="انتخاب مشتری" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 rounded-xl">
                        {(customers ?? []).map((customer) => (
                          <SelectItem key={customer._id} value={customer._id}>
                            {customer.name} — {customer.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : detailKind !== "none" ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">نام موجودیت</Label>
                    <Input
                      value={linkedEntityName}
                      onChange={(event) =>
                        setLinkedEntityName(event.target.value)
                      }
                      placeholder="نام تأمین‌کننده، پرسنل یا موجودیت"
                      className="rounded-xl border-hairline bg-background text-xs"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              maxLength={400}
              className="resize-none rounded-xl border-hairline bg-background text-xs"
            />
          </div>

          <DialogFooter className="gap-2 border-t border-hairline/60 pt-3 sm:justify-start">
            <Button type="submit" disabled={saving} className="gap-1.5 rounded-xl">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {editing ? "ذخیره تغییرات" : "افزودن حساب"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
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

export default function ChartOfAccounts() {
  const { businessId, canWrite } = useWorkspace();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | AccountType>("all");
  const [levelFilter, setLevelFilter] = useState<"all" | AccountLevel>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const deferredSearch = useDeferredValue(search);
  const highlightId = searchParams.get("account");

  const accounts = useQuery(
    api.accounts.list,
    businessId ? { businessId, includeInactive: true } : "skip",
  );
  const setActive = useMutation(api.accounts.setActive);
  const ensureDefaults = useMutation(api.accounts.ensureDefaults);

  const rows = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    return (accounts ?? [])
      .filter((account) => typeFilter === "all" || account.type === typeFilter)
      .filter((account) => levelFilter === "all" || account.level === levelFilter)
      .filter((account) => {
        if (!needle) return true;
        return [account.code, account.name, account.linkedEntityName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { numeric: true }),
      );
  }, [accounts, deferredSearch, typeFilter, levelFilter]);

  const byId = new Map((accounts ?? []).map((account) => [account._id, account]));

  const depthOf = (account: AccountRow) => {
    let depth = 0;
    let cursor = account.parentId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      depth += 1;
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return depth;
  };

  const toggleActive = async (account: AccountRow) => {
    if (!businessId) return;
    try {
      await setActive({
        businessId,
        accountId: account._id as Id<"accounts">,
        active: !account.active,
      });
      toast.success(account.active ? "حساب غیرفعال شد." : "حساب فعال شد.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="حسابداری دوبل · کدینگ"
        title="درخت حساب‌ها"
        description="گروه حساب، حساب کل، معین و تفصیلی. کد هر حساب در کل کسب‌وکار یکتاست و فقط حساب تفصیلی فعال قابل ثبت در سند است."
        actions={
          <>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 px-3.5"
            >
              <Link to="/dashboard/accounting/journal">
                <Sparkles className="size-4" />
                دفتر روزنامه
              </Link>
            </Button>
            <Button
              size="sm"
              disabled={!canWrite}
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="h-9 gap-1.5 rounded-xl px-3.5"
            >
              <Plus className="size-4" />
              افزودن حساب
            </Button>
          </>
        }
      />

      <Panel className="overflow-hidden">
        <PanelHeader
          title="ساختار کدینگ"
          description={
            accounts
              ? `${accounts.length.toLocaleString("fa-IR")} حساب تعریف‌شده · ${
                  accounts.filter((account) => account.postable && account.active)
                    .length
                } حساب تفصیلی فعال`
              : "در حال دریافت کدینگ…"
          }
          action={
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute end-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-soft" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="کد یا نام حساب"
                className="h-8 rounded-lg border-hairline bg-background pe-7 text-[10px]"
                aria-label="جستجوی حساب"
              />
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-1 border-b border-hairline/50 px-4 py-2">
          <div className="flex flex-wrap gap-1">
            {(["all", ...ACCOUNT_TYPE_ORDER] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTypeFilter(value)}
                className={cn(
                  "rounded-full px-2.5 py-1.5 text-[8px] font-semibold transition-colors",
                  typeFilter === value
                    ? "bg-primary text-primary-foreground"
                    : "text-ink-soft hover:bg-cream/60 hover:text-ink",
                )}
              >
                {value === "all" ? "همه انواع" : ACCOUNT_TYPE_LABELS[value]}
              </button>
            ))}
          </div>
          <span className="mx-1 hidden h-4 w-px bg-hairline sm:block" />
          <Select
            value={levelFilter}
            onValueChange={(value) =>
              setLevelFilter(value as "all" | AccountLevel)
            }
          >
            <SelectTrigger className="h-7 w-28 rounded-lg text-[8px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">همه سطوح</SelectItem>
              {LEVEL_ORDER.map((level) => (
                <SelectItem key={level} value={level}>
                  {ACCOUNT_LEVEL_LABELS[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!accounts ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 rounded-xl" />
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={<Layers3 className="size-5" />}
            title="کدینگ حساب‌ها خالی است"
            description="کدینگ استاندارد را ایجاد کنید؛ سپس می‌توانید حساب‌های اختصاصی و تفصیلی شناور اضافه کنید."
            action={
              <Button
                size="sm"
                disabled={!canWrite || !businessId}
                onClick={() => {
                  if (!businessId) return;
                  ensureDefaults({ businessId }).then(
                    () => toast.success("کدینگ استاندارد ایجاد شد."),
                    (error) => toast.error(getErrorMessage(error)),
                  );
                }}
                className="rounded-xl"
              >
                <Plus className="size-4" />
                ایجاد کدینگ استاندارد
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Search className="size-5" />}
            title="حسابی پیدا نشد"
            description="عبارت جستجو یا فیلتر نوع/سطح را تغییر دهید."
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="ps-4 text-[9px] text-ink-soft">
                      کد / نام
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      سطح
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      نوع
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      ماهیت
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      تفصیلی
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      وضعیت
                    </TableHead>
                    <TableHead className="pe-4 text-end text-[9px] text-ink-soft">
                      عملیات
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((account) => {
                    const depth = depthOf(account);
                    const highlighted = account._id === highlightId;
                    return (
                      <TableRow
                        key={account._id}
                        className={cn(
                          highlighted && "bg-gold-soft/40 dark:bg-gold-soft/10",
                          !account.active && "opacity-60",
                        )}
                      >
                        <TableCell className="ps-4">
                          <div
                            className="flex items-center gap-1.5"
                            style={{ paddingInlineStart: `${Math.min(depth, 5) * 12}px` }}
                          >
                            {depth > 0 ? (
                              <ChevronLeft className="size-3 text-ink-soft/50" />
                            ) : (
                              <ChevronDown className="size-3 text-ink-soft/50" />
                            )}
                            <span className="num w-14 font-mono text-[9px] font-semibold text-ink-soft">
                              {account.code}
                            </span>
                            <span className="text-[10px] font-semibold text-ink">
                              {account.name}
                            </span>
                            {account.systemKey ? (
                              <ShieldCheck
                                className="size-3 text-gold"
                                aria-label="حساب سیستمی"
                              />
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[8px] font-semibold",
                              LEVEL_TONES[account.level],
                            )}
                          >
                            {ACCOUNT_LEVEL_LABELS[account.level]}
                          </span>
                        </TableCell>
                        <TableCell className="text-[9px] text-ink-soft">
                          {ACCOUNT_TYPE_LABELS[account.type]}
                        </TableCell>
                        <TableCell className="text-[9px] text-ink-soft">
                          {ACCOUNT_NATURE_LABELS[account.nature]}
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-[9px] text-ink-soft">
                          {account.detailKind === "none"
                            ? "—"
                            : `${DETAIL_KIND_LABELS[account.detailKind]}${
                                account.linkedEntityName
                                  ? ` · ${account.linkedEntityName}`
                                  : ""
                              }`}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px]",
                              account.active
                                ? "bg-brand-soft text-brand"
                                : "bg-muted text-ink-soft",
                            )}
                          >
                            {account.active ? (
                              <CheckCircle2 className="size-2.5" />
                            ) : (
                              <Ban className="size-2.5" />
                            )}
                            {account.active ? "فعال" : "غیرفعال"}
                          </span>
                        </TableCell>
                        <TableCell className="pe-4 text-end">
                          {canWrite ? (
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing(account);
                                  setDialogOpen(true);
                                }}
                                className="rounded-lg p-1.5 text-ink-soft hover:bg-cream/60 hover:text-ink dark:hover:bg-white/[0.06]"
                                aria-label={`ویرایش ${account.name}`}
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleActive(account)}
                                className={cn(
                                  "rounded-lg p-1.5 hover:bg-cream/60 dark:hover:bg-white/[0.06]",
                                  account.active
                                    ? "text-destructive/80 hover:text-destructive"
                                    : "text-brand",
                                )}
                                aria-label={
                                  account.active
                                    ? `غیرفعال‌کردن ${account.name}`
                                    : `فعال‌کردن ${account.name}`
                                }
                              >
                                {account.active ? (
                                  <Ban className="size-3.5" />
                                ) : (
                                  <CheckCircle2 className="size-3.5" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-[8px] text-ink-soft">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-hairline/40 lg:hidden">
              {rows.map((account) => {
                const highlighted = account._id === highlightId;
                return (
                  <li
                    key={account._id}
                    className={cn(
                      "p-3.5",
                      highlighted && "bg-gold-soft/30 dark:bg-gold-soft/10",
                      !account.active && "opacity-60",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5">
                          <span className="num font-mono text-[9px] text-ink-soft">
                            {account.code}
                          </span>
                          <span className="text-[11px] font-semibold text-ink">
                            {account.name}
                          </span>
                          {account.systemKey ? (
                            <ShieldCheck className="size-3 text-gold" />
                          ) : null}
                        </p>
                        <p className="mt-1 text-[8px] text-ink-soft">
                          {ACCOUNT_LEVEL_LABELS[account.level]} ·{" "}
                          {ACCOUNT_TYPE_LABELS[account.type]} ·{" "}
                          {ACCOUNT_NATURE_LABELS[account.nature]}
                        </p>
                      </div>
                      {canWrite ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(account);
                            setDialogOpen(true);
                          }}
                          className="rounded-lg p-1.5 text-ink-soft hover:bg-cream/60"
                          aria-label={`ویرایش ${account.name}`}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/50 px-4 py-2 text-[8px] text-ink-soft">
          <span>
            {rows.length.toLocaleString("fa-IR")} حساب در نمای فعلی
          </span>
          <span className="flex items-center gap-1">
            <Info className="size-3" />
            حساب‌های استفاده‌شده در اسناد حذف نمی‌شوند؛ فقط غیرفعال می‌شوند.
          </span>
        </div>
      </Panel>

      {businessId ? (
        <AccountDialog
          key={editing?._id ?? "new"}
          open={dialogOpen}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
          businessId={businessId}
          accounts={accounts ?? []}
          editing={editing}
        />
      ) : null}
    </div>
  );
}
