import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // Bundle the seeded SQLite snapshot into every API route's serverless function
  // (key = route-path glob, value = project-root-relative globs). db.ts copies it
  // to /tmp at runtime on Vercel. The native addon is pinned too, in case Node
  // File Tracing doesn't pick it up automatically.
  outputFileTracingIncludes: {
    '/api/**': [
      'data/seed/app.db',
      'node_modules/better-sqlite3/build/Release/*.node',
    ],
  },
};

export default nextConfig;
