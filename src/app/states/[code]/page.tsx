import { StateCalendar } from "@/components/StateCalendar";
import { monthKey } from "@/lib/dates";
import { stateByCode } from "@/lib/states";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const src = stateByCode(code);
  return { title: src ? `${src.name} calendar` : "Calendar" };
}

export default async function StatePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { code } = await params;
  const { month } = await searchParams;
  const src = stateByCode(code);
  if (!src) notFound();
  return <StateCalendar code={src.code} initialMonth={month && /^\d{4}-\d{2}$/.test(month) ? month : monthKey()} />;
}
