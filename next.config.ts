import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the Puppeteer/Chromium packages out of the server bundle. They use
  // native Node features and are loaded via runtime require instead. Without
  // this, Next traces the dev-only `import('puppeteer')` and bundles full
  // Chromium (~300MB) into the Vercel function, exceeding the 250MB limit.
  serverExternalPackages: ['puppeteer', 'puppeteer-core', '@sparticuz/chromium'],

  // @sparticuz/chromium reads its brotli-compressed binary packs (bin/*.br) via
  // a path computed at runtime, so @vercel/nft's static analysis can't see them
  // and drops them from the function — causing "input directory .../bin does not
  // exist" on Vercel. Force the whole package (incl. bin/) into the PDF route's
  // trace. ~66MB; the function stays well under the 250MB limit.
  outputFileTracingIncludes: {
    '/api/pdf/**': ['./node_modules/@sparticuz/chromium/**'],
  },
};

export default nextConfig;
