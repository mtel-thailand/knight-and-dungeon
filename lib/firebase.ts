/**
 * Firebase Admin singleton + asset upload helper.
 *
 * Initialises firebase-admin LAZILY — on the first uploadAsset() call, guarded
 * by getApps().length so hot-reload doesn't open duplicate apps — using env
 * vars from .env.local / the Vercel project env:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY      (escaped \n — un-escaped at runtime)
 *   FIREBASE_STORAGE_BUCKET
 *
 * Init MUST stay lazy (not module-level): Next.js evaluates route modules during
 * the build's "collect page data" phase, when these env vars are absent — any
 * top-level access (e.g. PRIVATE_KEY.replace(...)) would throw and fail the
 * build. Callers (the upload routes) already catch failures and fall back to a
 * local asset path, so a missing/!provisioned Firebase config degrades cleanly.
 */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getStorage, getDownloadURL } from "firebase-admin/storage";

/** Initialise the firebase-admin app once, on demand. Throws if env is missing. */
function ensureApp(): void {
  if (getApps().length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  if (!projectId || !clientEmail || !privateKey || !storageBucket) {
    throw new Error(
      "Firebase env not configured (need FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, " +
        "FIREBASE_PRIVATE_KEY, FIREBASE_STORAGE_BUCKET)",
    );
  }

  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
    storageBucket,
  });
}

/**
 * Upload a Buffer to Firebase Storage at the given destination path, then
 * return its public download URL.
 *
 * @param buf         - Raw file bytes.
 * @param destPath    - Remote path inside the bucket (e.g. `spritesheets/blue-long-play-spritesheet.png`).
 * @param contentType - MIME type of the uploaded file (default "image/png" for backward compatibility).
 * @returns A promise that resolves to the public download URL string.
 */
export async function uploadAsset(
  buf: Buffer,
  destPath: string,
  contentType: string = "image/png",
): Promise<string> {
  ensureApp();
  const file = getStorage().bucket().file(destPath);
  await file.save(buf, {
    contentType,
    resumable: false,
    metadata: { cacheControl: "public, max-age=31536000, immutable" },
  });
  return getDownloadURL(file);
}
