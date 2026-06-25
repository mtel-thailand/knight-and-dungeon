import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getDb } from "@/lib/db/client";
import { eq, and } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { uploadAsset } from "@/lib/firebase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * POST /api/user/avatar — Upload a character avatar (multipart).
 * Body: { image: File, userId: string, characterId: string }
 * Resizes/converts to 128×128 max, uploads to Firebase, stores URL.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "expected multipart/form-data" }, { status: 400 });
  }

  const image = form.get("image");
  const userId = String(form.get("userId") ?? "").trim();
  const characterId = String(form.get("characterId") ?? "").trim();

  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ ok: false, error: "missing image file" }, { status: 400 });
  }
  if (image.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "image too large (max 5MB)" }, { status: 413 });
  }
  if (!userId || !characterId) {
    return NextResponse.json({ ok: false, error: "userId and characterId required" }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await image.arrayBuffer());
    // Resize to max 128×128, convert to PNG
    const resized = await sharp(buf)
      .resize(128, 128, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();

    const ext = image.name?.split(".").pop() || "png";
    const destPath = `avatars/${userId}/${characterId}.${ext}`;
    const url = await uploadAsset(resized, destPath, "image/png");

    // Store URL in user_characters
    const db = getDb();
    await db
      .update(schema.userCharacters)
      .set({ avatarUrl: url })
      .where(and(
        eq(schema.userCharacters.userId, userId),
        eq(schema.userCharacters.characterId, characterId),
      ));

    return NextResponse.json({ ok: true, url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
