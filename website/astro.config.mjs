// @ts-check
import { defineConfig } from 'astro/config';

// Static output - deploys to Cloudflare Pages as plain static assets, no
// adapter needed. Replace `site` with your real domain (used for canonical
// URLs and the generated sitemap, if you add one later).
export default defineConfig({
  site: 'https://yourdomain.com',
  server: { port: 4321 },
});
