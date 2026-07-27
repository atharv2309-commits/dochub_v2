import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/docs/'],
      disallow: ['/admin', '/auth', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
