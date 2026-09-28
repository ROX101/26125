# Cloud Deployment Guide — Full Production

Moves the entire stack — Fabric network, chaincode, and backend — onto a
cloud VM, with the frontend deployed separately to a static host pointed
at that VM's public API.

## Architecture

```
Cloud VM (Ubuntu, Docker)
├── Fabric network (3 orgs, orderer, CAs) — unchanged from local setup
├── belid chaincode — unchanged
├── Backend API (Node/Express) — talks to Fabric via localhost, same as before
└── Nginx — reverse proxy, terminates HTTPS, forwards to the backend

Vercel (or similar)
└── Frontend (React) — calls the VM's public HTTPS URL instead of localhost
```

The backend stays colocated with the Fabric network on purpose — it keeps
every `localhost:7051`-style connection in `identities.json` working
completely unchanged. Only the *outside world's* path to the backend
changes (through Nginx, over HTTPS, on a real domain).

---

## Part 1 — Provision the VM

**Recommended: DigitalOcean Basic Droplet, 4 GB RAM / 2 vCPU (~$24/month)**
— Fabric's peer, orderer, and CA containers are memory-hungry enough that
anything smaller will struggle. DigitalOcean currently offers a $200 / 60
day free-trial credit for new accounts, which comfortably covers a
hackathon timeline.

1. Create a Droplet: **Ubuntu 24.04 LTS**, Basic plan, 4 GB / 2 vCPU,
   whichever datacenter region is closest to you or your judges.
2. Add your SSH key during creation (or use the provided root password).
3. Note the Droplet's public IP address.
4. SSH in:
   ```bash
   ssh root@<your-droplet-ip>
   ```

From here, every command runs **on the VM**, over this SSH session.

## Part 2 — Base tools, Docker, Node

Almost identical to the local WSL2 setup — same commands, just on a real
Ubuntu server instead of WSL2 (so no WSL2 install step, and Docker is
installed directly rather than via Docker Desktop):

```bash
apt update && apt upgrade -y
apt install -y curl git jq build-essential ufw

# Docker Engine
curl -fsSL https://get.docker.com | sh

# Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
```

## Part 3 — Firewall (do this before anything else is reachable)

Only SSH, HTTP, and HTTPS should ever be open to the public internet.
Fabric's own ports (7050-9054 and similar) must **never** be exposed —
only the backend process on this same machine needs them, via localhost.

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

## Part 4 — Fabric network, chaincode, and identities

Identical to the local guide (`docs/network-setup.md` Parts 5-9, and
`bel-ui/register-demo-identities.sh`) — same commands work unchanged on a
real Ubuntu server:

```bash
mkdir -p ~/bel-fabric && cd ~/bel-fabric
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh --fabric-version 2.5.16 docker samples binary

cd fabric-samples/test-network
./network.sh up createChannel -c belchannel -ca
cd addOrg3 && ./addOrg3.sh up -c belchannel && cd ..
```

Then deploy `belid` and run through the bootstrap/role-definition sequence
exactly as in `docs/replication-guide.md`, and finally run
`register-demo-identities.sh` exactly as in `bel-ui/SETUP.md`. Nothing
about these steps changes just because you're on a cloud VM instead of
your own machine.

## Part 5 — Keep the network running across reboots

By default, Fabric's containers don't automatically resume if the VM
restarts. Add a small systemd unit that starts them back up:

```bash
cat > /etc/systemd/system/bel-fabric.service << 'EOF'
[Unit]
Description=Resume BEL Fabric network containers
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=true
ExecStart=/usr/bin/bash -c 'docker start $(docker ps -a --filter "name=orderer.example.com" --filter "name=peer0.org" --filter "name=ca_org" -q)'

[Install]
WantedBy=multi-user.target
EOF

systemctl enable bel-fabric.service
```

This only *resumes* already-created containers (their ledger state is
preserved) — it does not recreate the network from scratch.

## Part 6 — Backend as a persistent service

```bash
cd ~/bel-ui/backend
npm install
npm run build
```

Run it under systemd so it restarts automatically on crash or reboot:

```bash
cat > /etc/systemd/system/bel-backend.service << 'EOF'
[Unit]
Description=BEL demo backend API
After=bel-fabric.service
Requires=bel-fabric.service

[Service]
Type=simple
WorkingDirectory=/root/bel-ui/backend
Environment=IDENTITIES_PATH=/root/bel-ui/identities.json
Environment=FRONTEND_ORIGIN=https://YOUR-FRONTEND-DOMAIN.vercel.app
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now bel-backend.service
systemctl status bel-backend.service
```

(Fill in `FRONTEND_ORIGIN` once you know your actual Vercel URL from Part 8
— you can restart the service to update it: `systemctl restart bel-backend`.)

## Part 7 — Nginx + HTTPS in front of the backend

You'll need a domain (or subdomain) pointed at the VM's IP — a free option
like DuckDNS works fine if you don't want to buy one. Let's Encrypt
requires a real hostname; a bare IP address can't get a certificate.

```bash
apt install -y nginx certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/bel-api << 'EOF'
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

ln -s /etc/nginx/sites-available/bel-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Issues and auto-configures the HTTPS certificate
certbot --nginx -d api.yourdomain.com
```

Verify from your own laptop (not the VM):
```bash
curl https://api.yourdomain.com/api/config
```
Should return the same JSON you saw locally.

## Part 8 — Deploy the frontend (Vercel)

```bash
cd bel-ui/frontend
echo "VITE_API_BASE=https://api.yourdomain.com" > .env.production
```

Push this repo to GitHub, then in Vercel: **New Project → import the repo →
set root directory to `frontend/`** → deploy. Vercel auto-detects Vite.

Once deployed, copy the Vercel URL back into `FRONTEND_ORIGIN` on the VM
(Part 6) and restart the backend service.

## Security notes specific to this deployment

- **Never expose Fabric's own ports publicly** — only Nginx (443) and SSH
  (22) should be open; Part 3's firewall rules enforce this.
- **`identities.json` never leaves the VM** — it's read only by the
  backend process; Nginx never serves it as a static file, and it's
  gitignored so it can't accidentally end up in the repo you push to
  GitHub for Vercel.
- **Rotate the demo identities' passwords** if this VM will stay up beyond
  the hackathon — `register-demo-identities.sh` uses simple fixed passwords
  suitable for a demo, not long-term production use.
- **`FRONTEND_ORIGIN` should be the exact Vercel URL**, never `*`, once
  real signing keys are involved end to end.

## Verifying the whole thing works

From any browser, anywhere:
1. Open the Vercel frontend URL.
2. Click through Admin / Manager / Auditor / User.
3. Try an action as each — Admin succeeds, the other three get denied,
   exactly like the local demo, except now this is running on a real
   server, reachable by anyone with the link, not just on your laptop.
