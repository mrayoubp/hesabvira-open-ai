import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { MemberRole } from "@/convex/schema";
import { getErrorMessage } from "@/lib/errors";
import { useMutation, useQuery } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface BusinessSummary {
  _id: Id<"businesses">;
  name: string;
  slug: string;
  currency: string;
  currencyDecimals: number;
  taxRateBps: number;
}

export interface WorkspaceMembershipSummary {
  business: BusinessSummary;
  role: MemberRole;
}

export interface BranchSummary {
  _id: Id<"branches">;
  businessId: Id<"businesses">;
  name: string;
  code: string;
  isPrimary: boolean;
}

export interface FiscalYearSummary {
  _id: Id<"fiscalYears">;
  businessId: Id<"businesses">;
  name: string;
  startAt: number;
  endAt: number;
  status: "open" | "closed";
}

interface SelectionState {
  businessId?: string;
  branches: Record<string, string>;
  fiscalYears: Record<string, string>;
}

export interface SubscriptionAccessSummary {
  required: boolean;
  status:
    | "legacy"
    | "active"
    | "pending_payment"
    | "expired"
    | "cancelled"
    | "grace";
  canRead: boolean;
  canWrite: boolean;
  canRenew: boolean;
  message: string;
  graceDays: number;
  daysRemaining: number | null;
  graceEndsAt: number | null;
  testMode: boolean;
  plan: {
    _id: string;
    code: string;
    name: string;
    durationMonths: number;
    priceToman: number;
    features: string[];
  } | null;
  subscription: {
    _id: string;
    status:
      | "active"
      | "pending_payment"
      | "expired"
      | "cancelled"
      | "grace";
    paymentStatus: "unpaid" | "paid" | "failed" | "refunded";
    startAt: number | null;
    endAt: number | null;
    renewalAt: number | null;
  } | null;
  limits: {
    maxUsers: number;
    maxBranches: number;
    maxWarehouses: number;
    maxStorageMb: number;
    allowedModules: string[];
    advancedFeatures: string[];
  } | null;
}

interface WorkspaceContextValue {
  workspace: WorkspaceMembershipSummary | null;
  workspaces: WorkspaceMembershipSummary[];
  user: {
    _id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    isAnonymous: boolean;
  } | null;
  branches: BranchSummary[];
  fiscalYears: FiscalYearSummary[];
  activeBranch: BranchSummary | null;
  activeFiscalYear: FiscalYearSummary | null;
  branchId?: Id<"branches">;
  fiscalYearId?: Id<"fiscalYears">;
  setBranchId: (branchId: Id<"branches">) => void;
  setFiscalYearId: (fiscalYearId: Id<"fiscalYears">) => void;
  setBusinessId: (businessId: Id<"businesses">) => void;
  businessId?: Id<"businesses">;
  role?: MemberRole;
  currency: string;
  taxRateBps: number;
  subscription: SubscriptionAccessSummary | null;
  canWrite: boolean;
  canManage: boolean;
  isLoading: boolean;
  isProvisioning: boolean;
  error: string | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const STORAGE_KEY = "hv.workspace.selection";

function readStoredSelection(): SelectionState {
  if (typeof window === "undefined") {
    return { branches: {}, fiscalYears: {} };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { branches: {}, fiscalYears: {} };
    const parsed = JSON.parse(raw) as Partial<SelectionState>;
    return {
      businessId:
        typeof parsed.businessId === "string" ? parsed.businessId : undefined,
      branches:
        parsed.branches && typeof parsed.branches === "object"
          ? parsed.branches
          : {},
      fiscalYears:
        parsed.fiscalYears && typeof parsed.fiscalYears === "object"
          ? parsed.fiscalYears
          : {},
    };
  } catch {
    return { branches: {}, fiscalYears: {} };
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const context = useQuery(api.businesses.context);
  const ensure = useMutation(api.businesses.ensure);
  const [selection, setSelection] = useState<SelectionState>(
    readStoredSelection,
  );
  const activeBusinessId =
    context?.workspaces.find(
      (item) => item.business._id === selection.businessId,
    )?.business._id ?? context?.workspaces[0]?.business._id;
  const subscriptionQuery = useQuery(
    api.subscription.access,
    activeBusinessId ? { businessId: activeBusinessId } : "skip",
  );
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const ensuredOnce = useRef(false);

  useEffect(() => {
    if (!context) return;
    // Phase 11: never auto-create a tenant after sign-in. A new account must
    // finish onboarding + choose a plan; this closes the old free-workspace
    // bypass while still backfilling defaults for existing memberships.
    if (context.workspaces.length === 0) return;
    if (!ensuredOnce.current) {
      ensuredOnce.current = true;
      setIsProvisioning(true);
      void ensure({})
        .catch((reason) => setError(getErrorMessage(reason)))
        .finally(() => setIsProvisioning(false));
    }
  }, [context, ensure]);

  const persist = useCallback((next: SelectionState) => {
    setSelection(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  }, []);

  const value = useMemo<WorkspaceContextValue>(() => {
    const workspaces = (context?.workspaces ??
      []) as WorkspaceMembershipSummary[];
    const activeWorkspace =
      workspaces.find((item) => item.business._id === selection.businessId) ??
      workspaces[0] ??
      null;

    const businessId = activeWorkspace?.business._id;
    const branches = ((context?.branches ?? []) as BranchSummary[]).filter(
      (branch) => branch.businessId === businessId,
    );
    const fiscalYears = (
      (context?.fiscalYears ?? []) as FiscalYearSummary[]
    )
      .filter((year) => year.businessId === businessId)
      .sort((a, b) => b.startAt - a.startAt);

    const storedBranchId = businessId
      ? selection.branches[businessId]
      : undefined;
    const activeBranch =
      branches.find((branch) => branch._id === storedBranchId) ??
      branches.find((branch) => branch.isPrimary) ??
      branches[0] ??
      null;

    const storedFiscalYearId = businessId
      ? selection.fiscalYears[businessId]
      : undefined;
    const activeFiscalYear =
      fiscalYears.find((year) => year._id === storedFiscalYearId) ??
      fiscalYears.find(
        (year) =>
          year.status === "open" &&
          year.startAt <= now &&
          year.endAt >= now,
      ) ??
      fiscalYears.find((year) => year.status === "open") ??
      fiscalYears[0] ??
      null;

    const role = activeWorkspace?.role;
    const subscription =
      (subscriptionQuery as SubscriptionAccessSummary | undefined) ?? null;
    const canWrite =
      (role === "owner" || role === "admin" || role === "accountant") &&
      Boolean(subscription?.canWrite);
    const canManage = role === "owner" || role === "admin";

    return {
      workspace: activeWorkspace,
      workspaces,
      user: context?.user ?? null,
      branches,
      fiscalYears,
      activeBranch,
      activeFiscalYear,
      branchId: activeBranch?._id,
      fiscalYearId: activeFiscalYear?._id,
      setBranchId: (nextBranchId) => {
        if (!businessId) return;
        persist({
          ...selection,
          branches: {
            ...selection.branches,
            [businessId]: nextBranchId,
          },
        });
      },
      setFiscalYearId: (nextFiscalYearId) => {
        if (!businessId) return;
        persist({
          ...selection,
          fiscalYears: {
            ...selection.fiscalYears,
            [businessId]: nextFiscalYearId,
          },
        });
      },
      setBusinessId: (nextBusinessId) => {
        persist({ ...selection, businessId: nextBusinessId });
      },
      businessId,
      role,
      currency: activeWorkspace?.business.currency ?? "IRT",
      taxRateBps: activeWorkspace?.business.taxRateBps ?? 900,
      subscription,
      canWrite,
      canManage,
      isLoading:
        context === undefined ||
        (Boolean(businessId) && subscriptionQuery === undefined),
      isProvisioning,
      error,
    };
  }, [
    context,
    selection,
    subscriptionQuery,
    isProvisioning,
    error,
    persist,
    now,
  ]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return value;
}
