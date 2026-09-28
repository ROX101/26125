# Free Demo Deployment — Cloudflare Tunnel

Zero cost, no signup, no new architecture — this exposes the exact setup
you already have running locally to a real public HTTPS URL, using
Cloudflare's free "Quick Tunnel" feature (no Cloudflare account needed).

**Why one tunnel, not two:** the backend now serves the built frontend
directly (same origin, same port), so there's nothing to configure across
two separate public URLs, no CORS to think about, and only one thing to
tunnel.

---

## Part 1 — Build the frontend for same-origin serving

```bash
cd bel-ui/frontend
echo "VITE_API_BASE=" > .env.production
npm run build
```

The empty `VITE_API_BASE` value tells the frontend to call `/api/...` as a
relative path rather than `http://localhost:4000/api/...` — since it'll be
served from the exact same origin as the API once tunneled.

## Part 2 — Point the backend at that build and start it

```bash
cd ../backend
npm run build
FRONTEND_DIST=../frontend/dist npm start
```

Confirm it's serving both: open `http://localhost:4000` in a browser on
your own machine — you should see the actual console UI, not just JSON.

## Part 3 — Install cloudflared

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared --version
```

## Part 4 — Start the tunnel

In a new terminal (leave the backend from Part 2 running):

```bash
cloudflared tunnel --url http://localhost:4000
```

Within a few seconds this prints a block containing a URL like:
```
https://some-random-words-1234.trycloudflare.com
```

**That URL is your live, public, shareable link.** Anyone who opens it
gets the exact same console UI, hitting your exact same Fabric network,
running on your machine — no cloud account, no payment, nothing installed
anywhere but here.

## Using it

- Send that link to anyone for the demo. Keep both terminals (backend,
  tunnel) running for as long as you want it reachable.
- Every click still does exactly what it's always done — real DIDs, real
  signature verification, real denied actions — the tunnel only changes
  *how someone reaches it*, not what's actually happening underneath.
- Closing either terminal takes the link down. Restarting
  `cloudflared tunnel` generates a **new** random URL each time — if you
  need a stable link across multiple sessions, that requires a free
  Cloudflare account and a named tunnel instead (a later upgrade, not
  needed to get a working link today).

## Honest limitations, so there are no surprises

- **This only works while your machine is on, connected, and both
  terminals are running.** It's not a 24/7 server — it's your local setup,
  temporarily reachable from anywhere.
- **The URL changes every time you restart the tunnel.** Fine for a live
  demo call; less convenient if you want to put a permanent link in a
  written report.
- **Performance depends on your own machine and internet connection** —
  not a concern for a live demo, worth knowing if someone stress-tests it.
