import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { uploadAsset } from "@/lib/firebase";
import { slugify } from "@/app/studio/studioHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "webm"]);

const MIME_TO_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
};

/**
 * POST /api/audio — multipart { audio: File, name?: string }.
 * Accepts an uploaded audio file, stores it locally (best-effort) and to
 * Firebase Storage (with fallback to the local path on failure), and returns
 * either a Firebase download URL or the bare relative path `audio/<slug>.<ext>`.
 *
 * The studio client posts to this endpoint to persist sound effects / music
 * without any transcoding or ffmpeg processing — the audio is stored as-is.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }

  const audio = form.get("audio");
  const nameRaw = form.get("name");

  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json(
      { error: "missing audio file" },
      { status: 400 },
    );
  }

  // Accept by MIME type (audio/*) or by known file extension.
  const originalName = audio.name || "";
  const extFromName = originalName.includes(".")
    ? originalName.split(".").pop()?.toLowerCase() ?? ""
    : "";
  const isAudioMime = audio.type ? audio.type.startsWith("audio/") : false;
  const isAudioExt = ALLOWED_AUDIO_EXTS.has(extFromName);

  if (!isAudioMime && !isAudioExt) {
    return NextResponse.json(
      {
        error:
          "file must be an audio type (mp3/wav/ogg/m4a/aac/webm), got " +
          (audio.type || originalName || "unknown"),
      },
      { status: 400 },
    );
  }

  // Derive extension: prefer the original filename extension, then the MIME
  // subtype, then fall back to mp3.
  let ext: string;
  if (extFromName && ALLOWED_AUDIO_EXTS.has(extFromName)) {
    ext = extFromName;
  } else if (audio.type && MIME_TO_EXT[audio.type]) {
    ext = MIME_TO_EXT[audio.type];
  } else {
    ext = "mp3";
  }

  // Derive slug: use the optional `name` field, else the original basename
  // (without extension), falling back to "audio".
  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
  const basename = originalName.includes(".")
    ? originalName.slice(0, originalName.lastIndexOf("."))
    : originalName;
  const slug = slugify(name || basename, "audio");
  const key = `audio/${slug}.${ext}`;

  const buf = Buffer.from(await audio.arrayBuffer());

  // Local write — best-effort (Vercel read-only FS will fail silently here).
  try {
    const assetsDir = path.join(process.cwd(), "public/assets/audio");
    await mkdir(assetsDir, { recursive: true });
    await writeFile(path.join(assetsDir, `${slug}.${ext}`), buf);
  } catch (err) {
    console.warn(
      "[audio] local write failed (expected on Vercel):",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Firebase upload with fallback to the bare relative path.
  // On Vercel the local copy won't persist across instances, so Firebase is
  // the durable store; the fallback keeps local dev working without Firebase.
  let sound: string;
  try {
    sound = await uploadAsset(buf, key, audio.type || "audio/mpeg");
  } catch (fbErr) {
    console.warn(
      "[audio] Firebase upload failed — keeping local path:",
      fbErr instanceof Error ? fbErr.message : String(fbErr),
    );
    sound = key;
  }

  return NextResponse.json({ sound });
}
