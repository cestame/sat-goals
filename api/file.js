// Downloads a stored file after checking who is asking.
import { Readable } from "node:stream";
import { get } from "@vercel/blob";
import { handler, fail, getSession, readJSON, P, str } from "./_lib/core.js";

export default handler(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const sid = str(u.searchParams.get("s"), 40), fid = str(u.searchParams.get("f"), 40);
  const sess = getSession(req);
  if (!sess) return fail(res, 401, "Please log in.");
  if (!(sess.r === "t" || (sess.r === "s" && sess.id === sid))) return fail(res, 403, "You can't open this file.");
  const { data: t } = await readJSON(P.tutor(sid));
  const f = (t?.files || []).find((x) => x.id === fid);
  if (!f) return fail(res, 404, "File not found.");
  const r = await get(f.pathname, { access: "private", useCache: false }).catch(() => null);
  if (!r || r.statusCode !== 200 || !r.stream) return fail(res, 404, "File not found.");
  const inline = /^(application\/pdf|image\/|text\/plain)/.test(f.type || "") && u.searchParams.get("dl") !== "1";
  const ascii = f.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  res.statusCode = 200;
  res.setHeader("Content-Type", f.type || "application/octet-stream");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (f.size) res.setHeader("Content-Length", String(f.size));
  Readable.fromWeb(r.stream).pipe(res);
});
