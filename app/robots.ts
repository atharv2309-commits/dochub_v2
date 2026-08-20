import type { MetadataRoute } from 'next'
import { currentSiteUrl } from '@/lib/site'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const siteUrl = await currentSiteUrl()
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/docs/'],
      disallow: ['/admin', '/auth', '/api/'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
