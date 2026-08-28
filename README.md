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
follow directly, with the one part it genuinely can't do for you (the
Cloudflare dashboard steps, which need a human logged into a browser)
clearly marked. Doing it by hand yourself? Keep reading below, same steps.

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

## Prerequisites

- Docker Desktop (or plain Docker + Compose) on the box that will run this.
- A domain that's already an active zone on Cloudflare (free plan is fine).
- A GPU or a reasonably capable CPU for Ollama. No GPU yet? Point OpenWebUI
  at a cloud model API instead for now (any OpenAI-compatible endpoint works
  via `OPENAI_API_BASE_URL`/`OPENAI_API_KEY`) and switch to local Ollama
  later - both can run side by side once you do, no hard cutover.

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

**Use the dashboard, token-based "Docker connector" tunnel, not a local
`config.yml`.** This is a deliberate choice, not a simplification - see
"Why no local config.yml" below.

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
