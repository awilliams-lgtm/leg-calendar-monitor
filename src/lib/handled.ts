import { officialHandledKey } from "@/lib/calendar";
import { loadDismissedConfirmations, loadIrrelevantConfirmations } from "@/lib/cached-gaps";
import { databaseUrl } from "@/lib/db";
import { expandReviewKeys, type ReviewConfirmation } from "@/lib/review";

export type ReviewKeySets = {
  handled: Set<string>;
  irrelevant: Set<string>;
  confirmations: ReviewConfirmation[];
};

let memo: ReviewKeySets | null = null;

export async function loadReviewOfficialKeys(): Promise<ReviewKeySets> {
  if (memo) return memo;
  const [dismissedFile, irrelevantFile] = await Promise.all([
    loadDismissedConfirmations(),
    loadIrrelevantConfirmations(),
  ]);
  let dbItems: ReviewConfirmation[] = [];
  if (databaseUrl()) {
    try {
      const { reviewConfirmationsFromDb } = await import("@/lib/data");
      dbItems = await reviewConfirmationsFromDb();
    } catch {
      /* file cache is enough */
    }
  }
  const confirmations = [...dismissedFile, ...irrelevantFile, ...dbItems];
  const handled = new Set<string>();
  const irrelevant = new Set<string>();
  for (const row of confirmations) {
    const key = officialHandledKey(row.state, row.officialSourceId);
    if (row.status === "irrelevant") irrelevant.add(key);
    else handled.add(key);
  }
  memo = { handled, irrelevant, confirmations };
  return memo;
}

export async function loadHandledOfficialKeys(): Promise<Set<string>> {
  return (await loadReviewOfficialKeys()).handled;
}

export async function loadIrrelevantOfficialKeys(): Promise<Set<string>> {
  return (await loadReviewOfficialKeys()).irrelevant;
}

export function expandReviewKeysFor(
  review: ReviewKeySets,
  official: Array<{ state: string; sourceId: string; title: string; start: string; chamber?: string }>,
): { handled: Set<string>; irrelevant: Set<string> } {
  const dismissed = review.confirmations.filter((row) => row.status === "dismissed");
  const irrelevantRows = review.confirmations.filter((row) => row.status === "irrelevant");
  return {
    handled: dismissed.length ? expandReviewKeys(dismissed, official) : review.handled,
    irrelevant: irrelevantRows.length ? expandReviewKeys(irrelevantRows, official) : review.irrelevant,
  };
}
