/**
 * The site's public base URL.
 *
 * Set NEXT_PUBLIC_SITE_URL for production. Vercel supplies VERCEL_URL on
 * previews, which keeps sitemaps and social cards pointing at the deployment
 * being previewed rather than at production.
 */
export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
