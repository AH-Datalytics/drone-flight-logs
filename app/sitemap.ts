import type { MetadataRoute } from 'next';
import { publicAgencies, collectedAt } from '@/lib/data';
import { siteUrl } from '@/lib/site';

/** Every page a reader can reach: the three fixed ones and an entry per agency. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const lastModified = collectedAt();

  return [
    { url: `${base}/`, lastModified, changeFrequency: 'monthly', priority: 1 },
    { url: `${base}/agencies`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/about`, lastModified, changeFrequency: 'yearly', priority: 0.5 },
    ...publicAgencies().map(a => ({
      url: `${base}/agency/${a.agency_id}`,
      lastModified: a.collected_utc ? new Date(a.collected_utc) : lastModified,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ];
}
