import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import fs from "fs";
import path from "path";
import { upsertAnimation } from "@/lib/db";
import { uploadAsset } from "@/lib/firebase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// LOCAL-DEV ONLY. Shells out to ffmpeg/ffprobe (child_process) and writes a PNG
// into public/assets, so it will NOT run on Vercel (read-only FS, no ffmpeg) —
// that's expected; it's an authoring convenience for local dev. Mirrors the
// proven add_animation.py pipeline (probe -> tiled chromakey PNG -> Pixi frame
// JSON -> upsert the `animations` catalog) and reuses db.ts's upsertAnimation.

const execFileP = promisify(execFile);

// key: lowercase, runs of non-alphanumerics -> "-", trimmed of leading/trailing "-".
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// UI label from the raw name: title-cased words (split on space/_/-).
function titleCase(s: string): string {
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

type ProbeStream = {
  codec_type?: string;
  r_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
  width?: number | string;
  height?: number | string;
};

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const rawName = String(form.get("name") ?? "");
  const chroma = form.get("chroma") !== "false"; // default true
  const color = String(form.get("color") || "00FF00");

  if (!(file instanceof File) || !rawName.trim()) {
    return NextResponse.json(
      { error: "file (MP4) and name are required" },
      { status: 400 },
    );
  }
  const key = slugify(rawName);
  if (!key) {
    return NextResponse.json(
      { error: "name produced an empty key" },
      { status: 400 },
    );
  }
  const label = titleCase(rawName);

  // Persist the upload to a temp file so ffmpeg/ffprobe can read it by path.
  const buf = Buffer.from(await file.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `${key}-${Date.now()}.mp4`);
  await fs.promises.writeFile(tmp, buf);

  const pngName = `${key}-spritesheet.png`;
  const outPng = path.join(process.cwd(), "public/assets", pngName);

  try {
    // 1) Probe — same invocation as add_animation.py probe_video.
    const { stdout } = await execFileP(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", tmp],
      { maxBuffer: 1 << 24 },
    );
    const data = JSON.parse(stdout.toString()) as {
      streams?: ProbeStream[];
      format?: { duration?: string };
    };
    const video = (data.streams ?? []).find((s) => s.codec_type === "video");
    if (!video) throw new Error("no video stream found in upload");

    const [num, den] = String(video.r_frame_rate ?? "0/1").split("/");
    const fps = Number(num) / Number(den);
    let nbFrames = Number(video.nb_frames) || 0;
    if (!nbFrames) {
      const duration = Number(video.duration ?? data.format?.duration);
      nbFrames = Math.round(duration * fps);
    }
    if (!Number.isFinite(nbFrames) || nbFrames <= 0) {
      throw new Error("could not determine a positive frame count");
    }
    const width = Number(video.width);
    const height = Number(video.height);
    if (!(width > 0) || !(height > 0)) {
      throw new Error("could not determine video dimensions");
    }

    // 2) Grid: native frame size; auto columns keep the sheet roughly square.
    const cols = Math.ceil(Math.sqrt(nbFrames));
    const rows = Math.ceil(nbFrames / cols);
    const frameW = width;
    const frameH = height;

    // 3) Build the tiled PNG — same filter chain + flags as add_animation.py.
    const filters = [
      ...(chroma ? [`chromakey=0x${color}:0.30:0.05`] : []),
      `tile=${cols}x${rows}`,
    ];
    await fs.promises.mkdir(path.dirname(outPng), { recursive: true });
    await execFileP(
      "ffmpeg",
      ["-i", tmp, "-vf", filters.join(","), "-frames:v", "1", "-update", "1", outPng, "-y"],
      { maxBuffer: 1 << 24 },
    );

    // 4) Pixi frame JSON — identical shape to add_animation.py build_pixi_json.
    const prefix = key.replace(/-/g, "_");
    const frames: Record<string, unknown> = {};
    const animFrames: string[] = [];
    for (let i = 0; i < nbFrames; i++) {
      const fname = `${prefix}_${String(i).padStart(3, "0")}`;
      frames[fname] = {
        frame: { x: (i % cols) * frameW, y: Math.floor(i / cols) * frameH, w: frameW, h: frameH },
        sourceSize: { w: frameW, h: frameH },
        spriteSourceSize: { x: 0, y: 0, w: frameW, h: frameH },
        rotated: false,
        trimmed: false,
      };
      animFrames.push(fname);
    }
    const pixiJson = {
      frames,
      animations: { [prefix]: animFrames },
      meta: {
        image: pngName,
        size: { w: cols * frameW, h: rows * frameH },
        scale: 1,
      },
    };

    // 5) Upsert into the `animations` catalog (db.ts JSON-stringifies frameData).
    //    Attempt Firebase upload; on failure fall back to the local bare filename
    //    so local dev without valid credentials still works.
    let imageUrl = pngName;
    try {
      const pngBuf = await fs.promises.readFile(outPng);
      const destPath = `spritesheets/${pngName}`;
      imageUrl = await uploadAsset(pngBuf, destPath);
      console.log(`[firebase] uploaded ${destPath} → ${imageUrl}`);
    } catch (fbErr) {
      console.warn(
        "[firebase] upload failed — falling back to local asset:",
        fbErr instanceof Error ? fbErr.message : String(fbErr),
      );
    }
    await upsertAnimation({ key, label, image: imageUrl, frameData: pixiJson });

    await fs.promises.unlink(tmp).catch(() => {});
    return NextResponse.json({ ok: true, key, label, frames: nbFrames });
  } catch (e) {
    // Best-effort cleanup of the temp upload + any partial PNG on failure.
    await fs.promises.unlink(tmp).catch(() => {});
    await fs.promises.unlink(outPng).catch(() => {});
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
