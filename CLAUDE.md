# Instructions for an AI coding agent (Claude Code or similar)

You're setting up this repo's Docker Compose stack on whatever machine you're
running on: `ollama` (serves a local model), `openwebui` (the ChatGPT-style
front end), and `cloudflared` (exposes it publicly with no port-forwarding).

This is split into things you can do entirely on your own, and things that
need a human. Part B below has two ways to get the tunnel created - one
where the human clicks through the dashboard themselves, one where the
human creates a single scoped API token and you do the rest via the
Cloudflare API. Ask which the human wants before starting Part B; don't
assume. Confirm each step actually worked before moving to the next - don't
assume there either.

## Part A - you can do this on your own

1. `cp .env.example .env`
2. Generate a session secret and put it in `.env` as `WEBUI_SECRET_KEY`:
   ```bash
   openssl rand -hex 32
   ```
   Don't leave this blank - without it, OpenWebUI generates a new random key
   on every container restart, silently logging everyone out each time.
3. Ask the user what domain they own on Cloudflare and what subdomain they
   want the chat at (default suggestion: `chat.<their domain>`). Set
   `WEBUI_URL=https://chat.<their-domain>` in `.env` now, even though the
   tunnel isn't live yet - it's used for generated links, not just cosmetic.
   **Do not touch `CORS_ALLOW_ORIGIN` to match** - leave it as
   `http://localhost:3000` for now. It's a separate variable on purpose: if
   it's set to the public domain before local testing, the browser's
   `http://localhost:3000` origin gets rejected and chat streaming silently
   hangs (backend returns 200, UI never renders it - confirmed by hitting
   this exact bug while verifying this repo). Add the public domain to
   `CORS_ALLOW_ORIGIN` (semicolon-separated, keep localhost too) only once
   Part C's tunnel is actually live and you're testing through it.
4. Bring up the model server and chat UI (tunnel deliberately omitted, no
   token yet):
   ```bash
   docker compose up -d ollama openwebui
   docker compose exec ollama ollama pull <a small model to start, e.g. llama3.2:3b>
   docker compose exec ollama ollama run <that model> "say hello"
   ```
   Confirm you got a real response, not an error.
5. Check `http://localhost:3000` is reachable and shows the OpenWebUI login
   page (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
   should return 200). If you can, actually create a test account and send
   one real chat message through the UI (not just the CLI) - the CLI test in
   step 4 proves Ollama works, but only a real browser round-trip through
   OpenWebUI proves the full chain, including CORS/websocket, actually
   works.
6. Report back: local wiring confirmed, waiting on Part B before continuing.
   **Stop here until the human completes Part B and gives you the tunnel
   token.**

If something about OpenWebUI itself goes wrong that isn't covered in this
file (auth providers, RAG/knowledge bases, model parameters, permissions),
check the upstream project directly -
[github.com/open-webui/open-webui](https://github.com/open-webui/open-webui)
and [docs.openwebui.com](https://docs.openwebui.com) - rather than guessing.
This runbook only covers first-run setup.

## Part B - ask the human which path, then follow it

Two ways to get the tunnel created. Ask which the human wants - don't just
pick one.

### Path A - human does it in the dashboard

Tell the user, plainly, to:

1. Go to the Cloudflare Zero Trust dashboard -> Networks -> Tunnels ->
   Create a tunnel -> choose the **Docker** connector.
2. Copy the token shown (the long string in the
   `docker run ... cloudflared tunnel run --token ...` command it displays).
3. In the tunnel's **Public Hostname** tab, add: hostname
   `chat.<their-domain>`, type `HTTP`, URL `openwebui:8080`.
4. Paste the token back to you (the agent).

You genuinely cannot do this path yourself - creating a tunnel token this
way requires an interactive OAuth login in a real browser. Don't attempt to
script around it with `cloudflared login` either; that opens a browser too
and still needs the human present.

### Path B - human gives you an API token, you do the rest

Lighter ask of the human: one dashboard visit to create a scoped API token,
not the full tunnel wizard. Tell them: Cloudflare dashboard -> profile icon
-> My Profile -> API Tokens -> Create Token -> Custom token -> two
permissions, **Account > Cloudflare Tunnel > Edit** and **Zone > DNS >
Edit** (scoped to their domain) -> Create -> paste the token to you.

Once you have it, do this yourself via the Cloudflare API (ask for explicit
confirmation before each mutating call - these have real external effects,
same as any other action that changes a live system):

1. `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/cfd_tunnel`
   with body `{"name": "<something descriptive>", "config_src": "cloudflare"}`.
   Returns the tunnel's `id`.
2. `GET https://api.cloudflare.com/client/v4/accounts/{account_id}/cfd_tunnel/{tunnel_id}/token`
   returns the connector token. Put it in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`
   - same value Path A gets from the dashboard.
3. `PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations`
   with the ingress config (see "Why no local config.yml" in `README.md` for
   the exact shape and how to check whether a tunnel is dashboard-managed -
   this GET/PUT pattern is independently verified this session, against a
   real tunnel).
4. `POST https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records`
   with `{"type": "CNAME", "name": "chat", "content": "<tunnel_id>.cfargotunnel.com", "proxied": true}`.

Be honest with the human about provenance: steps 1, 2, and 4 are sourced
from Cloudflare's own API reference, not personally run end-to-end in this
repo yet. Step 3's GET/PUT pattern is independently verified. If step 1, 2,
or 4 doesn't behave as documented, say so plainly rather than papering over
it - don't claim success you haven't confirmed.

## Part C - resume once you have the token

1. Put the token in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
2. ```bash
   docker compose up -d cloudflared
   docker compose ps   # cloudflared should go "healthy" within ~30s
   ```
3. **Do not create a local `cloudflared/config.yml`.** This tunnel type is
   remotely managed - hostname routing lives entirely in the dashboard's
   Public Hostname tab from Part B. If you're ever unsure whether a given
   tunnel is dashboard-managed before adding local config, check:
   ```bash
   curl -s "https://api.cloudflare.com/client/v4/accounts/<account_id>/cfd_tunnel/<tunnel_id>/configurations" \
     -H "Authorization: Bearer <token>" | python3 -m json.tool
   ```
   `"source": "cloudflare"` means dashboard-managed - a local config file
   for that tunnel does nothing, even if it renders correctly on disk. This
   is a real, previously-hit failure mode, not a hypothetical.
4. Bootstrap accounts:
   - Temporarily set `ENABLE_SIGNUP=true` and `DEFAULT_USER_ROLE=user` in
     `.env`, `docker compose up -d --force-recreate openwebui`.
   - Ask the human to open `https://chat.<their-domain>` and create the
     admin account, then one account per person who needs access.
   - Set `ENABLE_SIGNUP=false`, remove/reset `DEFAULT_USER_ROLE`,
     `docker compose up -d --force-recreate openwebui` again. Confirm the
     signup option is gone from the login page.
5. Verify external reachability: ask the human to open
   `https://chat.<their-domain>` from their phone on cellular data, not the
   same WiFi/network you're running on - this proves the tunnel and DNS are
   both actually working, not just local networking.
6. If the human reports "can't resolve host" from the same machine you're
   running on, right after the tunnel/DNS just went live, that's almost
   certainly their OS's local DNS cache holding the earlier "doesn't exist
   yet" answer, not a real failure. `dig <hostname>` will show the record is
   fine well before `curl`/a browser catches up on that same machine. On
   macOS: `sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`
   (needs an interactive password prompt - you can't run this yourself,
   ask the human to).
7. Report back: tunnel healthy, accounts created, signup locked, external
   reachability confirmed (or explicitly flag if you couldn't get
   confirmation of the phone/cellular check - don't claim it silently).

## If asked to upgrade later

`ollama` and `openwebui` are bind-mounted to `./data/ollama` and
`./data/openwebui` on the host, not Docker-managed volumes - pulled models,
accounts, and chat history live in those plain folders, not inside the
container. `docker compose pull <service> && docker compose up -d <service>`
is always safe: it replaces the container's code, never `./data/`. Never
run `docker compose down -v` or manually delete anything under `./data/`
without being explicitly asked to - that's the one command that would
actually destroy it.
