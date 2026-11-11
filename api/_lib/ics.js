// Minimal iCalendar reader for Google Calendar's secret iCal address.
// Handles time zones, all-day events, simple DAILY/WEEKLY repeats, EXDATE and moved/cancelled repeats.

function tzOffset(ts, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
}
function wallToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!tz) return guess;
  let t;
  try { t = guess - tzOffset(guess, tz); t = guess - tzOffset(t, tz); } catch { return guess; }
  return t;
}
function parseDate(value, params, fallbackTz) {
  const m = String(value).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", z] = m;
  const allDay = !m[4];
  const tz = z ? null : params.TZID || fallbackTz;
  return { ts: z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) : wallToUtc(+y, +mo, +d, +h, +mi, +s, allDay ? fallbackTz : tz),
    wall: { y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +s }, tz: z ? "UTC" : (allDay ? fallbackTz : tz), allDay };
}
function parseLine(line) {
  const i = line.indexOf(":"); if (i < 0) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...ps] = head.split(";");
  const params = {}; for (const p of ps) { const [k, v] = p.split("="); if (k) params[k.toUpperCase()] = (v || "").replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value };
}
const unescape = (v) => String(v).replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const DAYMAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function parseICS(text, fromTs, toTs) {
  const lines = String(text).replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  let calTz = "UTC"; const raw = []; let cur = null; let depth = 0;
  for (const line of lines) {
    if (line.startsWith("X-WR-TIMEZONE:")) calTz = line.slice(14).trim() || calTz;
    if (line === "BEGIN:VEVENT") { cur = { props: {}, exdates: [] }; depth = 1; continue; }
    if (!cur) continue;
    if (line.startsWith("BEGIN:")) { depth++; continue; }
    if (line.startsWith("END:")) { depth--; if (line === "END:VEVENT" && depth === 0) { raw.push(cur); cur = null; } continue; }
    if (depth !== 1) continue;
    const p = parseLine(line); if (!p) continue;
    if (p.name === "EXDATE") { for (const v of p.value.split(",")) cur.exdates.push({ v, params: p.params }); }
    else cur.props[p.name] = p;
  }
  const overrides = new Set(); const out = [];
  const push = (uid, summary, start, end, status) => {
    if (status === "CANCELLED") return;
    if (end < fromTs || start > toTs) return;
    out.push({ id: `${uid}_${new Date(start).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`, summary, start, end });
  };
  for (const e of raw) {
    const rid = e.props["RECURRENCE-ID"]; if (!rid) continue;
    const r = parseDate(rid.value, rid.params, calTz); if (r) overrides.add(`${e.props.UID?.value}|${r.ts}`);
  }
  for (const e of raw) {
    const P = e.props, uid = P.UID?.value || Math.random().toString(36).slice(2);
    const summary = unescape(P.SUMMARY?.value || ""); const status = (P.STATUS?.value || "").toUpperCase();
    const st = P.DTSTART && parseDate(P.DTSTART.value, P.DTSTART.params, calTz); if (!st) continue;
    const en = P.DTEND ? parseDate(P.DTEND.value, P.DTEND.params, calTz) : null;
    const dur = en ? en.ts - st.ts : (st.allDay ? 86400e3 : 3600e3);
    if (P["RECURRENCE-ID"] || !P.RRULE) { push(uid, summary, st.ts, st.ts + dur, status); continue; }
    const rule = Object.fromEntries(P.RRULE.value.split(";").map((kv) => kv.split("=")).map(([k, v]) => [k.toUpperCase(), v]));
    if (!["DAILY", "WEEKLY"].includes(rule.FREQ)) { push(uid, summary, st.ts, st.ts + dur, status); continue; }
    const interval = Math.max(1, Number(rule.INTERVAL) || 1);
    const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
    const until = rule.UNTIL ? parseDate(rule.UNTIL, {}, calTz)?.ts ?? Infinity : Infinity;
    const ex = new Set(e.exdates.map((x) => parseDate(x.v, x.params, calTz)?.ts));
    const w = st.wall; const startDow = new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();
    const byday = rule.FREQ === "WEEKLY" ? (rule.BYDAY ? rule.BYDAY.split(",").map((d) => DAYMAP[d.slice(-2)]).filter((d) => d != null) : [startDow]) : null;
    const weekStartOffset = (startDow + 6) % 7; // days since Monday
    let n = 0;
    for (let k = 0; k < 3000; k++) {
      const day = new Date(Date.UTC(w.y, w.mo - 1, w.d + k));
      if (rule.FREQ === "DAILY") { if (k % interval) continue; }
      else { const week = Math.floor((k + weekStartOffset) / 7); if (week % interval || !byday.includes(day.getUTCDay())) continue; }
      const ts = wallToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), w.h, w.mi, w.s, st.tz === "UTC" ? null : st.tz);
      if (ts > until || n >= count || ts > toTs) break;
      n++;
      if (ex.has(ts) || overrides.has(`${uid}|${ts}`)) continue;
      push(uid, summary, ts, ts + dur, status);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
