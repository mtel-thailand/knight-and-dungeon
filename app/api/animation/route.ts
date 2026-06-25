import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdtemp, writeFile, rm, readFile } from "fs/promises";
import os from "os";
import path from "path";
import { listAnimations, getCharacterSeed, readUserState, updateAnimationImage } from "@/lib/db";
import { uploadAsset } from "@/lib/firebase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// kebab-case slug: lowercase alphanumerics joined by single dashes. Anchored, so
// besides being defence in depth (args are passed to spawn() as an array, so
// there is no shell to inject into) it also blocks leading-dash flag injection
// and any "/" or ".." path tricks, and keeps PNG names / DB keys well-formed.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Hard cap on the upload — the whole body is buffered into memory below.
const MAX_BYTES = 200 * 1024 * 1024;
// Kill a stuck ffmpeg/ffprobe rather than hang the request + orphan the child.
const PIPELINE_TIMEOUT_MS = 120_000;
const isDev = process.env.NODE_ENV !== "production";

/**
 * POST /api/animation — multipart { video: File, name: string, character: string }.
 * Persists the upload to a temp file and runs the MP4 -> spritesheet pipeline
 * (add_animation.py), which writes the PNG into public/assets and upserts both
 * the `animations` catalog row and a `character_animations` row for the active
 * character. Returns the new catalog row so the studio can hot-load it.
 *
 * The catalog keyspace is GLOBAL, so the key is namespaced by character
 * (`<character>-<name>`, matching the per-character `<character>-*` kit). Without this a
 * bare name like "walk" uploaded for two characters would destructively
 * overwrite the same catalog row + on-disk PNG (neither is version-controlled).
 */
export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "video too large (max 200MB)" },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "expected multipart/form-data" },
      { status: 400 },
    );
  }

  const video = form.get("video");
  const name = String(form.get("name") ?? "").trim();
  const character = String(form.get("character") ?? "").trim();

  if (!(video instanceof File) || video.size === 0) {
    return NextResponse.json(
      { ok: false, error: "missing video file" },
      { status: 400 },
    );
  }
  if (video.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "video too large (max 200MB)" },
      { status: 413 },
    );
  }
  if (video.type && !video.type.startsWith("video/")) {
    return NextResponse.json(
      { ok: false, error: "file must be a video" },
      { status: 400 },
    );
  }
  if (!SLUG_RE.test(name)) {
    return NextResponse.json(
      { ok: false, error: "name must be kebab-case (letters, numbers, dashes)" },
      { status: 400 },
    );
  }
  if (!SLUG_RE.test(character)) {
    return NextResponse.json(
      { ok: false, error: "invalid character id" },
      { status: 400 },
    );
  }

  // Reject unknown characters so a stray id can't seed a phantom character
  // (getCharacterSeed would otherwise promote a seed-only id into the roster).
  const roster = (await readUserState<{ characters?: Array<{ id: string }> }>())
    ?.characters;
  if (roster && !roster.some((c) => c.id === character)) {
    return NextResponse.json(
      { ok: false, error: "unknown character" },
      { status: 400 },
    );
  }

  // Namespace the catalog key by character (see the function doc); the label is
  // the human-friendly name the user typed, title-cased for the studio list.
  const key = `${character}-${name}`;
  const label = name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  // Write the upload somewhere the python pipeline can read it, then clean up.
  const dir = await mkdtemp(path.join(os.tmpdir(), "vid2sprite-"));
  const inputPath = path.join(dir, "input.mp4");
  try {
    await writeFile(inputPath, Buffer.from(await video.arrayBuffer()));
    await runPipeline(inputPath, key, label, character);

    // Upload the generated spritesheet to Firebase Storage.
    // On failure (e.g. local dev without valid credentials) log a warning and
    // keep the local bare filename — the loaders use assetUrl() which handles
    // both Firebase URLs and local /assets/ prefixed paths.
    const localPng = path.join(process.cwd(), "public/assets", `${key}-spritesheet.png`);
    try {
      const pngBuf = await readFile(localPng);
      const destPath = `spritesheets/${key}-spritesheet.png`;
      const url = await uploadAsset(pngBuf, destPath);
      await updateAnimationImage(key, url);
      console.log(`[firebase] uploaded ${destPath} → ${url}`);
    } catch (fbErr) {
      console.warn(
        "[firebase] upload failed — keeping local asset:",
        fbErr instanceof Error ? fbErr.message : String(fbErr),
      );
    }
  } catch (err) {
    // Leak pipeline detail (Python tracebacks, abs paths) in dev only; always
    // surface the timeout message since it's actionable and not sensitive.
    const message =
      err instanceof Error &&
      (isDev || err.message === "processing timed out")
        ? err.message
        : "pipeline failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // Read back the freshly-written catalog row + the character's seeded duration
  // so the client can hot-load the new frames without a full page reload. Same
  // cached DB connection the studio's GET uses; the python pipeline has already
  // committed and exited, so WAL makes its rows visible here.
  const animation = (await listAnimations()).find((a) => a.key === key) ?? null;
  const seed = (await getCharacterSeed())[character]?.animations?.[key] ?? null;
  return NextResponse.json({ ok: true, key, animation, seed });
}

function runPipeline(
  input: string,
  key: string,
  label: string,
  character: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "python3",
      ["add_animation.py", input, key, "--label", label, "--character", character],
      { cwd: process.cwd(), timeout: PIPELINE_TIMEOUT_MS, killSignal: "SIGKILL" },
    );
    let stderr = "";
    // Drain stdout so a chatty pipeline can't block on a full pipe buffer.
    proc.stdout.on("data", () => {});
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", (e) =>
      reject(
        new Error(
          e.message.includes("ENOENT") ? "python3 not found on PATH" : e.message,
        ),
      ),
    );
    proc.on("close", (code, signal) => {
      if (code === 0) return resolve();
      // node kills with killSignal on timeout -> close fires with that signal.
      if (signal) return reject(new Error("processing timed out"));
      // Surface the tail of stderr (e.g. a Python traceback) for diagnosis.
      reject(
        new Error(
          stderr.trim().split("\n").slice(-3).join("\n") ||
            `add_animation.py exited with code ${code}`,
        ),
      );
    });
  });
}
