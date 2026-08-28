# website

Minimal Astro site for `yourdomain.com` (static output, no adapter) -
separate from the Docker stack in the parent folder, deployed to Cloudflare
Pages. Swap the content in `src/pages/index.astro` for your real site; the
deploy mechanics below don't change.

## Local dev

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # outputs to dist/
npm run preview   # serve the built dist/ locally, closest to prod
```

## Deploy (Cloudflare Pages, manual - no CI/CD, no auto-deploy on push)

```bash
npm install
npm run build
npx wrangler pages deploy dist --project-name yourdomain-site
```

First deploy creates the Pages project if it doesn't exist yet. Then:
Cloudflare dashboard -> Pages -> yourdomain-site -> Custom domains -> add
`yourdomain.com`. Cloudflare offers to auto-create the DNS record - accept
it, no manual DNS edit needed.

Requires `wrangler` authenticated against the Cloudflare account that owns
`yourdomain.com` (`npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` for
non-interactive use).

## Verify

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://yourdomain.com
```
