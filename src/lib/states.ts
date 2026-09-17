export type CalendarKind = "openstates" | "ics" | "manual";

export type ChamberId = "house" | "senate" | "joint" | "unicameral";

export type ChamberFeed = {
  chamber: ChamberId;
  label: string;
  url: string;
};

export type StateSource = {
  code: string;
  name: string;
  openstates: string;
  officialUrl: string;
  feeds: ChamberFeed[];
  icsUrl?: string;
  kind: CalendarKind;
  tz: string;
};

function src(
  code: string,
  name: string,
  tz: string,
  officialUrl: string,
  feeds: ChamberFeed[],
  extra?: Partial<StateSource>,
): StateSource {
  return {
    code,
    name,
    openstates: name,
    officialUrl,
    feeds,
    kind: "openstates",
    tz,
    ...extra,
  };
}

const H = (url: string, label = "House"): ChamberFeed => ({ chamber: "house", label, url });
const S = (url: string, label = "Senate"): ChamberFeed => ({ chamber: "senate", label, url });
const J = (url: string, label = "Joint"): ChamberFeed => ({ chamber: "joint", label, url });
const U = (url: string, label = "Legislature"): ChamberFeed => ({ chamber: "unicameral", label, url });

export const STATE_SOURCES: StateSource[] = [
  src("AL", "Alabama", "America/Chicago", "https://alison.legislature.state.al.us/todays-schedule?tab=0", [
    J("https://alison.legislature.state.al.us/todays-schedule?tab=0", "Meetings"),
    H("https://alison.legislature.state.al.us/todays-schedule?tab=1"),
    S("https://alison.legislature.state.al.us/todays-schedule?tab=2"),
    J("https://alison.legislature.state.al.us/todays-schedule?tab=3", "Announcements"),
  ]),
  src("AK", "Alaska", "America/Anchorage", "https://www.akleg.gov/basis/Meeting/", [
    H("https://www.akleg.gov/basis/Meeting/"),
    S("https://www.akleg.gov/basis/Meeting/"),
  ]),
  src("AZ", "Arizona", "America/Phoenix", "https://www.azleg.gov/standing-committees/", [
    H("https://www.azleg.gov/alis-today/"),
    S("https://www.azleg.gov/standing-committees/"),
    J("https://www.azleg.gov/interim-committee-agendas/", "Interim agendas"),
  ]),
  src("AR", "Arkansas", "America/Chicago", "https://www.arkleg.state.ar.us/Calendars/Meetings", [
    J("https://www.arkleg.state.ar.us/Calendars/Meetings", "Meetings"),
  ]),
  src("CA", "California", "America/Los_Angeles", "https://www.senate.ca.gov/calendar", [
    H("https://www.assembly.ca.gov/dailyfile", "Assembly"),
    S("https://www.senate.ca.gov/calendar"),
  ]),
  src("CO", "Colorado", "America/Denver", "https://leg.colorado.gov/schedule", [
    J("https://leg.colorado.gov/", "Interim Schedule"),
    J("https://leg.colorado.gov/schedule", "Schedule"),
  ]),
  src("CT", "Connecticut", "America/New_York", "https://www.cga.ct.gov/webapps/cgaevents.asp", [
    J("https://www.cga.ct.gov/webapps/cgaevents.asp", "Events"),
  ]),
  src("DE", "Delaware", "America/New_York", "https://legis.delaware.gov/Meetings", [
    J("https://legis.delaware.gov/Meetings", "Committee meetings"),
  ]),
  src("FL", "Florida", "America/New_York", "https://www.flsenate.gov/Session/Calendars/2026", [
    H("https://www.flhouse.gov/Sections/HouseSchedule/houseschedule.aspx"),
    S("https://www.flsenate.gov/Session/Calendars/2026"),
  ]),
  src("GA", "Georgia", "America/New_York", "https://www.legis.ga.gov/schedule/all", [
    J("https://www.legis.ga.gov/schedule/all", "All"),
    H("https://www.legis.ga.gov/schedule/house"),
    S("https://www.legis.ga.gov/schedule/senate"),
  ]),
  src("HI", "Hawaii", "Pacific/Honolulu", "https://data.capitol.hawaii.gov/sessions/session2026/hearingnotices/", [
    J("https://data.capitol.hawaii.gov/sessions/session2026/hearingnotices/", "Hearing notices"),
  ]),
  src("ID", "Idaho", "America/Boise", "https://legislature.idaho.gov/committee-calendar/", [
    H("https://legislature.idaho.gov/house/calendar/"),
    S("https://legislature.idaho.gov/senate/calendar/"),
    J("https://legislature.idaho.gov/committee-calendar/", "Committee calendars"),
  ]),
  src("IL", "Illinois", "America/Chicago", "https://www.ilga.gov/house/schedules/", [
    H("https://www.ilga.gov/house/schedules/"),
    S("https://www.ilga.gov/senate/schedules/"),
  ]),
  src("IN", "Indiana", "America/Indiana/Indianapolis", "https://iga.in.gov/2026/committees/interim", [
    J("https://iga.in.gov/pdf-documents/124/2026/universal/publications/committees/interim/cal_of_meetings.pdf", "Interim calendar PDF"),
    H("https://iga.in.gov/session/2026/house/calendars/32/combined"),
    S("https://iga.in.gov/session/2026/senate/calendars/32/combined"),
  ]),
  src("IA", "Iowa", "America/Chicago", "https://www.legis.iowa.gov/committees/meetings/meetingsListChamber?chamber=S", [
    H("https://www.legis.iowa.gov/committees/meetings/meetingsListChamber?chamber=H"),
    S("https://www.legis.iowa.gov/committees/meetings/meetingsListChamber?chamber=S"),
  ]),
  src("KS", "Kansas", "America/Chicago", "https://kslegislature.gov/", [
    J("https://kslegislature.gov/", "Interim schedule PDF"),
    J("https://kslegislature.gov/b2025_26/hearings/", "Hearings"),
  ]),
  src("KY", "Kentucky", "America/New_York", "https://apps.legislature.ky.gov/LegislativeCalendar", [
    J("https://apps.legislature.ky.gov/LegislativeCalendar", "House & Senate"),
  ]),
  src("LA", "Louisiana", "America/Chicago", "https://legis.la.gov/legis/ByCmte.aspx", [
    J("https://legis.la.gov/legis/ByCmte.aspx", "Committees"),
    H("https://house.louisiana.gov/H_Sched/Hse_MeetingSchedule"),
    S("https://senate.la.gov/Sched/S_Sched"),
  ]),
  src("ME", "Maine", "America/New_York", "https://legislature.maine.gov/house/Documents/WLC", [
    J("https://legislature.maine.gov/house/Documents/WLC", "Weekly legislative calendar"),
  ]),
  src("MD", "Maryland", "America/New_York", "https://mgaleg.maryland.gov/mgawebsite/Meetings/Month", [
    J("https://mgaleg.maryland.gov/mgawebsite/Meetings/Month", "House, Senate & Joint"),
  ]),
  src("MA", "Massachusetts", "America/New_York", "https://malegislature.gov/Events/Hearings", [
    H("https://malegislature.gov/Events/Hearings?Branch=House"),
    S("https://malegislature.gov/Events/Hearings?Branch=Senate"),
    J("https://malegislature.gov/Events/Hearings?Branch=Joint"),
  ]),
  src("MI", "Michigan", "America/Detroit", "https://www.legislature.mi.gov/Committees/Meetings", [
    J("https://www.legislature.mi.gov/Committees/Meetings?sortBy=CalendarTime", "House & Senate"),
    J("https://www.legislature.mi.gov/documents/publications/RssFeeds/comschedule.xml", "Meetings RSS"),
  ]),
  src("MN", "Minnesota", "America/Chicago", "https://www.house.mn.gov/Schedules/All", [
    H("https://www.house.mn.gov/Schedules/All"),
    S("https://www.senate.mn/api/schedule/upcoming"),
  ]),
  src("MS", "Mississippi", "America/Chicago", "https://billstatus.ls.state.ms.us/htms/h_sched.htm", [
    H("https://billstatus.ls.state.ms.us/htms/h_sched.htm"),
    S("https://billstatus.ls.state.ms.us/htms/s_sched.htm"),
  ]),
  src("MO", "Missouri", "America/Chicago", "https://house.mo.gov/HearingsTimeOrder.aspx", [
    H("https://house.mo.gov/HearingsTimeOrder.aspx", "Hearings"),
    S("https://www.senate.mo.gov/hearingsschedule/hrings.htm", "Hearings"),
  ]),
  src("MT", "Montana", "America/Denver", "https://www.legmt.gov/events/", [
    J("https://www.legmt.gov/events/?ical=1", "Events ICS"),
  ]),
  src("NE", "Nebraska", "America/Chicago", "https://nebraskalegislature.gov/calendar/hearings_range.php?weekly=this", [
    U("https://nebraskalegislature.gov/calendar/hearings_range.php?weekly=this"),
  ]),
  src("NV", "Nevada", "America/Los_Angeles", "https://www.leg.state.nv.us/App/Calendar/A/", [
    J("https://www.leg.state.nv.us/App/Calendar/A/", "Events"),
  ]),
  src("NH", "New Hampshire", "America/New_York", "https://gc.nh.gov/house/schedule/dailyschedule.aspx", [
    H("https://gc.nh.gov/house/schedule/dailyschedule.aspx"),
    S("https://gc.nh.gov/senate/schedule/dailyschedule.aspx"),
  ]),
  src("NJ", "New Jersey", "America/New_York", "https://pub.njleg.state.nj.us/publications/legislative-calendar/082826.htm", [
    J("https://pub.njleg.state.nj.us/publications/legislative-calendar/082826.htm", "Legislative Calendar"),
  ]),
  src("NM", "New Mexico", "America/Denver", "https://www.nmlegis.gov/Calendar/Whats_Happening", [
    J("https://www.nmlegis.gov/Calendar/Whats_Happening", "What's Happening"),
    J("https://www.nmlegis.gov/Calendar/Session", "Session calendar"),
  ]),
  src("NY", "New York", "America/New_York", "https://www.nyassembly.gov/leg/?sh=hear", [
    H("https://www.nyassembly.gov/leg/?sh=hear", "Assembly hearings"),
    S("https://www.nysenate.gov/events", "Senate events"),
  ]),
  src("NC", "North Carolina", "America/New_York", "https://www.ncleg.gov/LegislativeCalendar", [
    J("https://www.ncleg.gov/LegislativeCalendar", "House & Senate"),
  ]),
  src("ND", "North Dakota", "America/Chicago", "https://www.ndlegis.gov/calendar", [
    J("https://www.ndlegis.gov/calendar", "Legislative calendar"),
    J("https://www.ndlegis.gov/events", "Events"),
  ]),
  src("OH", "Ohio", "America/New_York", "https://www.legislature.ohio.gov/schedules/session-schedule", [
    J("https://www.legislature.ohio.gov/schedules/session-schedule", "Session schedule"),
  ]),
  src("OK", "Oklahoma", "America/Chicago", "https://oksenate.gov/committee-meetings", [
    H("https://former.okhouse.gov/committees/ShowInterimStudies.aspx", "House interim studies"),
    H("https://www.okhouse.gov/calendars"),
    S("https://oksenate.gov/committee-meetings", "Committee meetings"),
  ]),
  src("OR", "Oregon", "America/Los_Angeles", "https://www.oregonlegislature.gov/", [
    J("https://www.oregonlegislature.gov/", "Floor & Committees"),
  ]),
  src("PA", "Pennsylvania", "America/New_York", "https://www.palegis.us/house/committees/meeting-schedule", [
    H("https://www.palegis.us/house/committees/meeting-schedule"),
    S("https://www.palegis.us/senate/committees/meeting-schedule"),
  ]),
  src("RI", "Rhode Island", "America/New_York", "https://www.rilegislature.gov/Pages/Default.aspx", [
    J("https://www.rilegislature.gov/Pages/Default.aspx", "Legislative calendar"),
    J("https://www.rilegislature.gov/CalendarEvent/CalendarEvent.aspx", "Calendar events"),
    J("https://status.rilegislature.gov/legislative_committee_calendar.aspx", "Committee calendar"),
  ]),
  src("SC", "South Carolina", "America/New_York", "https://www.scstatehouse.gov/meetings.php?chamber=H", [
    H("https://www.scstatehouse.gov/meetings.php?chamber=H"),
    S("https://www.scstatehouse.gov/meetings.php?chamber=S"),
    J("https://www.scstatehouse.gov/meetings.php?chamber=B"),
  ]),
  src("SD", "South Dakota", "America/Chicago", "https://sdlegislature.gov/", [
    J("https://sdlegislature.gov/", "Schedule"),
  ]),
  src("TN", "Tennessee", "America/Chicago", "https://wapp.capitol.tn.gov/apps/schedule/", [
    J("https://wapp.capitol.tn.gov/apps/schedule/", "Schedule"),
  ]),
  src("TX", "Texas", "America/Chicago", "https://capitol.texas.gov/Committees/MeetingsUpcoming.aspx?Chamber=H", [
    H("https://capitol.texas.gov/Committees/MeetingsUpcoming.aspx?Chamber=H"),
    S("https://capitol.texas.gov/Committees/MeetingsUpcoming.aspx?Chamber=S"),
  ]),
  src("US", "U.S. Congress", "America/New_York", "https://docs.house.gov/committee/calendar/byweek.aspx", [
    H("https://docs.house.gov/committee/calendar/byweek.aspx", "House committees"),
    H("https://docs.house.gov/floor/Default.aspx", "House floor"),
    S("https://www.senate.gov/committees/hearings.htm", "Senate committees"),
    S("https://www.senate.gov/legislative/LIS/floor_schedule/week.htm", "Senate floor"),
    S("https://www.senate.gov/legislative/LIS/floor_activity/floor_activity.htm", "Senate floor activity"),
  ]),
  src("UT", "Utah", "America/Denver", "https://le.utah.gov/asp/interim/Cal.asp", [
    J("https://le.utah.gov/asp/interim/Cal.asp", "Interim calendar"),
  ]),
  src("VT", "Vermont", "America/New_York", "https://legislature.vermont.gov/committee/meetings/2026", [
    H("https://legislature.vermont.gov/house/service/2026/calendar", "House calendars"),
    S("https://legislature.vermont.gov/senate/service/2026/calendar", "Senate calendars"),
    J("https://legislature.vermont.gov/committee/list/2026/House-Standing", "Standing committees"),
    J("https://legislature.vermont.gov/committee/meetings/2026#leg-committees", "Other scheduled meetings"),
    J("https://legislature.vermont.gov/committee/weeklyAgendas/2026", "Weekly committee agendas"),
  ]),
  src("VA", "Virginia", "America/New_York", "https://lis.virginia.gov/", [
    J("https://liscdn.blob.core.windows.net/cdn/meetings.ics", "Meetings ICS"),
  ], { icsUrl: "https://liscdn.blob.core.windows.net/cdn/meetings.ics" }),
  src("WA", "Washington", "America/Los_Angeles", "https://app.leg.wa.gov/committeeschedules/", [
    H("https://app.leg.wa.gov/committeeschedules/?chamber=House"),
    S("https://app.leg.wa.gov/committeeschedules/?chamber=Senate"),
    H("https://app.leg.wa.gov/far/House/Calendar", "House FAR"),
    S("https://app.leg.wa.gov/far/Senate/Calendar", "Senate FAR"),
  ]),
  src("WV", "West Virginia", "America/New_York", "https://www.wvlegislature.gov/committees/interims/intcomsched.cfm", [
    J("https://www.wvlegislature.gov/committees/interims/intcomsched.cfm", "Interim schedule"),
  ]),
  src("WI", "Wisconsin", "America/Chicago", "https://committeeschedule.legis.wisconsin.gov/", [
    J("https://committeeschedule.legis.wisconsin.gov/", "Committee schedule"),
  ]),
  src("WY", "Wyoming", "America/Denver", "https://wyoleg.gov/Calendar", [
    H("https://wyoleg.gov/Calendar?chamber=H"),
    S("https://wyoleg.gov/Calendar?chamber=S"),
  ]),
];

export const STATE_BY_CODE = new Map(STATE_SOURCES.map((s) => [s.code, s]));

export function stateByCode(code: string): StateSource | undefined {
  return STATE_BY_CODE.get(code.trim().toUpperCase());
}

export function parseStateList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,+\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => STATE_BY_CODE.has(s));
}

export function chamberBucket(chamber?: string): "house" | "senate" | "other" {
  const v = (chamber || "").toLowerCase();
  if (v.includes("house") || v.includes("assembly") || v === "h") return "house";
  if (v.includes("senate") || v === "s") return "senate";
  return "other";
}

export function chamberLabel(chamber?: string): string {
  const v = (chamber || "").toLowerCase();
  if (v === "house" || v === "assembly" || v === "h") return "House";
  if (v === "senate" || v === "s") return "Senate";
  if (v === "joint" || v === "b") return "Joint";
  if (v === "unicameral") return "Unicameral";
  return chamber || "";
}
