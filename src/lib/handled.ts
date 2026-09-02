import { loadDismissedGapKeys } from "@/lib/cached-gaps";
import { databaseUrl } from "@/lib/db";

export async function loadHandledOfficialKeys(): Promise<Set<string>> {
  const keys = await loadDismissedGapKeys();
  if (!databaseUrl()) return keys;
  try {
    const { dismissedOfficialKeysFromDb } = await import("@/lib/data");
    for (const key of await dismissedOfficialKeysFromDb()) keys.add(key);
  } catch {
    /* file cache is enough */
  }
  return keys;
}
