# private-ai-bootstrap

A template for running your own private ChatGPT-style chat, plus a normal
static website, on a box you own (a spare Mac, an old PC, anything that runs
Docker) - reachable from anywhere via a real domain, with no port-forwarding
and no public IP exposure. Everything below uses `yourdomain.com` as a
placeholder; swap it for your real domain throughout.

This is a genericized version of a stack built and verified end-to-end
against a real domain and a real Cloudflare account - every step and every
gotcha in this README actually happened, nothing here is speculative.

**Setting this up with an AI coding agent (Claude Code or similar)?** Point
it at [`CLAUDE.md`](CLAUDE.md) - it's a runbook written for an agent to
follow directly. The Cloudflare Tunnel step (below) has two paths: one that
genuinely needs you in the dashboard the whole way, and a lighter one where
you create a single API token and the agent does the rest. Doing it by hand
yourself? Keep reading below, same steps.

## Architecture

```
yourdomain.com          -> Cloudflare Pages   -> your static site
chat.yourdomain.com     -> Cloudflare Tunnel  -> Ollama + OpenWebUI, on your box
```

Two independent pieces, both fronted by Cloudflare, neither exposing a port
on your router:

- **The website** is a minimal [Astro](https://astro.build) site (static
  output, no adapter) deployed to Cloudflare Pages - see
  [`website/README.md`](website/README.md). Not part of the Docker stack at
  all, no Node.js needed on the box running the chat stack.
- **The private chat** is `docker-compose.yml` in this folder: `ollama`
  (serves the model), `openwebui` (the ChatGPT-style front end - upstream
  project: [github.com/open-webui/open-webui](https://github.com/open-webui/open-webui)),
  and `cloudflared` (the tunnel). `docker compose up -d` and it's running.
  This bootstrap only covers first-run setup - for anything past that
  (user roles and permissions, RAG/knowledge bases, model parameters,
  themes, more auth providers), the upstream repo's own README and
  [docs](https://docs.openwebui.com) are the reference, not this file.

## Part 0 - before you start

Everything else in this README assumes these three things are already true.
If they are, skip to Step 1.

### 1. Docker

- **macOS/Windows**: install [Docker Desktop](https://www.docker.com/products/docker-desktop/), open it once so it finishes setup.
- **Linux**: install [Docker Engine](https://docs.docker.com/engine/install/) + the Compose plugin (`docker compose version` should work, not just `docker-compose`).

### 2. A GPU or capable CPU for Ollama

No GPU yet? Point OpenWebUI at a cloud model API instead for now (any
OpenAI-compatible endpoint works via `OPENAI_API_BASE_URL`/`OPENAI_API_KEY`)
and switch to local Ollama later - both can run side by side once you do,
no hard cutover.

### 3. A domain, pointed at Cloudflare

Everything downstream (the website, the tunnel, the DNS records) needs an
active Cloudflare zone to attach to. Two cases:

- **You already have a domain on Cloudflare** (for anything - email routing,
  another site, whatever): nothing to do, skip ahead.
- **You have a domain registered somewhere else** (GoDaddy, Namecheap, your
  registrar of choice) **or don't have one yet**:
  1. If you don't have a domain, buy one from any registrar - nothing
     Cloudflare-specific about this step.
  2. Sign up for a free [Cloudflare account](https://dash.cloudflare.com/sign-up).
  3. Dashboard -> Add a site -> enter your domain -> pick the Free plan.
     Cloudflare scans your existing DNS records and shows you two
     nameservers (e.g. `aida.ns.cloudflare.com`, `walt.ns.cloudflare.com`).
  4. Go to your domain registrar's site, find the nameserver settings for
     that domain, and replace whatever's there with the two Cloudflare gave
     you. This is the one step outside Cloudflare entirely - every registrar
     has this screen somewhere, usually called "Nameservers" or "DNS
     Management."
  5. Propagation is usually minutes, sometimes a few hours. Cloudflare
     emails you once it detects the switch; `dig NS yourdomain.com` also
     shows it once it's live.

Nothing else in this repo can work until this step is done - Cloudflare
Pages (the website) and Cloudflare Tunnel (the chat) both require an active
zone to attach to.

## Step 1 - the website

See [`website/README.md`](website/README.md). Five minutes, independent of
everything else here.

## Step 2 - bring up the private chat stack

```bash
cp .env.example .env
openssl rand -hex 32   # paste the output into .env as WEBUI_SECRET_KEY
```

Leave `CLOUDFLARE_TUNNEL_TOKEN` blank for now - Step 3 gets you that value.

```bash
docker compose up -d ollama openwebui   # cloudflared deliberately omitted, no token yet
docker compose exec ollama ollama pull <a small model to start, e.g. llama3.2:3b>
docker compose exec ollama ollama run <that model> "say hello"
```

Open `http://localhost:3000`, confirm Ollama shows up as a connected
provider and the model is selectable. This proves the wiring before you
expose anything to the internet.

## Step 3 - Cloudflare Tunnel

**Use a token-based "Docker connector" tunnel, not a local `config.yml`.**
This is a deliberate choice, not a simplification - see "Why no local
config.yml" below. Two ways to actually create it - pick one:

### Path A - dashboard, by hand (no setup, works for anyone)

1. Cloudflare Zero Trust dashboard -> Networks -> Tunnels -> Create a tunnel
   -> choose the **Docker** connector.
2. Copy the token it shows you (the long string in the
   `docker run ... cloudflared tunnel run --token ...` command). Paste it
   into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
3. In the tunnel's **Public Hostname** tab, click "Add a public hostname":
   - Subdomain: `chat`
   - Domain: `yourdomain.com`
   - Type: `HTTP`
   - URL: `openwebui:8080` (the compose service name - `cloudflared` and
     `openwebui` share a Docker network, so this resolves; `localhost` does
     not, from inside that container).

   Saving this also auto-creates the DNS CNAME for `chat.yourdomain.com`
   pointing at your tunnel - no manual DNS step.

### Path B - one API token, then your AI agent does the rest

Faster if you're doing this with an agent (Claude Code or similar) and don't
want to leave the terminal. Trade-off: still one dashboard visit, but a
lighter one - creating a scoped API token instead of clicking through the
tunnel wizard yourself.

1. Cloudflare dashboard -> your profile icon -> **My Profile** -> **API
   Tokens** -> **Create Token** -> **Custom token**. Give it two
   permissions: **Account > Cloudflare Tunnel > Edit**, and **Zone > DNS >
   Edit**, scoped to your specific domain. Create it, copy the token (shown
   once).
2. Hand the token to your agent and say "create the tunnel and route
   `chat.yourdomain.com` to it." From here the agent can do the whole rest
   of this step itself via the Cloudflare API - no more dashboard visits:
   - `POST /accounts/{account_id}/cfd_tunnel` (`{"name": "...", "config_src": "cloudflare"}`) creates the tunnel and returns its `id`.
   - `GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/token` returns the connector token - same value Path A copies from the dashboard, put it in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
   - `PUT /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations` sets the ingress rule (`chat.yourdomain.com` -> `http://openwebui:8080`) - same GET/PUT pattern documented below under "Why no local config.yml", confirmed working against a real tunnel while building this bootstrap.
   - `POST /zones/{zone_id}/dns_records` (`{"type": "CNAME", "name": "chat", "content": "<tunnel_id>.cfargotunnel.com", "proxied": true}`) creates the DNS record Path A gets for free from the dashboard.

   **Honesty check on this path**: the `configurations` GET/PUT calls are
   independently verified this session, against a real tunnel. Tunnel
   creation and the DNS record call are sourced from Cloudflare's own API
   reference, not personally run end-to-end here yet - if you hit something
   that doesn't match, that's why, and it's worth reporting back.
   Mutating API calls like these will likely prompt for your explicit
   confirmation before running, same as any other action with real
   external effects - that's expected, not a bug.

Either path, once the token is in `.env`:

```bash
docker compose up -d cloudflared
docker compose ps   # cloudflared should go "healthy" within ~30s
```

### Why no local `config.yml`

A token-based tunnel like this one is **remotely managed** - hostname
routing lives entirely in the dashboard's Public Hostname tab. If you ever
add a local `cloudflared/config.yml` to a tunnel that already has dashboard
routes, Cloudflare's edge silently ignores your file and keeps serving the
dashboard's routes instead - your local edits render correctly if you check
the file on disk, but do nothing to actual traffic. This exact thing
happened while building the reference deployment this bootstrap is based on.
If you ever need to confirm which one is actually in control for a given
tunnel:

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/<account_id>/cfd_tunnel/<tunnel_id>/configurations" \
  -H "Authorization: Bearer <a token with Account:Cloudflare Tunnel:Edit>" | python3 -m json.tool
```

`"source": "cloudflare"` in the response means dashboard-managed - a local
config file for that tunnel does nothing. Sticking to the dashboard/token
pattern in this bootstrap avoids the whole problem.

## Step 4 - create accounts, then lock signup down

1. Temporarily set `ENABLE_SIGNUP=true` **and `DEFAULT_USER_ROLE=user`** in
   `.env`, then `docker compose up -d --force-recreate openwebui`. The
   `DEFAULT_USER_ROLE` part matters: OpenWebUI only auto-promotes the very
   first account ever created to admin - every signup after that defaults to
   role "pending" and can't chat until manually approved. Setting `user` for
   this bootstrap window skips that friction for every account you create
   next.
2. Open `https://chat.yourdomain.com` (or `http://localhost:3000` on the box
   itself). Create the admin account first, then one account per person.
3. Set `ENABLE_SIGNUP=false`, remove/reset `DEFAULT_USER_ROLE` in `.env`,
   `docker compose up -d --force-recreate openwebui` again. Confirm the
   signup option is gone from the login page.
4. Log in as one of the non-admin accounts, confirm it lands in chat, not a
   "pending approval" screen.

## Step 5 - verify it's actually reachable from outside

Open `https://chat.yourdomain.com` from a phone on cellular data, not your
home WiFi - this proves the tunnel and DNS are both working, not just local
networking.

### Gotcha: your own machine's DNS cache

Right after the CNAME is created, `curl`/Safari/Chrome on the machine you
just did all this work on may still fail with "could not resolve host" for a
minute or more - `mDNSResponder` cached the earlier "this doesn't exist yet"
answer. `dig` bypasses that cache and will show the record is fine well
before `curl` catches up. If you don't want to wait it out:

```bash
sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder
```

Any other device that never made the earlier failed lookup won't have this
problem - that's why Step 5 says to check from a phone.

## Making it durable across reboots

`ollama` and `openwebui` already run with `restart: unless-stopped`,
`cloudflared` with `restart: always` - Docker restarts them whenever the
Docker daemon starts. Enable "Start Docker Desktop when you log in" (or the
Docker daemon at boot on Linux) and the whole stack survives a reboot with
no manual intervention.

## Upgrading without losing your data

Both stateful services are **bind-mounted to plain folders on the host**,
not opaque Docker-managed volumes:

```
./data/ollama       -> pulled models (ollama container's /root/.ollama)
./data/openwebui     -> accounts, chat history, settings (openwebui's /app/backend/data)
```

Pulling a newer image and recreating the container only ever replaces the
application code inside the container - it never touches `./data/`, because
that folder lives on your host filesystem, not inside the container's own
layer. That's the whole mechanism, and it's why upgrading is boringly safe:

```bash
docker compose pull openwebui && docker compose up -d openwebui   # update OpenWebUI - accounts/chats untouched
docker compose pull ollama && docker compose up -d ollama          # update Ollama - pulled models untouched
docker compose exec ollama ollama pull <model>                     # add/update a specific model
```

Back up either service by copying its folder while the stack is running
(both are plain files, no special export step):

```bash
cp -R data/openwebui ~/backups/openwebui-$(date +%Y-%m-%d)
cp -R data/ollama ~/backups/ollama-$(date +%Y-%m-%d)
```

`./data/` is gitignored - it's your real content, it never belongs in the
repo.

## Logs

```bash
docker compose logs ollama
docker compose logs openwebui
docker compose logs cloudflared
```

## Credits

This bootstrap is glue, not the hard part. The actual chat application and
model runtime are separate open source projects - go there for anything
beyond first-run setup:

- **[Open WebUI](https://github.com/open-webui/open-webui)** - the chat
  front end this whole thing is built around.
- **[Ollama](https://github.com/ollama/ollama)** - runs the model.
- **[cloudflared](https://github.com/cloudflare/cloudflared)** - the tunnel
  client, from Cloudflare.

MIT licensed, see [`LICENSE`](LICENSE).
