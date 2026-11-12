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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CustomerSummary } from "@/convex/customers";
import { getErrorMessage } from "@/lib/errors";
import { useMutation } from "convex/react";
import { Loader2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface CustomerFormState {
  name: string;
  phone: string;
  email: string;
  nationalId: string;
  address: string;
  note: string;
}

const emptyForm: CustomerFormState = {
  name: "",
  phone: "",
  email: "",
  nationalId: "",
  address: "",
  note: "",
};

export function CustomerDialog({
  open,
  onOpenChange,
  businessId,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId: Id<"businesses">;
  customer?: CustomerSummary | null;
}) {
  const createCustomer = useMutation(api.customers.create);
  const updateCustomer = useMutation(api.customers.update);
  const [form, setForm] = useState<CustomerFormState>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      customer
        ? {
            name: customer.name,
            phone: customer.phone ?? "",
            email: customer.email ?? "",
            nationalId: customer.nationalId ?? "",
            address: customer.address ?? "",
            note: customer.note ?? "",
          }
        : emptyForm,
    );
  }, [open, customer]);

  const setField = (field: keyof CustomerFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      if (customer) {
        await updateCustomer({
          businessId,
          customerId: customer._id as Id<"customers">,
          name: form.name,
          phone: form.phone,
          email: form.email,
          nationalId: form.nationalId,
          address: form.address,
          note: form.note,
        });
        toast.success("اطلاعات مشتری به‌روزرسانی شد.");
      } else {
        const result = await createCustomer({
          businessId,
          name: form.name,
          phone: form.phone,
          email: form.email,
          nationalId: form.nationalId,
          address: form.address,
          note: form.note,
        });
        toast.success(`مشتری ${result.code} ثبت شد.`);
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="border-b border-hairline/60 pb-4 text-start">
          <span className="text-[8px] font-semibold tracking-[0.15em] text-gold">
            {customer ? `پرونده مشتری · ${customer.code}` : "پرونده جدید مشتری"}
          </span>
          <DialogTitle className="text-lg">
            {customer ? `ویرایش مشتری ${customer.code}` : "ثبت مشتری جدید"}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            نام مشتری الزامی است. اطلاعات تماس برای پیگیری فاکتورها و مطالبات
            استفاده می‌شود.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2 pb-1">
            <span className="flex size-7 items-center justify-center rounded-[9px] bg-brand-soft text-brand">
              <UserRound className="size-3.5" />
            </span>
            <p className="text-[10px] font-bold text-ink">اطلاعات هویتی</p>
            <span className="h-px flex-1 bg-hairline/60" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer-name" className="text-xs">
              نام مشتری <span className="text-destructive">*</span>
            </Label>
            <Input
              id="customer-name"
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
              placeholder="مثلاً فروشگاه نمونه"
              maxLength={160}
              required
              className="h-10"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="customer-phone" className="text-xs">
                شماره تماس
              </Label>
              <Input
                id="customer-phone"
                value={form.phone}
                onChange={(event) => setField("phone", event.target.value)}
                placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                inputMode="tel"
                dir="ltr"
                className="num h-10 text-start"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer-email" className="text-xs">
                ایمیل
              </Label>
              <Input
                id="customer-email"
                value={form.email}
                onChange={(event) => setField("email", event.target.value)}
                placeholder="name@shop.ir"
                type="email"
                dir="ltr"
                className="num h-10 text-start"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customer-national-id" className="text-xs">
              کد ملی / شناسه
            </Label>
            <Input
              id="customer-national-id"
              value={form.nationalId}
              onChange={(event) => setField("nationalId", event.target.value)}
              placeholder="اختیاری"
              dir="ltr"
              className="num h-10 text-start"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customer-address" className="text-xs">
              نشانی
            </Label>
            <Textarea
              id="customer-address"
              value={form.address}
              onChange={(event) => setField("address", event.target.value)}
              placeholder="نشانی فروشگاه یا مشتری"
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customer-note" className="text-xs">
              یادداشت
            </Label>
            <Textarea
              id="customer-note"
              value={form.note}
              onChange={(event) => setField("note", event.target.value)}
              placeholder="توضیح کوتاه، شرایط تسویه و…"
              rows={2}
              className="resize-none"
            />
          </div>

          <DialogFooter className="gap-2 pt-4 sm:justify-start">
            <Button
              type="submit"
              disabled={isSaving}
              className="gap-1.5"
            >
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              {customer ? "ذخیره تغییرات" : "ثبت مشتری"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              انصراف
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
