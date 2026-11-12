import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";

/**
 * Captures uncaught browser errors and forwards a safe summary to the tenant
 * error registry. Stacks and request payloads are never sent.
 */
export function TelemetryBridge({ businessId }: { businessId?: Id<"businesses"> }) {
  const report = useMutation(api.system.reportClientError);
  const count = useRef(0);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!businessId) return;

    const send = (message: string, digest?: string) => {
      if (count.current >= 10) return;
      const safe = (message || "خطای بدون پیام").slice(0, 300);
      const key = digest ? `${safe}:${digest}` : safe;
      if (seen.current.has(key)) return;
      seen.current.add(key);
      count.current += 1;
      const errorId = `ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      void report({
        businessId,
        message: safe,
        route: `${window.location.pathname}${window.location.search}`.slice(0, 240),
        digest,
        errorId,
      }).catch(() => undefined);
    };

    const onError = (event: ErrorEvent) => {
      send(event.message || event.error?.message || "خطای مرورگر");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      send(
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Promise rejection بدون پیام",
      );
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [businessId, report]);

  return null;
}
