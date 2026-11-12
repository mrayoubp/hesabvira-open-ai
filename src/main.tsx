import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { ThemeProvider } from "next-themes";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { RequireAuth } from "./components/RequireAuth";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const SignupPage = lazy(() => import("./pages/SignupPage.tsx"));
const LegalPage = lazy(() => import("./pages/LegalPage.tsx"));
const SubscriptionPage = lazy(() => import("./pages/SubscriptionPage.tsx"));
const AdminSubscriptionsPage = lazy(
  () => import("./pages/admin/AdminSubscriptionsPage.tsx"),
);
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Invoices = lazy(() => import("./pages/Invoices.tsx"));
const NewInvoice = lazy(() => import("./pages/NewInvoice.tsx"));
const Customers = lazy(() => import("./pages/Customers.tsx"));
const Payments = lazy(() => import("./pages/Payments.tsx"));
const NewPayment = lazy(() => import("./pages/NewPayment.tsx"));
const Transactions = lazy(() => import("./pages/Transactions.tsx"));
const Notifications = lazy(() => import("./pages/Notifications.tsx"));
const AccountingOverview = lazy(
  () => import("./pages/accounting/AccountingOverview.tsx"),
);
const ChartOfAccounts = lazy(
  () => import("./pages/accounting/ChartOfAccounts.tsx"),
);
const AccountingDocuments = lazy(
  () => import("./pages/accounting/Documents.tsx"),
);
const AccountingDocumentEditor = lazy(
  () => import("./pages/accounting/DocumentEditor.tsx"),
);
const AccountingJournal = lazy(
  () => import("./pages/accounting/Journal.tsx"),
);
const AccountingLedger = lazy(
  () => import("./pages/accounting/LedgerReport.tsx"),
);
const AccountingTrialBalance = lazy(
  () => import("./pages/accounting/TrialBalance.tsx"),
);
const FinanceOverview = lazy(
  () => import("./pages/finance/FinanceOverview.tsx"),
);
const TreasuryAccounts = lazy(
  () => import("./pages/finance/TreasuryAccounts.tsx"),
);
const FinanceReceipts = lazy(
  () => import("./pages/finance/Receipts.tsx"),
);
const FinancePaymentVouchers = lazy(
  () => import("./pages/finance/PaymentVouchers.tsx"),
);
const FinanceTransfers = lazy(
  () => import("./pages/finance/Transfers.tsx"),
);
const FinanceChecks = lazy(() => import("./pages/finance/Checks.tsx"));
const FinanceIncomeExpenses = lazy(
  () => import("./pages/finance/IncomeExpenses.tsx"),
);
const FinanceReceivables = lazy(
  () => import("./pages/finance/Receivables.tsx"),
);
const FinanceReports = lazy(
  () => import("./pages/finance/FinanceReports.tsx"),
);
const CommerceSales = lazy(
  () => import("./pages/commerce/SalesPage.tsx"),
);
const CommercePurchases = lazy(
  () => import("./pages/commerce/PurchasesPage.tsx"),
);
const CommerceCustomers = lazy(
  () => import("./pages/commerce/CustomersPage.tsx"),
);
const CommerceSuppliers = lazy(
  () => import("./pages/commerce/SuppliersPage.tsx"),
);
const CommerceProducts = lazy(
  () => import("./pages/commerce/ProductsPage.tsx"),
);
const CommerceInventory = lazy(
  () => import("./pages/commerce/InventoryPage.tsx"),
);
const CommerceReports = lazy(
  () => import("./pages/commerce/CommerceReportsPage.tsx"),
);
const HrEmployees = lazy(() => import("./pages/hr/EmployeesPage.tsx"));
const HrOrganization = lazy(() => import("./pages/hr/OrganizationPage.tsx"));
const HrAttendance = lazy(() => import("./pages/hr/AttendancePage.tsx"));
const HrPayroll = lazy(() => import("./pages/hr/PayrollPage.tsx"));
const HrTax = lazy(() => import("./pages/hr/TaxPage.tsx"));
const HrAssets = lazy(() => import("./pages/hr/AssetsPage.tsx"));
const HrReports = lazy(() => import("./pages/hr/OrgReportsPage.tsx"));
const ReportsCenter = lazy(
  () => import("./pages/reports/ReportsCenterPage.tsx"),
);
const ReportRun = lazy(() => import("./pages/reports/ReportRunPage.tsx"));
const CustomReport = lazy(
  () => import("./pages/reports/CustomReportPage.tsx"),
);
const ViraAi = lazy(() => import("./pages/reports/ViraAiPage.tsx"));
const SystemStatus = lazy(() => import("./pages/system/SystemPage.tsx"));
const ComingSoon = lazy(() => import("./pages/ComingSoon.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const WorkspaceLayout = lazy(() =>
  import("./components/app/WorkspaceLayout").then((module) => ({
    default: module.WorkspaceLayout,
  })),
);

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-deep text-lg font-black text-cream shadow-lg">
        و
      </span>
      <p className="text-[11px] font-semibold text-ink-soft">
        در حال آماده‌سازی فضای کاری
        <span className="animate-pulse">…</span>
      </p>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorId: string }
> {
  state = { hasError: false, errorId: "" };
  static getDerivedStateFromError() {
    return {
      hasError: true,
      errorId: `ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    };
  }
  componentDidCatch(err: Error) {
    // Never render stacks or raw server messages in the production UI; they can
    // contain tenant data or implementation details.
    console.error("[HesabVira] UI crash", this.state.errorId, err.message);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-md text-center">
            <p className="text-sm font-semibold">برنامه با خطای غیرمنتظره متوقف شد</p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              صفحه را دوباره باز کنید. اگر خطا تکرار شد، شناسه زیر را به مدیر
              سامانه اعلام کنید.
            </p>
            <p className="num mt-4 rounded-lg border border-border/60 bg-muted/30 p-2 font-mono text-[10px]">
              {this.state.errorId}
            </p>
            <button
              type="button"
              className="mt-4 cursor-pointer rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              بارگذاری دوباره
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
        <ConvexAuthProvider client={convex}>
          <BrowserRouter>
            <RouteSyncer />
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route
                  path="/legal"
                  element={<Navigate to="/legal/terms" replace />}
                />
                <Route path="/legal/:slug" element={<LegalPage />} />
                <Route
                  path="/auth"
                  element={<AuthPage redirectAfterAuth="/dashboard" />}
                />
                <Route
                  path="/admin"
                  element={<Navigate to="/admin/subscriptions" replace />}
                />
                <Route
                  path="/admin/subscriptions"
                  element={
                    <RequireAuth redirectImmediately>
                      <AdminSubscriptionsPage />
                    </RequireAuth>
                  }
                />
                <Route path="/dashboard" element={<WorkspaceLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="invoices" element={<Invoices />} />
                  <Route path="invoices/new" element={<NewInvoice />} />
                  <Route path="customers" element={<Customers />} />
                  <Route path="payments" element={<Payments />} />
                  <Route path="payments/new" element={<NewPayment />} />
                  <Route path="transactions" element={<Transactions />} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="accounting" element={<AccountingOverview />} />
                  <Route
                    path="accounting/accounts"
                    element={<ChartOfAccounts />}
                  />
                  <Route
                    path="accounting/documents"
                    element={<AccountingDocuments />}
                  />
                  <Route
                    path="accounting/documents/new"
                    element={<AccountingDocumentEditor />}
                  />
                  <Route
                    path="accounting/documents/:documentId"
                    element={<AccountingDocumentEditor />}
                  />
                  <Route
                    path="accounting/journal"
                    element={<AccountingJournal />}
                  />
                  <Route
                    path="accounting/ledger"
                    element={<AccountingLedger mode="ledger" />}
                  />
                  <Route
                    path="accounting/subsidiary"
                    element={<AccountingLedger mode="subsidiary" />}
                  />
                  <Route
                    path="accounting/trial-balance"
                    element={<AccountingTrialBalance />}
                  />
                  <Route path="finance" element={<FinanceOverview />} />
                  <Route
                    path="finance/accounts"
                    element={<TreasuryAccounts />}
                  />
                  <Route
                    path="finance/receipts"
                    element={<FinanceReceipts />}
                  />
                  <Route
                    path="finance/payments"
                    element={<FinancePaymentVouchers />}
                  />
                  <Route
                    path="finance/transfers"
                    element={<FinanceTransfers />}
                  />
                  <Route path="finance/checks" element={<FinanceChecks />} />
                  <Route
                    path="finance/income-expenses"
                    element={<FinanceIncomeExpenses />}
                  />
                  <Route
                    path="finance/receivables"
                    element={<FinanceReceivables />}
                  />
                  <Route
                    path="finance/reports"
                    element={<FinanceReports />}
                  />
                  <Route
                    path="commerce/sales"
                    element={<CommerceSales />}
                  />
                  <Route
                    path="commerce/purchases"
                    element={<CommercePurchases />}
                  />
                  <Route
                    path="commerce/customers"
                    element={<CommerceCustomers />}
                  />
                  <Route
                    path="commerce/suppliers"
                    element={<CommerceSuppliers />}
                  />
                  <Route
                    path="commerce/products"
                    element={<CommerceProducts />}
                  />
                  <Route
                    path="commerce/inventory"
                    element={<CommerceInventory />}
                  />
                  <Route
                    path="commerce/reports"
                    element={<CommerceReports />}
                  />
                  <Route path="hr/employees" element={<HrEmployees />} />
                  <Route path="hr/organization" element={<HrOrganization />} />
                  <Route path="hr/attendance" element={<HrAttendance />} />
                  <Route path="hr/payroll" element={<HrPayroll />} />
                  <Route path="hr/tax" element={<HrTax />} />
                  <Route path="hr/assets" element={<HrAssets />} />
                  <Route path="hr/reports" element={<HrReports />} />
                  <Route path="reports" element={<ReportsCenter />} />
                  <Route
                    path="reports/custom"
                    element={<CustomReport />}
                  />
                  <Route path="reports/:reportKey" element={<ReportRun />} />
                  <Route path="ai" element={<ViraAi />} />
                  <Route path="subscription" element={<SubscriptionPage />} />
                  <Route path="system" element={<SystemStatus />} />
                  <Route path="soon/:slug" element={<ComingSoon />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
          <Toaster />
        </ConvexAuthProvider>
      </ThemeProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
