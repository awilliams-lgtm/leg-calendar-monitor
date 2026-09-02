import { SaConnect } from "@/components/SaConnect";
import { AdminGate } from "@/components/AdminGate";

export default function LoginPage() {
  return (
    <AdminGate>
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-3xl">Connect State Affairs</h1>
          <p className="mt-1 text-sm text-muted">
            Admin only. This shared work login fills the SA side of the calendars for the whole team.
            Coworkers do not need this page.
          </p>
        </div>
        <SaConnect />
      </div>
    </AdminGate>
  );
}
