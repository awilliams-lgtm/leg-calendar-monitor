export type EventSource = "official" | "sa";

export type CalendarEvent = {
  sourceId: string;
  state: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  chamber?: string;
  url?: string;
  bills: string[];
  description?: string;
  raw?: unknown;
};

export type StoredEvent = CalendarEvent & {
  id: number;
  source: EventSource;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type GapRow = {
  id: number;
  state: string;
  officialSourceId: string;
  title: string;
  start: string;
  location: string;
  chamber: string;
  url: string;
  bills: string[];
  description?: string;
  status: "open" | "dismissed" | "matched" | "irrelevant";
  score: number;
  createdAt: string;
  saMatchTitle: string;
};

export type NotificationRow = {
  id: number;
  kind: "new_official" | "missing_on_sa";
  state: string;
  title: string;
  start: string;
  url: string;
  createdAt: string;
  readAt: string;
  emailedAt: string;
};

export type StateCoverage = {
  code: string;
  name: string;
  officialUrl: string;
  officialCount: number;
  saCount: number;
  openGaps: number;
  lastOfficialSync: string;
  lastSaSync: string;
  lastError: string;
};

export type CalendarItem = {
  sourceId: string;
  state: string;
  title: string;
  start: string;
  location: string;
  chamber: string;
  url: string;
  bills: string[];
  description?: string;
  onSa: boolean;
  handled?: boolean;
  irrelevant?: boolean;
  saMatchTitle: string;
};

export type DayCounts = {
  onSa: number;
  missing: number;
  saMeetings: number;
};

export type StateMonthSummary = {
  code: string;
  name: string;
  officialUrl: string;
  days: Record<string, DayCounts>;
  onSa: number;
  missing: number;
  notRelevant: number;
  saMeetings: number;
};

export type SyncResult = {
  state: string;
  officialUpserted: number;
  saUpserted: number;
  newOfficial: number;
  newGaps: number;
  notes?: string[];
  error?: string;
};
