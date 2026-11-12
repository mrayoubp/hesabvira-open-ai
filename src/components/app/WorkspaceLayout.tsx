import { AppShell } from "@/components/app/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { WorkspaceProvider } from "@/components/app/WorkspaceProvider";

/** Protected shell for every workspace route. */
export function WorkspaceLayout() {
  return (
    <RequireAuth redirectImmediately>
      <WorkspaceProvider>
        <AppShell />
      </WorkspaceProvider>
    </RequireAuth>
  );
}
