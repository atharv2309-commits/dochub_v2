// Absolute site origin for SEO (sitemap, canonical, OG). Set NEXT_PUBLIC_SITE_URL
// in production (e.g. https://docs.yourcompany.com).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
