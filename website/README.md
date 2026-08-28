# website

Placeholder static site for `yourdomain.com`, deployed to Cloudflare Pages -
separate from the Docker stack in the parent folder. Swap `index.html` for
your real site (Astro, plain HTML, whatever you want); the deploy mechanics
below don't change.

## Deploy (manual - no CI/CD, no auto-deploy on push)

```bash
npx wrangler pages deploy . --project-name yourdomain-site
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
