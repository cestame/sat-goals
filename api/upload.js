// Authorizes a direct browser upload into private storage. Tutor only.
import { handleUpload } from "@vercel/blob/client";
import { handler, readBody, ok, fail, requireTutor, readJSON, P, str } from "./_lib/core.js";

export const ALLOWED_TYPES = [
  "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/heic",
  "text/plain", "text/csv", "text/markdown",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
];
export const MAX_BYTES = 50 * 1024 * 1024;

export default handler(async (req, res) => {
  if (!requireTutor(req, res)) return;
  if (req.method !== "POST") return fail(res, 405, "Use POST");
  const body = await readBody(req);
  try {
    const result = await handleUpload({
      body, request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let p = {}; try { p = JSON.parse(clientPayload || "{}"); } catch {}
        const id = str(p.studentId, 40);
        if (!id || !(await readJSON(P.student(id))).data) throw new Error("Student not found");
        if (!pathname.startsWith(`students/${id}/files/`) || pathname.includes("..")) throw new Error("Bad file path");
        return { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true };
      },
    });
    return ok(res, result);
  } catch (e) {
    return fail(res, 400, /content type/i.test(e.message) ? "That file type isn't supported. Use PDF, images, Word, Excel, PowerPoint, text or zip." : /size|large/i.test(e.message) ? "That file is over 50 MB." : e.message);
  }
});
