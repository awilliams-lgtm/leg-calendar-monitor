-- Schema of record for the legislative calendar monitor: schema `legcal` in the sa-internal-tools Supabase
-- project. Generated from the live database on 2026-09-13, which until then was the only place it existed.
-- Idempotent; safe to run against the live project.

create schema if not exists legcal;

create table if not exists legcal.calendar_events (
  id bigint not null default nextval('legcal.calendar_events_id_seq'::regclass),
  source text not null,
  source_id text not null,
  state text not null,
  title text not null default ''::text,
  start_at text not null default ''::text,
  end_at text not null default ''::text,
  all_day boolean not null default false,
  location text not null default ''::text,
  chamber text not null default ''::text,
  url text not null default ''::text,
  bills text not null default '[]'::text,
  description text not null default ''::text,
  raw text not null default '{}'::text,
  first_seen_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now(),
  primary key (id)
);
create unique index if not exists calendar_events_source_state_source_id_key ON legcal.calendar_events USING btree (source, state, source_id);
create index if not exists idx_cal_events_start ON legcal.calendar_events USING btree (start_at);
create index if not exists idx_cal_events_state_source ON legcal.calendar_events USING btree (state, source, start_at);
alter table legcal.calendar_events enable row level security;
comment on table legcal.calendar_events is 'Legislative calendar events scraped from each state''s official legislature site (hearings, floor sessions, committee meetings). One row per (source, source_id); re-seen events refresh last_seen_at.';
comment on column legcal.calendar_events.id is 'Surrogate key.';
comment on column legcal.calendar_events.source is 'Which feed produced the row: the state''s official legislature calendar or State Affairs'' own calendar export.';
comment on column legcal.calendar_events.source_id is 'The event''s identifier inside its source; with source, the natural key.';
comment on column legcal.calendar_events.state is 'Two-letter state code.';
comment on column legcal.calendar_events.title is 'Event title as published.';
comment on column legcal.calendar_events.start_at is 'Start date-time as text in the source''s local time (ISO 8601 where the source gives one); not normalised to timestamptz.';
comment on column legcal.calendar_events.end_at is 'End date-time as text, same convention as start_at; empty when the source gives none.';
comment on column legcal.calendar_events.all_day is 'True when the source lists the event without a time of day.';
comment on column legcal.calendar_events.location is 'Room or building as published.';
comment on column legcal.calendar_events.chamber is 'House, Senate, Joint, or empty when not stated.';
comment on column legcal.calendar_events.url is 'Link to the event on the source site.';
comment on column legcal.calendar_events.bills is 'JSON array (stored as text) of bill numbers on the agenda.';
comment on column legcal.calendar_events.description is 'Agenda or notes text as published.';
comment on column legcal.calendar_events.raw is 'The scraper''s raw record as JSON text, for re-parsing without re-scraping.';
comment on column legcal.calendar_events.first_seen_at is 'When the scraper first saw this event.';
comment on column legcal.calendar_events.last_seen_at is 'Most recent sync that still listed the event; an event that stops appearing keeps its last value.';

create table if not exists legcal.calendar_gaps (
  id bigint not null default nextval('legcal.calendar_gaps_id_seq'::regclass),
  state text not null,
  official_source_id text not null,
  title text not null default ''::text,
  start_at text not null default ''::text,
  location text not null default ''::text,
  chamber text not null default ''::text,
  url text not null default ''::text,
  bills text not null default '[]'::text,
  status text not null default 'open'::text,
  best_score real not null default 0,
  sa_match_title text not null default ''::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);
create unique index if not exists calendar_gaps_state_official_source_id_key ON legcal.calendar_gaps USING btree (state, official_source_id);
create index if not exists idx_cal_gaps_status ON legcal.calendar_gaps USING btree (status, state, start_at);
alter table legcal.calendar_gaps enable row level security;
comment on table legcal.calendar_gaps is 'Official events with no matching event in State Affairs'' calendar: the coverage gaps the monitor exists to surface. One row per official event still unmatched.';
comment on column legcal.calendar_gaps.id is 'Surrogate key.';
comment on column legcal.calendar_gaps.state is 'Two-letter state code.';
comment on column legcal.calendar_gaps.official_source_id is 'source_id of the official event in calendar_events that has no match.';
comment on column legcal.calendar_gaps.title is 'Official event title, copied for display.';
comment on column legcal.calendar_gaps.start_at is 'Official event start as text, copied for display.';
comment on column legcal.calendar_gaps.location is 'Official event location, copied.';
comment on column legcal.calendar_gaps.chamber is 'Official event chamber, copied.';
comment on column legcal.calendar_gaps.url is 'Link to the official event.';
comment on column legcal.calendar_gaps.bills is 'JSON array (text) of bill numbers on the official agenda.';
comment on column legcal.calendar_gaps.status is 'open (still unmatched), matched, or dismissed by a person.';
comment on column legcal.calendar_gaps.best_score is 'Best fuzzy-match score (0-1) against State Affairs'' calendar; below the match threshold, hence a gap.';
comment on column legcal.calendar_gaps.sa_match_title is 'Title of the closest State Affairs event, for a human to judge the near-miss.';
comment on column legcal.calendar_gaps.created_at is 'When the gap was first detected.';
comment on column legcal.calendar_gaps.updated_at is 'Last time the gap''s status or score changed.';

create table if not exists legcal.calendar_notifications (
  id bigint not null default nextval('legcal.calendar_notifications_id_seq'::regclass),
  kind text not null,
  state text not null,
  source_id text not null default ''::text,
  title text not null default ''::text,
  start_at text not null default ''::text,
  url text not null default ''::text,
  created_at timestamp with time zone not null default now(),
  read_at timestamp with time zone,
  emailed_at timestamp with time zone,
  primary key (id)
);
create unique index if not exists calendar_notifications_kind_state_source_id_key ON legcal.calendar_notifications USING btree (kind, state, source_id);
create index if not exists idx_cal_notes_created ON legcal.calendar_notifications USING btree (created_at DESC);
alter table legcal.calendar_notifications enable row level security;
comment on table legcal.calendar_notifications is 'Notifications generated from gaps and changes (new gap, event moved, event cancelled), with read and email state.';
comment on column legcal.calendar_notifications.id is 'Surrogate key.';
comment on column legcal.calendar_notifications.kind is 'Notification type, e.g. new_gap, changed, cancelled.';
comment on column legcal.calendar_notifications.state is 'Two-letter state code.';
comment on column legcal.calendar_notifications.source_id is 'source_id of the event the notification is about.';
comment on column legcal.calendar_notifications.title is 'Event title at notification time.';
comment on column legcal.calendar_notifications.start_at is 'Event start (text) at notification time.';
comment on column legcal.calendar_notifications.url is 'Link to the event.';
comment on column legcal.calendar_notifications.created_at is 'When the notification was generated.';
comment on column legcal.calendar_notifications.read_at is 'When a user marked it read; null while unread.';
comment on column legcal.calendar_notifications.emailed_at is 'When it was included in an email; null if never sent.';

create table if not exists legcal.sync_meta (
  key text not null,
  value text not null default ''::text,
  primary key (key)
);
alter table legcal.sync_meta enable row level security;
comment on table legcal.sync_meta is 'Key/value state for the sync loop (cursors, last full-sync markers, feature flags).';
comment on column legcal.sync_meta.key is 'Setting name.';
comment on column legcal.sync_meta.value is 'Setting value as text.';

create table if not exists legcal.sync_runs (
  id bigint not null default nextval('legcal.sync_runs_id_seq'::regclass),
  state text not null,
  source text not null,
  started_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone,
  upserted integer not null default 0,
  error text not null default ''::text,
  primary key (id)
);
create index if not exists idx_sync_runs_state ON legcal.sync_runs USING btree (state, started_at DESC);
alter table legcal.sync_runs enable row level security;
comment on table legcal.sync_runs is 'One row per scrape of one state from one source. The guardrail that keeps last-good events when a scrape returns too few rows records its message in error.';
comment on column legcal.sync_runs.id is 'Surrogate key.';
comment on column legcal.sync_runs.state is 'Two-letter state code scraped.';
comment on column legcal.sync_runs.source is 'Feed scraped: official or State Affairs.';
comment on column legcal.sync_runs.started_at is 'Scrape start.';
comment on column legcal.sync_runs.finished_at is 'Scrape end; null if the process died mid-run.';
comment on column legcal.sync_runs.upserted is 'Events written this run.';
comment on column legcal.sync_runs.error is 'Empty on success. Exception text on failure, or the guardrail note "Kept N last-good official meetings; scrape returned M" when the result was rejected as too small.';

