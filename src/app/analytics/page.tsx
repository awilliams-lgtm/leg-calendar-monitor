import { Suspense } from "react";
import { AnalyticsClient } from "@/components/AnalyticsClient";

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading analytics…</p>}>
      <AnalyticsClient />
    </Suspense>
  );
}
