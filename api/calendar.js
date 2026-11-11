import { handler, ok, fail, requireTutor } from "./_lib/core.js";
import { parseICS } from "./_lib/ics.js";

export default handler(async (req, res) => {
  if (!requireTutor(req, res)) return;
  const url = process.env.GCAL_ICS_URL;
  if (!url) return ok(res, { configured: false, events: [] });
  const r = await fetch(url, { headers: { "User-Agent": "sat-goals-dashboard" } });
  if (!r.ok) return fail(res, 502, `Google Calendar answered ${r.status}. If you reset the secret iCal address, update GCAL_ICS_URL in Vercel.`);
  const from = Date.now() - 21 * 86400e3, to = Date.now() + 60 * 86400e3;
  const events = parseICS(await r.text(), from, to)
    .map((e) => { const m = e.summary.match(/^\s*SAT\s*[-–—:]\s*(.+?)\s*$/i); return m ? { id: e.id, name: m[1], start: e.start, end: e.end } : null; })
    .filter(Boolean);
  return ok(res, { configured: true, events, at: Date.now() });
});
