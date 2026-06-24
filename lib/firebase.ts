/**
 * Firebase Admin singleton + asset upload helper.
 *
 * Initialises firebase-admin ONCE (guarded by getApps().length so hot-reload
 * doesn't open duplicate connections) using env vars from .env.local:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY  (escaped \n — replaced at runtime)
 *   FIREBASE_STORAGE_BUCKET
 *
 * Exports uploadAsset() for the animation pipeline routes.
 */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getStorage, getDownloadURL } from "firebase-admin/storage";

// Lazy singleton — no-op if already initialised (survives Next.js dev reloads).
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

/**
 * Upload a Buffer to Firebase Storage at the given destination path, then
 * return its public download URL.
 *
 * @param buf    - Raw PNG bytes.
 * @param destPath - Remote path inside the bucket (e.g. `spritesheets/john-idle-spritesheet.png`).
 * @returns A promise that resolves to the public download URL string.
 */
export async function uploadAsset(
  buf: Buffer,
  destPath: string,
): Promise<string> {
  const file = getStorage().bucket().file(destPath);
  await file.save(buf, {
    contentType: "image/png",
    resumable: false,
    metadata: { cacheControl: "public, max-age=31536000, immutable" },
  });
  return getDownloadURL(file);
}
