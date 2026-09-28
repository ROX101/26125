# REPLICATION GUIDE — BEL Identity, RBAC &amp; Asset Registry Platform

**SIH26125 — Bharat Electronics Limited.** This is the complete, from-zero guide to rebuild this entire stack on a fresh machine: the Hyperledger Fabric network, the `belid` chaincode (DID Registry + RBAC Engine + Asset Registry + Audit Trail), the Express backend, and the React multi-portal frontend.

Follow the parts in order — each one depends on the previous. Every command below was actually run and verified working during development of this project; where something failed the first time, that failure and its fix are called out explicitly in **Part 13 — Troubleshooting**, because you are likely to hit the same thing.

---

## 0. Architecture, in one picture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Hyperledger Fabric network ("test-network")                        │
│  ─────────────────────────────────────────────                      │
│  Org1 + Org2 peers, one orderer, two Fabric CAs, channel "belchannel"│
│                                                                       │
│  Chaincode "belid" (TypeScript, one package, four contracts):       │
│    • DIDRegistryContract   — 4-state identity lifecycle             │
│    • RBACEngineContract    — role definitions + grants + enforcement│
│    • AssetRegistryContract — metadata-only asset lifecycle          │
│    • AuditContract         — explicit on-chain audit log            │
└─────────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │ Fabric Gateway gRPC (per-identity)
                                   │
┌─────────────────────────────────────────────────────────────────────┐
│  bel-ui/backend  (Node + Express + @hyperledger/fabric-gateway)     │
│  One gRPC connection per role (ADMIN/MANAGER/AUDITOR/USER), each    │
│  signing with that identity's own cert+key. REST API on :4000.      │
│  Also stores uploaded asset FILES on local disk (only the SHA-256   │
│  hash + metadata ever goes on-chain).                                │
└─────────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │ fetch() over HTTP
                                   │
┌─────────────────────────────────────────────────────────────────────┐
│  bel-ui/frontend  (React 18 + Vite + TypeScript + react-router-dom) │
│  A login screen (pick which of the 4 real identities to act as),   │
│  then four routed portals — /admin, /manager, /auditor, /user —    │
│  each with its own sidebar, pages, and real chaincode-backed forms. │
└─────────────────────────────────────────────────────────────────────┘
```

The key design decision throughout: **nothing is faked in the UI.** Every button calls a real chaincode transaction, signed by that role's real Fabric identity. A "permission denied" in the browser is a genuine cryptographic/RBAC rejection from the ledger, not a client-side `if` statement.

---

## 1. Prerequisites

| Tool | Version | Check with |
|---|---|---|
| OS | Linux, macOS, or Windows via **WSL2** (this was built on Windows 11 + WSL2 Ubuntu) | — |
| Docker + Docker Compose | any recent version | `docker --version` |
| Node.js | 18+ (verified on 22) | `node --version` |
| npm | ships with Node | `npm --version` |
| Git | any recent version | `git --version` |
| curl, jq | for the Fabric install script | `curl --version`, `jq --version` |

**If you're on Windows:** do all of this inside **WSL2** (Ubuntu), not native Windows/PowerShell. Docker Desktop must have WSL2 integration turned on for whichever distro you use. Every command below is a Linux/bash command run inside that WSL2 shell.

**A note on paths in this guide:** commands below assume you keep the two source folders (`chaincode/` and `bel-ui/`) somewhere on your WSL2 filesystem or a mounted Windows drive (e.g. `/mnt/d/...`), and the Fabric network itself under your Linux home, e.g. `~/bel-fabric/`. Adjust paths to match your own layout — just be consistent, because `identities.json` (Part 7) hardcodes absolute paths.

---

## 2. Bring up the Hyperledger Fabric test network

```bash
mkdir -p ~/bel-fabric && cd ~/bel-fabric

# Pulls down Fabric's binaries, Docker images, and the fabric-samples repo
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh --fabric-version 2.5.16 docker samples binary

cd fabric-samples/test-network

# Bring up a 2-org network (Org1 + Org2), with Fabric CAs (not cryptogen-only),
# and create the channel "belchannel"
./network.sh up createChannel -c belchannel -ca
```

Expected tail of output: `Channel 'belchannel' joined`.

**Important — this deployment used exactly this 2-org network.** `addOrg3.sh` was never run. If you add a third org, you change the endorsement policy (chaincode's default is majority-of-channel-members), and every `--peerAddresses`/`--tlsRootCertFiles` pair in `register-demo-identities.sh` and in Part 6 below will need a third pair added for Org3 to match. Simplest path: don't add Org3 unless you specifically need it.

Sanity-check the network is actually up:
```bash
docker ps --format '{{.Names}}'
```
You should see `orderer.example.com`, `peer0.org1.example.com`, `peer0.org2.example.com`, and two `ca_org*` containers running.

---

## 3. Build the chaincode

Copy the `chaincode/` folder from this repo into your project workspace (or clone your own repo containing it), then:

```bash
cd /path/to/chaincode
npm install
npm run build
```

Expected: no errors, and a `dist/` folder appears with compiled `.js` files. `package-lock.json` should be committed alongside `package.json` — Fabric's peer builds the chaincode's Docker image from source, and a missing lockfile there is a classic "Cannot find module 'fabric-shim'" trap at *container* build time (not local build time).

Optional sanity check that the contracts actually load:
```bash
node -e "
const { contracts } = require('./dist/index.js');
console.log('Contracts loaded:', contracts.map(c => c.name));
"
```
Expected: `Contracts loaded: [ 'DIDRegistryContract', 'RBACEngineContract', 'AssetRegistryContract', 'AuditContract' ]`.

The full source for every chaincode file is in **Appendix A**. Here's what each one is responsible for:

| File | Contract / role |
|---|---|
| `types.ts` | Every shared TypeScript interface/enum: `DIDDocument`, `DIDStatus`, `Role`, `RoleAssignment`, `AssetDocument`, `AssetStatus`, `AssetAccessGrant`, `DelegationRequest`, `DelegationStatus`, `AuditEvent` |
| `permissions.ts` | The fixed permission catalog (`PERMISSIONS` map) — the single source of truth for every permission string the RBAC engine will accept |
| `didRegistry.ts` | `DIDRegistryContract` — DID derivation, the 4-state onboarding lifecycle, identity directory queries |
| `rbac.ts` | `RBACEngineContract` — role definitions, grants/revokes, the core `requirePermission`/`hasPermission` enforcement functions every other contract calls |
| `asset.ts` | `AssetRegistryContract` — upload/approve/reject/mint lifecycle, access grants, delegation requests |
| `audit.ts` | `AuditContract` — the explicit on-chain audit log (`recordAudit`, `ListEvents`, `ListMyEvents`) |
| `index.ts` | Registers all four contract classes as the chaincode package's exported `contracts` array |

---

## 4. Deploy the chaincode onto the channel

From `fabric-samples/test-network`:

```bash
./network.sh deployCC -ccn belid -ccp /path/to/chaincode -ccl typescript -c belchannel
```

`-ccp` must be an **absolute path** to the `chaincode/` folder (the one containing `package.json` and `src/`) — a relative path resolved from inside `test-network/` is the single most common way this command fails with "Path to chaincode does not exist."

This one command does the full lifecycle dance for you (package → install on both peers → approve for both orgs → check commit readiness → commit → verify) and prints:
```
Committed chaincode definition for chaincode 'belid' on channel 'belchannel':
Version: 1.0, Sequence: 1, ...
```

**Every time you change chaincode source and want to redeploy, re-run this exact command.** `deployCC` auto-detects that a definition already exists and bumps the sequence number for you (1 → 2 → 3 → ...) — you never need to compute the sequence number yourself.

---

## 5. Bootstrap the genesis Admin identity

This has to be done manually with `peer chaincode invoke`, using **your own Org1 Admin identity** (the one `network.sh` already set up for you), because at this point zero identities and zero roles exist on the ledger yet.

Set up your shell environment as Org1:
```bash
export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/../config
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051
```

Define the endorsement variables once — **you need both Org1 and Org2 peer addresses on every subsequent `invoke`**, because the chaincode's default endorsement policy is majority-of-channel-members (2-of-2, since this is a 2-org network). A single-peer `invoke` will appear to succeed (no client-side error) but silently fail final commit validation — this bit us once during development; see Part 13 — Troubleshooting.

```bash
ORDERER_CAFILE="${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"
PEER1_TLS="${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
PEER2_TLS="${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"
ORDERER="-o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile ${ORDERER_CAFILE}"
ENDORSE="--peerAddresses localhost:7051 --tlsRootCertFiles ${PEER1_TLS} --peerAddresses localhost:9051 --tlsRootCertFiles ${PEER2_TLS}"
```

**Step 1 — InitAdmin** (creates the genesis identity, already ACTIVE):
```bash
peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
  -c '{"function":"DIDRegistryContract:InitAdmin","Args":["Corporate Office"]}'
```

Look in the response for the transaction's return value, or query it back:
```bash
peer chaincode query -C belchannel -n belid -c '{"function":"DIDRegistryContract:WhoAmI","Args":[]}'
```
This prints your genesis DID, something like `"did:fabric:8ae10b9e01d39425e7d6650f431c0d7c"`. **Save this value** — you'll need it in Part 7.

**Step 2 — BootstrapAdmin** (one-time only; creates the `ADMIN` role with a starter permission set and grants it to your genesis DID — this is what breaks the chicken-and-egg problem of "granting roles requires `MANAGE_ROLE`, but nobody has any role yet"):
```bash
peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
  -c '{"function":"RBACEngineContract:BootstrapAdmin","Args":[]}'
```

This creates role `ADMIN` with permissions `MANAGE_IDENTITY, MANAGE_ROLE, MINT_ASSET` (hardcoded in `rbac.ts`'s `BootstrapAdmin`), scoped `*`, and assigns it to your genesis DID. It **permanently refuses to run again** the instant any role assignment exists on the ledger — from here on, use `DefineRole`/`GrantRole` instead.

Verify:
```bash
peer chaincode query -C belchannel -n belid \
  -c '{"function":"RBACEngineContract:HasPermission","Args":["<your genesis DID>","MANAGE_IDENTITY","*"]}'
```
Expected: `true`.

---

## 6. Define the four roles and give the genesis Admin its full permission set

`BootstrapAdmin` only gives ADMIN three permissions. The Admin portal in this UI also needs `VIEW_AUDIT` (to see its own Audit Trail page), so redefine `ADMIN` with the complete set, then define the other three roles. `DefineRole` is idempotent-by-overwrite — calling it again for `ADMIN` just replaces the role's permission list.

```bash
# ADMIN — identity + role management, minting, full audit visibility
peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
  -c '{"function":"RBACEngineContract:DefineRole","Args":["ADMIN","Admin","MANAGE_IDENTITY,MANAGE_ROLE,MINT_ASSET,VIEW_AUDIT","*"]}'

# MANAGER — approves assets and delegations within their own org unit
peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
  -c '{"function":"RBACEngineContract:DefineRole","Args":["MANAGER","Manager","APPROVE_ASSET,GRANT_ACCESS,REVOKE_ACCESS,APPROVE_DELEGATION,VIEW_AUDIT","*"]}'

# AUDITOR — read-only, but across every org unit (granted scope "*" later, in Part 7)
peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
  -c '{"function":"RBACEngineContract:DefineRole","Args":["AUDITOR","Auditor","VIEW_AUDIT,VIEW","*"]}'

# USER — uploads their own assets, requests delegation to share them
peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
  -c '{"function":"RBACEngineContract:DefineRole","Args":["USER","User","UPLOAD_ASSET,REQUEST_ACCESS_DELEGATION,VIEW,DOWNLOAD","*"]}'
```

> **Verify against your own ledger, don't just trust this file.** The exact permission strings above are what this deployment was built and tested against, reconstructed from the shipped frontend's actual page-by-page permission requirements (cross-checked against `server.ts` and each chaincode contract's `requirePermission` calls). Confirm — or correct — them any time with:
> ```bash
> peer chaincode query -C belchannel -n belid -c '{"function":"RBACEngineContract:ListRoles","Args":[]}'
> ```
> If your copy differs, that query's output is the ground truth — update this file (or your own notes) to match it, since the frontend pages are gated on these exact permission names.

**Now grant the genesis identity the ADMIN role** (BootstrapAdmin already did this once with the 3-permission set — since you just overwrote the role definition itself with `DefineRole` above, the existing assignment automatically now resolves against the new 4-permission list, no re-grant needed. If you skipped `BootstrapAdmin` for some reason, grant it explicitly):
```bash
peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
  -c '{"function":"RBACEngineContract:GrantRole","Args":["<your genesis DID>","ADMIN","*",""]}'
```

Sanity-check enforcement actually works — this is the core proof-of-concept moment:
```bash
# Should succeed (genesis identity holds MANAGE_ROLE):
peer chaincode query -C belchannel -n belid \
  -c '{"function":"RBACEngineContract:HasPermission","Args":["<your genesis DID>","MANAGE_ROLE","*"]}'
# -> true

# Should fail (a DID that was never granted anything):
peer chaincode query -C belchannel -n belid \
  -c '{"function":"RBACEngineContract:HasPermission","Args":["did:fabric:doesnotexist","MANAGE_ROLE","*"]}'
# -> false
```

---

## 7. Register the three demo identities (Manager, Auditor, User)

The genesis Admin from Part 5 is identity #1. The other three are separate, real Fabric identities enrolled through Org1's CA. `bel-ui/register-demo-identities.sh` (full source in **Appendix A**) automates this. Run it from `fabric-samples/test-network`:

```bash
cp /path/to/bel-ui/register-demo-identities.sh .
chmod +x register-demo-identities.sh
./register-demo-identities.sh
```

What it does, in order:
1. Registers and enrolls `manager-demo`, `auditor-demo`, `user-demo` via `fabric-ca-client`, each getting its own MSP folder (cert + private key) under `organizations/peerOrganizations/org1.example.com/users/<name>@org1.example.com/msp/`.
2. Has each new identity call `DIDRegistryContract:WhoAmI` (a query, using its own freshly-enrolled MSP) to discover its own derived DID.
3. Switches back to the Org1 Admin identity and, for each of the three: `RequestOnboarding` → `ActivateIdentity` → `GrantRole`.
4. Writes `identities.json` in the current directory with all three real DIDs, cert paths, and key paths filled in.

**Org-unit vs. grant-scope distinction** (see the script's `ROLE_ORGUNIT` vs `ROLE_GRANTSCOPE` maps): Manager and User are onboarded *and* granted their role scoped to their own org unit (`Bangalore Complex`, `Ghaziabad`). Auditor is onboarded with org unit `Corporate Office` but **granted with scope `*`** — because "Audit Committee tier, read-only access to the full immutable trail" means across every unit, not just the one the identity happens to belong to. Getting this wrong (scoping Auditor's grant to its own org unit) means every `VIEW_AUDIT`/`MANAGE_IDENTITY`-gated query that checks scope `'*'` specifically will reject the Auditor — this was an actual bug caught and fixed during development.

**One manual step this script cannot do for you:** open the `identities.json` it just wrote and replace `"REPLACE_WITH_YOUR_GENESIS_DID"` under `ADMIN.did` with the actual value from Part 5, Step 1.

---

## 8. Move `identities.json` into place

The backend expects `identities.json` to sit **one level above** `backend/` and `frontend/` — i.e. directly inside `bel-ui/`, not inside either subfolder:

```bash
cp identities.json /path/to/bel-ui/
```

`identities.example.json` (Appendix A) shows the exact expected shape if you ever need to hand-write or fix this file. **Never commit the real `identities.json`** — it has absolute, machine-specific filesystem paths and is already covered by `bel-ui/.gitignore` (Appendix A).

### The keystore-filename gotcha (read this before you debug a confusing ENOENT)

`cryptogen` (and `fabric-ca-client` enrollment) names every identity's private-key file with a **random hex hash** — e.g. `813c0c5a57395db7f724a33b66b4ce6315eaeac1f20cb110a58513815d75e182_sk` — never a fixed name like `priv_sk`. That hash **changes every time the network is regenerated** (`network.sh down` + `up`). `register-demo-identities.sh` (and the example file) write `keyPath` ending in `.../keystore/priv_sk` as a placeholder-style convention, not a literal guarantee.

This codebase's `backend/src/gateway.ts` (Appendix A) handles this correctly already: `resolveKeyFile()` treats `keyPath` as best-effort — if that exact file exists, use it; otherwise, fall back to whatever single `*_sk` file actually exists in that directory. **You should never need to hand-edit a keystore filename into `identities.json`** as long as you're using this version of `gateway.ts`. If you ever see `ENOENT ... keystore/priv_sk`, it means you're running an older build of the backend — rebuild it (`npm run build`) and restart.

---

## 9. Run the backend

```bash
cd /path/to/bel-ui/backend
npm install
npm run build
npm start
```

Expected output, all three lines:
```
BEL demo API listening on http://localhost:4000
Reading identities from /path/to/bel-ui/identities.json
Storing uploaded files in /path/to/bel-ui/backend/uploads
```

Quick check it's actually talking to the ledger:
```bash
curl http://localhost:4000/api/config
```
Should return JSON with all four roles, their real DIDs, org units, and the permission catalog.

**Every time you change backend TypeScript source, you must `npm run build` again before `npm start` — `npm start` runs the *compiled* `dist/server.js`, not your source directly.** Running the old compiled build after a source change is a very easy mistake (it looks fine on startup, then specific new routes 404) — this happened during development; see Part 13 — Troubleshooting.

Full source for `gateway.ts` and `server.ts` is in Appendix A. In short:
- `gateway.ts` — one Fabric Gateway gRPC connection per role, each signing with that role's own cert+key from `identities.json`; exposes typed handles to all four chaincode contracts.
- `server.ts` — the Express REST API. Every route takes a `?role=ADMIN|MANAGER|AUDITOR|USER` (or `role` in the POST body), resolves that role's Gateway connection, and calls the matching chaincode transaction. File uploads go through `multer` in memory, get SHA-256 hashed, submitted to `AssetRegistryContract:UploadAsset` for the hash+metadata, and only then written to local disk as `<assetId>__<originalFileName>`.

---

## 10. Run the frontend

In a **second terminal**:
```bash
cd /path/to/bel-ui/frontend
npm install
npm run dev
```
Open the printed URL (`http://localhost:5173`). You should land on the login screen — a navy/blue split-screen with the BEL logo on the left and four role cards on the right.

Full source for every frontend file is in Appendix A; the directory tree:
```
frontend/src/
├── main.tsx              — React root, imports index.css
├── App.tsx               — <BrowserRouter> + all routes (login + 4 portal trees)
├── Login.tsx             — role picker / "sign in" screen
├── PortalLayout.tsx      — shared shell: sidebar nav + topbar, per role
├── navConfig.ts          — which nav items each role's sidebar shows
├── session.ts            — localStorage-backed "which role am I" + per-role accent colors
├── api.ts                — every typed fetch() call to the backend
├── index.css             — the entire design system (BEL blue/navy theme)
├── assets/bel-logo.png   — the BEL logo (transparent background), also bel-logo.jpg (original)
├── components/
│   ├── Icon.tsx          — small inline-SVG icon set used in the sidebars
│   ├── common.tsx        — shared primitives: DataTable, StatusPill, Button, Modal, useLoader, etc.
│   └── AuditTable.tsx    — the audit-event table, reused by 4 different pages
└── pages/
    ├── admin/            — Dashboard, Directory, Verification, MintQueue, AssetRegistry, Roles, AuditTrail, Network
    ├── manager/          — Dashboard, ApprovalQueue, Assets, TeamMembers, AuditLog
    ├── auditor/          — Dashboard, AuditEvents, AssetHistory, IdentityHistory
    └── user/             — Dashboard, MyAssets, Upload, Delegations, RecentActivity
```

**Legacy files you can ignore/delete:** `ActionPanel.tsx`, `ActivityLog.tsx`, `IdentityRail.tsx`, `PermissionGrid.tsx` are leftovers from an earlier single-page sandbox demo. Nothing in the current `App.tsx` imports them; they're dead code, not part of this replication.

---

## 11. End-to-end smoke test

With both the backend and frontend running:

1. Open `http://localhost:5173/login`. All four role cards should show real DIDs (not `did:fabric:...`  placeholders).
2. Click **Admin** → lands on `/admin/dashboard` with real stat counts. Visit **Directory** (should list every DID including the genesis one), **Verification**, **Mint Queue**, **Asset Registry**, **Roles & Policies** (should show all 4 roles with the permission lists from Part 6), **Audit Trail** (should show `INIT_ADMIN`, `BOOTSTRAP_ADMIN`, `DEFINE_ROLE` ×4, `AUTHENTICATE` events at minimum).
3. Switch identity → **User**. Go to **Upload**, pick any small file, submit. You should get back an `assetId` and SHA-256 hash. Check **My Assets** — it should appear with status `PENDING_APPROVAL`.
4. Switch to **Manager**. **Approval Queue** should show that asset. Approve it.
5. Switch to **Admin**. **Mint Queue** should now show it (status `PENDING_MINT`). Mint it.
6. Switch to **Auditor**. **Audit Events** should now show the full chain: `UPLOAD_ASSET` → `APPROVE_ASSET` → `MINT_ASSET`, each with the correct actor DID.

If every one of those steps works without a permission error you didn't expect, the replication is complete and correct.

---

## 12. Known, deliberate gaps (not bugs — just not built yet)

These exist in the shipped UI and are worth knowing about rather than mistaking for something broken:

- **Manager → Team Members** and **Auditor → Identity History** and **User → Recent Activity** originally hit permission walls (`ListIdentities` was gated to `MANAGE_IDENTITY` only, and there was no self-scoped audit query). This was fixed in a later chaincode revision (sequence 4 in development) by: relaxing `ListIdentities` to accept `MANAGE_IDENTITY` **or** `VIEW_AUDIT`; adding an ungated, org-scoped `ListIdentitiesByOrgUnit`; and adding a self-scoped `ListMyEvents` to `AuditContract` that always resolves the caller's own DID server-side. All three are already in the `didRegistry.ts` / `audit.ts` source in Appendix A — just make sure you deploy at sequence ≥ 4 worth of changes (i.e., include these functions) if you're rebuilding from scratch, and you won't hit the gap at all.
- **No dedicated Manager "approve delegation request" page exists yet.** `AssetRegistryContract:ApproveDelegation`/`RejectDelegation` are implemented and gated (`APPROVE_DELEGATION`), and `User → Delegations` shows requests the user made — but nothing in the Manager portal currently surfaces *incoming* delegation requests for them to act on. This is a real, un-built feature gap, not a permission issue.
- **Manager's "Upload Asset" capability**: some early design mockups implied Manager could upload, but the deployed `MANAGER` role (see Part 6) does not include `UPLOAD_ASSET` — only `USER` does. This was a deliberate decision during development, not an oversight: the frontend doesn't currently expose an upload button on the Manager portal, so there's no dangling denied-button either.
- **Admin → Network page** shows org-unit counts derived from the identity registry, not live Fabric peer/orderer telemetry (block height, endorsing peers, etc.) — that would need a separate monitoring integration on top of the Gateway connection.

---

## 13. Troubleshooting — real problems hit during development, and their fixes

**"Path to chaincode does not exist" on `deployCC`**
`-ccp` was a relative path resolved from inside `test-network/`. Fix: always pass an absolute path to the chaincode folder.

**TLS handshake failure (`certificate signed by unknown authority`) when deploying**
Happens if you deploy chaincode against a network that's been up a long time across multiple `network.sh` invocations without a clean reset, or if crypto material and the running containers have drifted out of sync. Fix: `./network.sh down` then `./network.sh up createChannel -c belchannel -ca` for a clean slate, then redeploy. This also clears any stale on-chain identity records from a previous chaincode iteration that used different permission names — useful if you're iterating on the permission catalog itself.

**`InitAdmin`/`BootstrapAdmin` says "DID ... is not active - call InitAdmin first", even though `InitAdmin` appeared to succeed**
This means the `InitAdmin` invoke was under-endorsed — it was submitted with only one org's `--peerAddresses`/`--tlsRootCertFiles` pair, but the chaincode's default endorsement policy needs a majority of channel members (2-of-2 on this 2-org network). An under-endorsed transaction can still print a client-side "success" but then fails final commit validation on the peers, silently, so nothing actually got written. Fix: always include **both** orgs' `--peerAddresses`/`--tlsRootCertFiles` pairs (the `$ENDORSE` variable in Part 5) on every `invoke` that writes state.

**Auditor can't see anything, even with `VIEW_AUDIT` defined on its role**
Check the *scope* the role was granted with, not just whether the role has the permission. `VIEW_AUDIT`/`MANAGE_IDENTITY` checks in this codebase are hardcoded to require scope `'*'` specifically (see `ListEvents`, `ListIdentities`). If Auditor's `GrantRole` call used its own org unit as the scope instead of `'*'`, every one of those checks will reject it even though the role definition itself looks correct. Fix: `RevokeRole` then `GrantRole` again with scope `'*'` — `register-demo-identities.sh`'s `ROLE_GRANTSCOPE` map (Appendix A) already gets this right for a fresh setup.

**Frontend logs in, but every API call 404s (only `/api/config` still works)**
The backend is running a **stale build** — `npm start` runs `dist/server.js`, compiled from source at whatever point `npm run build` was last run. If you edited `server.ts` after that, the new routes simply don't exist in `dist/` yet. Fix: `npm run build` again, then restart the backend.

**`EADDRINUSE: address already in use :::4000` when starting the backend**
An older backend process (from before you rebuilt) is still bound to the port. Fix:
```bash
lsof -i :4000
kill -9 <PID>
npm start
```

**`ENOENT ... keystore/priv_sk` from the backend**
Covered in detail in Part 8. In short: that literal filename almost never exists; `gateway.ts`'s `resolveKeyFile()` already works around it by scanning the keystore directory for whatever `*_sk` file is actually there. If you hit this, you're running an older backend build — rebuild and restart.

**A duplicate/orphaned file like `gateway-1.ts` appears next to `gateway.ts`**
Harmless — an artifact of how files were transferred onto the development machine at one point, not something the running app ever imports. Safe to delete once you're confident `gateway.ts` itself has the content you expect.

---

## Appendix A — full source, every file

The complete contents of every file in the repository follow, one per section, exactly as deployed.

### `chaincode/package.json`

```json
{
  "name": "bel-identity-rbac-chaincode",
  "version": "0.1.0",
  "description": "BEL SIH26125 - DID Registry and RBAC Engine chaincode",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "fabric-chaincode-node start"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "fabric-contract-api": "^2.5.4",
    "fabric-shim": "^2.5.4"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "@types/node": "^20.11.0"
  }
}
```

### `chaincode/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2019",
    "module": "CommonJS",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": [
    "src/**/*.ts"
  ]
}
```

### `chaincode/src/types.ts`

```typescript
/**
 * Shared types for the BEL DID Registry, RBAC Engine, Asset Registry, and
 * Audit Log chaincode.
 *
 * Design notes (from the research pass before this code was written):
 * - DID documents are DELIBERATELY minimal (public-key binding + status +
 *   org scope only) per India's DPDP Act 2023 / DPDP Rules 2025 guidance:
 *   regulators expect avoidance of personal data on an immutable ledger
 *   where it isn't technically necessary. No name, no contact info, no
 *   documents live here - those stay off-chain.
 * - The DID itself is derived from the submitter's Fabric client identity
 *   (see didRegistry.ts -> deriveDID()), not a separately generated key
 *   pair. This is the lightweight option from the DID research: it is
 *   cryptographically backed by Fabric's own MSP/TLS layer today. A bridge
 *   to a full W3C DID Core 1.0 document (via Hyperledger Aries/Identus) is
 *   a documented Phase 2 stretch goal, not something faked here.
 *
 * DIDStatus is a 4-state onboarding lifecycle (see didRegistry.ts):
 *   PENDING -> ACTIVE -> SUSPENDED -> ACTIVE (reversible) or DEACTIVATED
 *   (terminal). Only ACTIVE identities pass RBAC checks.
 *
 * Assets are DELIBERATELY metadata-only on-chain: the actual file bytes
 * live off-chain (see bel-ui/backend's local disk storage), and only a
 * SHA-256 integrity hash + lifecycle status is recorded here. This keeps
 * the ledger light and matches the DPDP-minimization principle above.
 */

export enum DIDStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

export interface DIDDocument {
  did: string;          // e.g. did:fabric:<hash of the Fabric client identity>
  orgUnit: string;       // a real BEL unit, e.g. "Bangalore Complex", "Ghaziabad"
  status: DIDStatus;
  createdAt: string;     // tx timestamp (ledger time, not client clock)
  createdBy: string;     // DID of whoever filed the onboarding request (or self, for genesis)
}

export interface Role {
  roleId: string;         // one of ADMIN | MANAGER | AUDITOR | USER - fixed by the PS text
  name: string;           // display name, can vary per dept, e.g. "R&D Manager"
  permissions: string[];  // keys from the permission catalog, see permissions.ts
  orgScope: string;       // which BEL unit this role definition applies to ("*" = all units)
}

export interface RoleAssignment {
  did: string;
  roleId: string;
  orgScope: string;          // must match (or be covered by) the role's own orgScope
  expiresAt: string | null;  // ISO timestamp, or null = no expiry
  assignedBy: string;        // DID of the Admin who granted this
  assignedAt: string;
}

/**
 * Asset lifecycle: PENDING_APPROVAL (just uploaded) -> PENDING_MINT
 * (Manager approved, awaiting Admin) -> ACTIVE (Admin minted). REJECTED is
 * a terminal dead-end from PENDING_APPROVAL if a Manager declines it.
 */
export enum AssetStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  PENDING_MINT = 'PENDING_MINT',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
}

export interface AssetDocument {
  assetId: string;          // e.g. AST-XXXXXXXX
  fileName: string;
  sha256Hash: string;       // integrity hash of the off-chain file bytes
  orgScope: string;         // BEL unit this asset belongs to
  status: AssetStatus;
  uploadedBy: string;       // DID
  createdAt: string;
  approvedBy: string | null;  // DID of the Manager who approved/rejected it
  approvedAt: string | null;
  rejectionReason: string | null;
  mintedBy: string | null;    // DID of the Admin who minted it
  mintedAt: string | null;
}

/** Per-asset access grant, on top of whatever a caller's RBAC role gives
 * them in that org scope - lets a Manager (or an approved delegation
 * request) hand one specific DID VIEW/DOWNLOAD on one specific asset. */
export interface AssetAccessGrant {
  assetId: string;
  did: string;
  permissions: string[];   // subset of VIEW / DOWNLOAD
  grantedBy: string;
  grantedAt: string;
}

export enum DelegationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface DelegationRequest {
  requestId: string;
  assetId: string;
  requestedBy: string;      // DID that wants someone else granted access
  targetDID: string;        // DID that would receive access
  permissionsCSV: string;   // requested permissions, e.g. "VIEW,DOWNLOAD"
  status: DelegationStatus;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export type AuditResult = 'SUCCESS' | 'FAILURE';

export interface AuditEvent {
  id: string;
  actor: string;      // DID that performed the action
  action: string;      // e.g. "MINT_ASSET", "AUTHENTICATE"
  target: string;      // whatever the action was performed on (DID, asset ID, role ID, or "")
  result: AuditResult;
  message?: string;
  timestamp: string;
}
```

### `chaincode/src/permissions.ts`

```typescript
/**
 * Permission catalog, grounded in BEL's own 11 documented duty categories
 * (HR, Legal, Medical, Finance, Marketing, Licensing, Vigilance, R&D,
 * Production, Quality Management, Supply Chain) from BEL's real
 * "Powers & Duties" document. Each permission is tagged with the duty
 * category it belongs to, so a Role is composed as "grant this DID
 * MINT_ASSET, scoped to R&D" rather than a vague generic grant.
 *
 * This is the current catalog (replaces the earlier ISSUE_DID/REVOKE_DID/
 * DEFINE_ROLE/GRANT_ROLE/REVOKE_ROLE/... catalog): identity and role
 * administration are each consolidated into a single permission
 * (MANAGE_IDENTITY, MANAGE_ROLE), and the asset-side permissions are
 * declared now - CREATE_ASSET's replacements (MINT_ASSET, APPROVE_ASSET,
 * UPLOAD_ASSET) and the access-delegation permissions - so RBAC role
 * definitions can reference them before the Asset Registry / Approval
 * Workflow contracts exist.
 */

export interface PermissionDef {
  key: string;
  category: string; // one of BEL's 11 real duty categories
  description: string;
}

export const PERMISSIONS: Record<string, PermissionDef> = {
  MANAGE_IDENTITY:           { key: 'MANAGE_IDENTITY',           category: 'HR',                  description: 'Onboard, activate, suspend, and deactivate DIDs' },
  MANAGE_ROLE:               { key: 'MANAGE_ROLE',               category: 'HR',                  description: 'Define roles and grant/revoke role assignments' },
  MINT_ASSET:                { key: 'MINT_ASSET',                category: 'Production',          description: 'Mint a new asset token (Step 4)' },
  APPROVE_ASSET:             { key: 'APPROVE_ASSET',             category: 'Production',          description: 'Approve a pending asset action, e.g. a transfer (Step 5)' },
  GRANT_ACCESS:              { key: 'GRANT_ACCESS',              category: 'Legal',               description: 'Grant another DID access to an asset (Step 5)' },
  REVOKE_ACCESS:             { key: 'REVOKE_ACCESS',             category: 'Legal',               description: 'Revoke a previously-granted asset access (Step 5)' },
  APPROVE_DELEGATION:        { key: 'APPROVE_DELEGATION',        category: 'Legal',               description: 'Approve a pending access-delegation request (Step 5)' },
  VIEW_AUDIT:                { key: 'VIEW_AUDIT',                category: 'Vigilance',           description: 'Read-only access to the full immutable event trail' },
  VIEW:                      { key: 'VIEW',                      category: 'Quality Management',  description: "View an asset's metadata (Step 4)" },
  DOWNLOAD:                  { key: 'DOWNLOAD',                  category: 'Quality Management',  description: "Download an asset's underlying file/content (Step 4)" },
  UPLOAD_ASSET:              { key: 'UPLOAD_ASSET',              category: 'Supply Chain',        description: 'Upload a new asset for later minting/approval (Step 4)' },
  REQUEST_ACCESS_DELEGATION: { key: 'REQUEST_ACCESS_DELEGATION', category: 'Supply Chain',        description: 'Request that another DID be delegated access to an asset (Step 5)' },
};
```

### `chaincode/src/audit.ts`

```typescript
import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { AuditEvent, AuditResult } from './types';

/**
 * On-chain audit log. Only SUCCESS events are recorded: a chaincode
 * function that throws aborts its entire transaction (nothing it wrote,
 * including an audit entry, would ever commit), so there is no way to
 * durably log a FAILURE from inside the same invocation that failed.
 * Every mutating function across DIDRegistry, RBACEngine, and
 * AssetRegistry calls recordAudit() as its last step, once it knows the
 * action actually succeeded.
 */

function auditKey(ctx: Context, id: string) {
  return ctx.stub.createCompositeKey('AUDIT', [id]);
}

export async function recordAudit(
  ctx: Context,
  actor: string,
  action: string,
  target: string,
  message?: string,
  result: AuditResult = 'SUCCESS',
): Promise<void> {
  const seconds = ctx.stub.getTxTimestamp().seconds.low.toString();
  const id = `${seconds}-${ctx.stub.getTxID().slice(0, 12)}`;
  const event: AuditEvent = {
    id,
    actor,
    action,
    target,
    result,
    message,
    timestamp: seconds,
  };
  await ctx.stub.putState(auditKey(ctx, id), Buffer.from(JSON.stringify(event)));
}

async function listAllEvents(ctx: Context): Promise<AuditEvent[]> {
  const events: AuditEvent[] = [];
  const iterator = await ctx.stub.getStateByPartialCompositeKey('AUDIT', []);
  let result = await iterator.next();
  while (!result.done) {
    events.push(JSON.parse(result.value.value.toString()));
    result = await iterator.next();
  }
  await iterator.close();
  events.sort((a, b) => Number(b.timestamp) - Number(a.timestamp) || b.id.localeCompare(a.id));
  return events;
}

@Info({ title: 'Audit', description: 'Read-only access to the on-chain audit trail' })
export class AuditContract extends Contract {
  constructor() {
    super('AuditContract');
  }

  /**
   * Lists all recorded audit events, newest first. Gated by VIEW_AUDIT -
   * only the Auditor (and anyone else a role grants it to) can read this.
   * Filtering by actor/action/date is left to the caller (the UI does it
   * client-side); LevelDB's key-value model doesn't support server-side
   * rich queries the way CouchDB would.
   */
  @Transaction(false)
  @Returns('string')
  public async ListEvents(ctx: Context): Promise<string> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'VIEW_AUDIT', '*');
    return JSON.stringify(await listAllEvents(ctx));
  }

  /**
   * Self-scoped, ungated: always resolves the caller's own DID from their
   * Fabric identity (never a caller-supplied one), so a User with no
   * VIEW_AUDIT permission can still see their own "Recent Activity"
   * without being able to read anyone else's. Mirrors the
   * ListMyAssets / ListMyDelegationRequests pattern in AssetRegistry.
   */
  @Transaction(false)
  @Returns('string')
  public async ListMyEvents(ctx: Context): Promise<string> {
    const { deriveDID } = await import('./didRegistry');
    const callerDID = deriveDID(ctx);
    const events = await listAllEvents(ctx);
    return JSON.stringify(events.filter((e) => e.actor === callerDID));
  }
}
```

### `chaincode/src/didRegistry.ts`

```typescript
import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import * as crypto from 'crypto';
import { DIDDocument, DIDStatus } from './types';

const DID_PREFIX = 'did:fabric:';

/**
 * Derive a DID deterministically from the submitter's Fabric client
 * identity. This is what makes "proving it's you" free: Fabric's MSP/TLS
 * layer already verified the signature before the transaction reached
 * chaincode. We are not reinventing signature verification here - we are
 * binding our DID namespace to Fabric's existing one.
 */
export function deriveDID(ctx: Context): string {
  const rawId = ctx.clientIdentity.getID(); // unique per-identity string from the x.509 cert
  const hash = crypto.createHash('sha256').update(rawId).digest('hex').slice(0, 32);
  return `${DID_PREFIX}${hash}`;
}

function didKey(ctx: Context, did: string) {
  return ctx.stub.createCompositeKey('DID', [did]);
}

async function listAllDIDs(ctx: Context): Promise<DIDDocument[]> {
  const docs: DIDDocument[] = [];
  const iterator = await ctx.stub.getStateByPartialCompositeKey('DID', []);
  let result = await iterator.next();
  while (!result.done) {
    docs.push(JSON.parse(result.value.value.toString()));
    result = await iterator.next();
  }
  await iterator.close();
  return docs;
}

@Info({ title: 'DIDRegistry', description: 'On-chain DID registry with a 4-state onboarding lifecycle (DPDP-minimized schema)' })
export class DIDRegistryContract extends Contract {
  constructor() {
    super('DIDRegistryContract');
  }

  /**
   * One-time genesis bootstrap: creates the first Admin identity, already
   * ACTIVE (self-issued, so it can't go through its own onboarding queue).
   * Guarded so it can only succeed once per calling identity. Run this
   * immediately after chaincode instantiation, from the founding org's
   * admin identity, then use RBACEngineContract.GrantRole to give it the
   * ADMIN role.
   */
  @Transaction()
  public async InitAdmin(ctx: Context, orgUnit: string): Promise<string> {
    const { recordAudit } = await import('./audit');
    const did = deriveDID(ctx);
    const existing = await ctx.stub.getState(didKey(ctx, did));
    if (existing && existing.length > 0) {
      throw new Error(`DID ${did} is already registered - InitAdmin can only run once per identity`);
    }
    const doc: DIDDocument = {
      did,
      orgUnit,
      status: DIDStatus.ACTIVE,
      createdAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
      createdBy: did, // self-issued genesis identity
    };
    await ctx.stub.putState(didKey(ctx, did), Buffer.from(JSON.stringify(doc)));
    ctx.stub.setEvent('IdentityCreated', Buffer.from(JSON.stringify(doc)));
    await recordAudit(ctx, did, 'INIT_ADMIN', did, orgUnit);
    return did;
  }

  /**
   * Onboarding step 1 of 2. Deliberately open (no permission gate) and
   * keeps the same (subjectDID, orgUnit) signature the old IssueDID used,
   * so a subject can discover its own DID via WhoAmI and hand it to an
   * Admin out of band, or an Admin can file the request directly. Filing a
   * request only creates a PENDING record - it grants no access by itself.
   * A fresh request is allowed again once a prior identity for this DID
   * has reached DEACTIVATED.
   */
  @Transaction()
  public async RequestOnboarding(ctx: Context, subjectDID: string, orgUnit: string): Promise<void> {
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    const existing = await ctx.stub.getState(didKey(ctx, subjectDID));
    if (existing && existing.length > 0) {
      const doc: DIDDocument = JSON.parse(existing.toString());
      if (doc.status !== DIDStatus.DEACTIVATED) {
        throw new Error(`DID ${subjectDID} already has an onboarding record (status: ${doc.status})`);
      }
    }
    const doc: DIDDocument = {
      did: subjectDID,
      orgUnit,
      status: DIDStatus.PENDING,
      createdAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
      createdBy: callerDID,
    };
    await ctx.stub.putState(didKey(ctx, subjectDID), Buffer.from(JSON.stringify(doc)));
    ctx.stub.setEvent('OnboardingRequested', Buffer.from(JSON.stringify(doc)));
    await recordAudit(ctx, callerDID, 'REQUEST_ONBOARDING', subjectDID, orgUnit);
  }

  /**
   * Onboarding step 2 of 2 (also used to reverse a Suspend). Caller must
   * hold MANAGE_IDENTITY for the target's org unit (checked via the RBAC
   * engine, called directly since both contracts ship in one chaincode
   * package - no cross-chaincode invoke overhead). Moves PENDING or
   * SUSPENDED -> ACTIVE. This is the direct replacement for the old
   * IssueDID's "grant access now" behavior.
   */
  @Transaction()
  public async ActivateIdentity(ctx: Context, subjectDID: string): Promise<void> {
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const data = await ctx.stub.getState(didKey(ctx, subjectDID));
    if (!data || data.length === 0) {
      throw new Error(`DID ${subjectDID} not found - call RequestOnboarding first`);
    }
    const doc: DIDDocument = JSON.parse(data.toString());
    await requirePermission(ctx, callerDID, 'MANAGE_IDENTITY', doc.orgUnit);

    if (doc.status !== DIDStatus.PENDING && doc.status !== DIDStatus.SUSPENDED) {
      throw new Error(`DID ${subjectDID} cannot be activated from status ${doc.status}`);
    }
    doc.status = DIDStatus.ACTIVE;
    await ctx.stub.putState(didKey(ctx, subjectDID), Buffer.from(JSON.stringify(doc)));
    ctx.stub.setEvent('IdentityActivated', Buffer.from(JSON.stringify(doc)));
    await recordAudit(ctx, callerDID, 'ACTIVATE_IDENTITY', subjectDID);
  }

  /**
   * Temporary hold: an ACTIVE identity is parked as SUSPENDED and fails
   * every RBAC check until re-activated via ActivateIdentity. Unlike
   * DeactivateIdentity, this is reversible.
   */
  @Transaction()
  public async SuspendIdentity(ctx: Context, subjectDID: string): Promise<void> {
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const data = await ctx.stub.getState(didKey(ctx, subjectDID));
    if (!data || data.length === 0) {
      throw new Error(`DID ${subjectDID} not found`);
    }
    const doc: DIDDocument = JSON.parse(data.toString());
    await requirePermission(ctx, callerDID, 'MANAGE_IDENTITY', doc.orgUnit);

    if (doc.status !== DIDStatus.ACTIVE) {
      throw new Error(`DID ${subjectDID} cannot be suspended from status ${doc.status}`);
    }
    doc.status = DIDStatus.SUSPENDED;
    await ctx.stub.putState(didKey(ctx, subjectDID), Buffer.from(JSON.stringify(doc)));
    ctx.stub.setEvent('IdentitySuspended', Buffer.from(JSON.stringify(doc)));
    await recordAudit(ctx, callerDID, 'SUSPEND_IDENTITY', subjectDID);
  }

  /**
   * Terminal state - the direct replacement for the old RevokeDID. Once
   * DEACTIVATED, every RBAC check rejects this DID regardless of any role
   * still technically attached to it, and it can never be re-activated -
   * a fresh RequestOnboarding is required to reuse the identifier.
   */
  @Transaction()
  public async DeactivateIdentity(ctx: Context, subjectDID: string): Promise<void> {
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const data = await ctx.stub.getState(didKey(ctx, subjectDID));
    if (!data || data.length === 0) {
      throw new Error(`DID ${subjectDID} not found`);
    }
    const doc: DIDDocument = JSON.parse(data.toString());
    await requirePermission(ctx, callerDID, 'MANAGE_IDENTITY', doc.orgUnit);

    if (doc.status === DIDStatus.DEACTIVATED) {
      throw new Error(`DID ${subjectDID} is already deactivated`);
    }
    doc.status = DIDStatus.DEACTIVATED;
    await ctx.stub.putState(didKey(ctx, subjectDID), Buffer.from(JSON.stringify(doc)));
    ctx.stub.setEvent('IdentityDeactivated', Buffer.from(JSON.stringify(doc)));
    await recordAudit(ctx, callerDID, 'DEACTIVATE_IDENTITY', subjectDID);
  }

  /**
   * Lets any Fabric identity discover its own derived DID - needed so a
   * new identity can compute their DID once and hand it to an Admin (or
   * request their own onboarding with it directly).
   */
  @Transaction(false)
  @Returns('string')
  public async WhoAmI(ctx: Context): Promise<string> {
    return deriveDID(ctx);
  }

  @Transaction(false)
  @Returns('string')
  public async GetDID(ctx: Context, did: string): Promise<string> {
    const data = await ctx.stub.getState(didKey(ctx, did));
    if (!data || data.length === 0) {
      throw new Error(`DID ${did} not found`);
    }
    return data.toString();
  }

  /**
   * Admin's Identity Directory page - every DID on the ledger, any status.
   * Readable by anyone holding MANAGE_IDENTITY (can also act on identities)
   * OR VIEW_AUDIT (read-only oversight, e.g. the Auditor's Identity History
   * page) - both scoped '*'. Either is sufficient; neither is required if
   * you hold the other, so an Auditor doesn't need identity-management
   * write access just to see who's on the ledger.
   */
  @Transaction(false)
  @Returns('string')
  public async ListIdentities(ctx: Context): Promise<string> {
    const { hasPermission } = await import('./rbac');
    const callerDID = deriveDID(ctx);
    const allowed = (await hasPermission(ctx, callerDID, 'MANAGE_IDENTITY', '*'))
      || (await hasPermission(ctx, callerDID, 'VIEW_AUDIT', '*'));
    if (!allowed) {
      throw new Error(`DID ${callerDID} lacks MANAGE_IDENTITY or VIEW_AUDIT in scope *`);
    }
    return JSON.stringify(await listAllDIDs(ctx));
  }

  /**
   * Manager's Team Members page - identities registered under one org
   * unit. Deliberately ungated (like AssetRegistry's browsing queries):
   * it only ever returns names already scoped to the org unit the caller
   * asks for, so it doesn't need a separate "manage this org" permission
   * check to be safe to expose.
   */
  @Transaction(false)
  @Returns('string')
  public async ListIdentitiesByOrgUnit(ctx: Context, orgUnit: string): Promise<string> {
    const docs = await listAllDIDs(ctx);
    return JSON.stringify(docs.filter((d) => d.orgUnit === orgUnit));
  }

  /** Admin's Verification queue - just the PENDING ones awaiting ActivateIdentity. */
  @Transaction(false)
  @Returns('string')
  public async ListPendingOnboarding(ctx: Context): Promise<string> {
    const { requirePermission } = await import('./rbac');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'MANAGE_IDENTITY', '*');
    const docs = await listAllDIDs(ctx);
    return JSON.stringify(docs.filter((d) => d.status === DIDStatus.PENDING));
  }

  /**
   * Writes an AUTHENTICATE audit event for the caller. WhoAmI can't do
   * this itself (it's a query, so nothing it writes ever commits) - the
   * UI calls this once per session/role-switch so the Admin's Audit Trail
   * page has a real on-chain record of who logged in and when.
   */
  @Transaction()
  @Returns('string')
  public async RecordLogin(ctx: Context): Promise<string> {
    const { recordAudit } = await import('./audit');
    const did = deriveDID(ctx);
    await recordAudit(ctx, did, 'AUTHENTICATE', '');
    return did;
  }

  /**
   * Exported helper other contracts (RBAC, and the Asset Registry) call
   * to confirm a DID is real and currently ACTIVE (not pending, suspended,
   * or deactivated) before honoring any action from it.
   */
  public static async isActiveDID(ctx: Context, did: string): Promise<boolean> {
    const data = await ctx.stub.getState(didKey(ctx, did));
    if (!data || data.length === 0) return false;
    const doc: DIDDocument = JSON.parse(data.toString());
    return doc.status === DIDStatus.ACTIVE;
  }
}
```

### `chaincode/src/rbac.ts`

```typescript
import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { Role, RoleAssignment } from './types';
import { PERMISSIONS } from './permissions';

// Fixed by the problem statement text - do not add or rename these.
const ROLE_NAMES = ['ADMIN', 'MANAGER', 'AUDITOR', 'USER'];

function roleKey(ctx: Context, roleId: string) {
  return ctx.stub.createCompositeKey('ROLE', [roleId]);
}
function assignmentKey(ctx: Context, did: string, roleId: string, orgScope: string) {
  return ctx.stub.createCompositeKey('ROLEASSIGN', [did, roleId, orgScope]);
}

/**
 * Core enforcement function. Every other contract (Asset Registry, DID
 * Registry) calls this before doing anything sensitive. Throws if the
 * caller's DID isn't currently ACTIVE, or if they don't hold the
 * permission in the given org scope - so a suspended/deactivated
 * identity's still-unexpired role grant can never be exercised.
 */
export async function requirePermission(
  ctx: Context,
  callerDID: string,
  permission: string,
  orgScope: string,
): Promise<void> {
  const { DIDRegistryContract } = await import('./didRegistry');
  if (!(await DIDRegistryContract.isActiveDID(ctx, callerDID))) {
    throw new Error(`DID ${callerDID} is not active`);
  }

  const iterator = await ctx.stub.getStateByPartialCompositeKey('ROLEASSIGN', [callerDID]);
  let allowed = false;
  let result = await iterator.next();
  while (!result.done) {
    const assignment: RoleAssignment = JSON.parse(result.value.value.toString());
    const inScope = assignment.orgScope === orgScope || assignment.orgScope === '*';
    const notExpired = !assignment.expiresAt || Date.parse(assignment.expiresAt) > Date.now();
    if (inScope && notExpired) {
      const roleData = await ctx.stub.getState(roleKey(ctx, assignment.roleId));
      if (roleData && roleData.length > 0) {
        const role: Role = JSON.parse(roleData.toString());
        if (role.permissions.includes(permission)) {
          allowed = true;
          break;
        }
      }
    }
    result = await iterator.next();
  }
  await iterator.close();

  if (!allowed) {
    throw new Error(`DID ${callerDID} lacks permission ${permission} in scope ${orgScope}`);
  }
}

/** Non-throwing counterpart, for read paths (e.g. AssetRegistryContract
 * deciding whether to include an asset in "my assets") that need a yes/no
 * answer rather than an exception. */
export async function hasPermission(
  ctx: Context,
  callerDID: string,
  permission: string,
  orgScope: string,
): Promise<boolean> {
  try {
    await requirePermission(ctx, callerDID, permission, orgScope);
    return true;
  } catch {
    return false;
  }
}

@Info({ title: 'RBACEngine', description: 'Role and permission management, grounded in BEL real duty categories' })
export class RBACEngineContract extends Contract {
  constructor() {
    super('RBACEngineContract');
  }

  /**
   * One-time system bootstrap. Only succeeds while ZERO role assignments
   * exist anywhere on the ledger - the instant any assignment exists
   * (including the one this call creates), it permanently locks itself out.
   * This is the fix for the DID/RBAC chicken-and-egg problem: DefineRole
   * and GrantRole both require MANAGE_ROLE, but the very first permission
   * on the network can't have been granted by anyone. Call this once,
   * right after InitAdmin, from the same identity.
   */
  @Transaction()
  public async BootstrapAdmin(ctx: Context): Promise<void> {
    const { deriveDID, DIDRegistryContract } = await import('./didRegistry');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    if (!(await DIDRegistryContract.isActiveDID(ctx, callerDID))) {
      throw new Error(`DID ${callerDID} is not active - call InitAdmin first`);
    }

    const iterator = await ctx.stub.getStateByPartialCompositeKey('ROLEASSIGN', []);
    const first = await iterator.next();
    await iterator.close();
    if (!first.done) {
      throw new Error('Bootstrap already completed - use GrantRole instead');
    }

    const adminPermissions = ['MANAGE_IDENTITY', 'MANAGE_ROLE', 'MINT_ASSET'];
    const role: Role = { roleId: 'ADMIN', name: 'Admin', permissions: adminPermissions, orgScope: '*' };
    await ctx.stub.putState(roleKey(ctx, 'ADMIN'), Buffer.from(JSON.stringify(role)));

    const assignment: RoleAssignment = {
      did: callerDID,
      roleId: 'ADMIN',
      orgScope: '*',
      expiresAt: null,
      assignedBy: callerDID,
      assignedAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
    };
    await ctx.stub.putState(
      assignmentKey(ctx, callerDID, 'ADMIN', '*'),
      Buffer.from(JSON.stringify(assignment)),
    );
    ctx.stub.setEvent('RoleGranted', Buffer.from(JSON.stringify(assignment)));
    await recordAudit(ctx, callerDID, 'BOOTSTRAP_ADMIN', callerDID);
  }

  @Transaction()
  public async DefineRole(
    ctx: Context,
    roleId: string,
    name: string,
    permissionsCSV: string,
    orgScope: string,
  ): Promise<void> {
    if (!ROLE_NAMES.includes(roleId)) {
      throw new Error(`roleId must be one of ${ROLE_NAMES.join(', ')} (fixed by the problem statement)`);
    }
    const { deriveDID } = await import('./didRegistry');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'MANAGE_ROLE', orgScope);

    const permissions = permissionsCSV.split(',').map((p) => p.trim()).filter(Boolean);
    for (const p of permissions) {
      if (!PERMISSIONS[p]) throw new Error(`Unknown permission: ${p}`);
    }
    const role: Role = { roleId, name, permissions, orgScope };
    await ctx.stub.putState(roleKey(ctx, roleId), Buffer.from(JSON.stringify(role)));
    await recordAudit(ctx, callerDID, 'DEFINE_ROLE', roleId, permissionsCSV);
  }

  @Transaction()
  public async GrantRole(
    ctx: Context,
    subjectDID: string,
    roleId: string,
    orgScope: string,
    expiresAt: string, // pass "" for no expiry
  ): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'MANAGE_ROLE', orgScope);

    const roleData = await ctx.stub.getState(roleKey(ctx, roleId));
    if (!roleData || roleData.length === 0) {
      throw new Error(`Role ${roleId} is not defined - call DefineRole first`);
    }
    const assignment: RoleAssignment = {
      did: subjectDID,
      roleId,
      orgScope,
      expiresAt: expiresAt || null,
      assignedBy: callerDID,
      assignedAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
    };
    await ctx.stub.putState(
      assignmentKey(ctx, subjectDID, roleId, orgScope),
      Buffer.from(JSON.stringify(assignment)),
    );
    ctx.stub.setEvent('RoleGranted', Buffer.from(JSON.stringify(assignment)));
    await recordAudit(ctx, callerDID, 'GRANT_ROLE', subjectDID, `${roleId}@${orgScope}`);
  }

  @Transaction()
  public async RevokeRole(ctx: Context, subjectDID: string, roleId: string, orgScope: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'MANAGE_ROLE', orgScope);

    const key = assignmentKey(ctx, subjectDID, roleId, orgScope);
    const existing = await ctx.stub.getState(key);
    if (!existing || existing.length === 0) {
      throw new Error(`No such role assignment for ${subjectDID}`);
    }
    await ctx.stub.deleteState(key);
    ctx.stub.setEvent(
      'RoleRevoked',
      Buffer.from(JSON.stringify({ did: subjectDID, roleId, orgScope, revokedBy: callerDID })),
    );
    await recordAudit(ctx, callerDID, 'REVOKE_ROLE', subjectDID, `${roleId}@${orgScope}`);
  }

  /** Read-only check, useful for a UI to decide what buttons to show. */
  @Transaction(false)
  @Returns('boolean')
  public async HasPermission(ctx: Context, did: string, permission: string, orgScope: string): Promise<boolean> {
    return hasPermission(ctx, did, permission, orgScope);
  }

  /** Admin's Roles & Policies page - the (at most 4) role definitions that exist. */
  @Transaction(false)
  @Returns('string')
  public async ListRoles(ctx: Context): Promise<string> {
    const roles: Role[] = [];
    for (const roleId of ROLE_NAMES) {
      const data = await ctx.stub.getState(roleKey(ctx, roleId));
      if (data && data.length > 0) {
        roles.push(JSON.parse(data.toString()));
      }
    }
    return JSON.stringify(roles);
  }
}
```

### `chaincode/src/asset.ts`

```typescript
import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import {
  AssetAccessGrant,
  AssetDocument,
  AssetStatus,
  DelegationRequest,
  DelegationStatus,
} from './types';

/**
 * Asset Registry + Approval Workflow, the Step 4 / Step 5 contracts that
 * permissions.ts declared MINT_ASSET / APPROVE_ASSET / UPLOAD_ASSET /
 * VIEW / DOWNLOAD / GRANT_ACCESS / REVOKE_ACCESS / APPROVE_DELEGATION /
 * REQUEST_ACCESS_DELEGATION for ahead of time. Imports requirePermission
 * from rbac.ts exactly the way didRegistry.ts does - no new pattern.
 *
 * Files themselves are DELIBERATELY not stored here - only a SHA-256
 * integrity hash and lifecycle metadata. The actual bytes live off-chain
 * (see bel-ui/backend's local disk storage).
 *
 * Lifecycle: PENDING_APPROVAL -[Manager]-> PENDING_MINT -[Admin]-> ACTIVE
 *                            \-[Manager]-> REJECTED (terminal)
 */

function assetKey(ctx: Context, assetId: string) {
  return ctx.stub.createCompositeKey('ASSET', [assetId]);
}
function accessKey(ctx: Context, assetId: string, did: string) {
  return ctx.stub.createCompositeKey('ASSETACCESS', [assetId, did]);
}
function delegationKey(ctx: Context, requestId: string) {
  return ctx.stub.createCompositeKey('DELEGATION', [requestId]);
}

async function getAssetOrThrow(ctx: Context, assetId: string): Promise<AssetDocument> {
  const data = await ctx.stub.getState(assetKey(ctx, assetId));
  if (!data || data.length === 0) {
    throw new Error(`Asset ${assetId} not found`);
  }
  return JSON.parse(data.toString());
}

async function listAllAssets(ctx: Context): Promise<AssetDocument[]> {
  const assets: AssetDocument[] = [];
  const iterator = await ctx.stub.getStateByPartialCompositeKey('ASSET', []);
  let result = await iterator.next();
  while (!result.done) {
    assets.push(JSON.parse(result.value.value.toString()));
    result = await iterator.next();
  }
  await iterator.close();
  return assets;
}

async function listAllDelegations(ctx: Context): Promise<DelegationRequest[]> {
  const requests: DelegationRequest[] = [];
  const iterator = await ctx.stub.getStateByPartialCompositeKey('DELEGATION', []);
  let result = await iterator.next();
  while (!result.done) {
    requests.push(JSON.parse(result.value.value.toString()));
    result = await iterator.next();
  }
  await iterator.close();
  return requests;
}

async function listAccessGrantsForAsset(ctx: Context, assetId: string): Promise<AssetAccessGrant[]> {
  const grants: AssetAccessGrant[] = [];
  const iterator = await ctx.stub.getStateByPartialCompositeKey('ASSETACCESS', [assetId]);
  let result = await iterator.next();
  while (!result.done) {
    grants.push(JSON.parse(result.value.value.toString()));
    result = await iterator.next();
  }
  await iterator.close();
  return grants;
}

@Info({ title: 'AssetRegistry', description: 'Asset upload/approval/mint lifecycle and access delegation' })
export class AssetRegistryContract extends Contract {
  constructor() {
    super('AssetRegistryContract');
  }

  /** Step 1: any identity holding UPLOAD_ASSET files a new asset for review. */
  @Transaction()
  @Returns('string')
  public async UploadAsset(
    ctx: Context,
    fileName: string,
    sha256Hash: string,
    orgScope: string,
  ): Promise<string> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'UPLOAD_ASSET', orgScope);

    const assetId = `AST-${ctx.stub.getTxID().slice(0, 8).toUpperCase()}`;
    const asset: AssetDocument = {
      assetId,
      fileName,
      sha256Hash,
      orgScope,
      status: AssetStatus.PENDING_APPROVAL,
      uploadedBy: callerDID,
      createdAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
      approvedBy: null,
      approvedAt: null,
      rejectionReason: null,
      mintedBy: null,
      mintedAt: null,
    };
    await ctx.stub.putState(assetKey(ctx, assetId), Buffer.from(JSON.stringify(asset)));
    ctx.stub.setEvent('AssetUploaded', Buffer.from(JSON.stringify(asset)));
    await recordAudit(ctx, callerDID, 'UPLOAD_ASSET', assetId, fileName);
    return assetId;
  }

  /** Step 2: a Manager (APPROVE_ASSET) clears it to the Admin's mint queue. */
  @Transaction()
  public async ApproveAsset(ctx: Context, assetId: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'APPROVE_ASSET', asset.orgScope);

    if (asset.status !== AssetStatus.PENDING_APPROVAL) {
      throw new Error(`Asset ${assetId} cannot be approved from status ${asset.status}`);
    }
    asset.status = AssetStatus.PENDING_MINT;
    asset.approvedBy = callerDID;
    asset.approvedAt = ctx.stub.getTxTimestamp().seconds.low.toString();
    await ctx.stub.putState(assetKey(ctx, assetId), Buffer.from(JSON.stringify(asset)));
    ctx.stub.setEvent('AssetApproved', Buffer.from(JSON.stringify(asset)));
    await recordAudit(ctx, callerDID, 'APPROVE_ASSET', assetId);
  }

  /** Manager decline path - terminal, matches ApproveAsset's permission. */
  @Transaction()
  public async RejectAsset(ctx: Context, assetId: string, reason: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'APPROVE_ASSET', asset.orgScope);

    if (asset.status !== AssetStatus.PENDING_APPROVAL) {
      throw new Error(`Asset ${assetId} cannot be rejected from status ${asset.status}`);
    }
    asset.status = AssetStatus.REJECTED;
    asset.approvedBy = callerDID;
    asset.approvedAt = ctx.stub.getTxTimestamp().seconds.low.toString();
    asset.rejectionReason = reason;
    await ctx.stub.putState(assetKey(ctx, assetId), Buffer.from(JSON.stringify(asset)));
    ctx.stub.setEvent('AssetRejected', Buffer.from(JSON.stringify(asset)));
    await recordAudit(ctx, callerDID, 'REJECT_ASSET', assetId, reason);
  }

  /** Step 3: an Admin (MINT_ASSET) finalizes it as ACTIVE. */
  @Transaction()
  public async MintAsset(ctx: Context, assetId: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'MINT_ASSET', asset.orgScope);

    if (asset.status !== AssetStatus.PENDING_MINT) {
      throw new Error(`Asset ${assetId} cannot be minted from status ${asset.status}`);
    }
    asset.status = AssetStatus.ACTIVE;
    asset.mintedBy = callerDID;
    asset.mintedAt = ctx.stub.getTxTimestamp().seconds.low.toString();
    await ctx.stub.putState(assetKey(ctx, assetId), Buffer.from(JSON.stringify(asset)));
    ctx.stub.setEvent('AssetMinted', Buffer.from(JSON.stringify(asset)));
    await recordAudit(ctx, callerDID, 'MINT_ASSET', assetId);
  }

  /** Direct grant, e.g. a Manager (GRANT_ACCESS) handing a User VIEW/DOWNLOAD. */
  @Transaction()
  public async GrantAccess(ctx: Context, assetId: string, targetDID: string, permissionsCSV: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'GRANT_ACCESS', asset.orgScope);

    const permissions = permissionsCSV.split(',').map((p) => p.trim()).filter(Boolean);
    const grant: AssetAccessGrant = {
      assetId,
      did: targetDID,
      permissions,
      grantedBy: callerDID,
      grantedAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
    };
    await ctx.stub.putState(accessKey(ctx, assetId, targetDID), Buffer.from(JSON.stringify(grant)));
    ctx.stub.setEvent('AccessGranted', Buffer.from(JSON.stringify(grant)));
    await recordAudit(ctx, callerDID, 'GRANT_ACCESS', `${assetId}:${targetDID}`, permissionsCSV);
  }

  @Transaction()
  public async RevokeAccess(ctx: Context, assetId: string, targetDID: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'REVOKE_ACCESS', asset.orgScope);

    const key = accessKey(ctx, assetId, targetDID);
    const existing = await ctx.stub.getState(key);
    if (!existing || existing.length === 0) {
      throw new Error(`No access grant for ${targetDID} on ${assetId}`);
    }
    await ctx.stub.deleteState(key);
    ctx.stub.setEvent('AccessRevoked', Buffer.from(JSON.stringify({ assetId, targetDID, revokedBy: callerDID })));
    await recordAudit(ctx, callerDID, 'REVOKE_ACCESS', `${assetId}:${targetDID}`);
  }

  /** A User (REQUEST_ACCESS_DELEGATION) asks that someone else be granted access. */
  @Transaction()
  @Returns('string')
  public async RequestAccessDelegation(
    ctx: Context,
    assetId: string,
    targetDID: string,
    permissionsCSV: string,
  ): Promise<string> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'REQUEST_ACCESS_DELEGATION', asset.orgScope);

    const requestId = `DEL-${ctx.stub.getTxID().slice(0, 8).toUpperCase()}`;
    const request: DelegationRequest = {
      requestId,
      assetId,
      requestedBy: callerDID,
      targetDID,
      permissionsCSV,
      status: DelegationStatus.PENDING,
      createdAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
      decidedBy: null,
      decidedAt: null,
    };
    await ctx.stub.putState(delegationKey(ctx, requestId), Buffer.from(JSON.stringify(request)));
    ctx.stub.setEvent('DelegationRequested', Buffer.from(JSON.stringify(request)));
    await recordAudit(ctx, callerDID, 'REQUEST_ACCESS_DELEGATION', requestId, `${assetId} -> ${targetDID}`);
    return requestId;
  }

  /** A Manager (APPROVE_DELEGATION) approves it, which materializes the grant. */
  @Transaction()
  public async ApproveDelegation(ctx: Context, requestId: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const data = await ctx.stub.getState(delegationKey(ctx, requestId));
    if (!data || data.length === 0) {
      throw new Error(`Delegation request ${requestId} not found`);
    }
    const request: DelegationRequest = JSON.parse(data.toString());
    const asset = await getAssetOrThrow(ctx, request.assetId);
    await requirePermission(ctx, callerDID, 'APPROVE_DELEGATION', asset.orgScope);

    if (request.status !== DelegationStatus.PENDING) {
      throw new Error(`Delegation request ${requestId} is already ${request.status}`);
    }
    request.status = DelegationStatus.APPROVED;
    request.decidedBy = callerDID;
    request.decidedAt = ctx.stub.getTxTimestamp().seconds.low.toString();
    await ctx.stub.putState(delegationKey(ctx, requestId), Buffer.from(JSON.stringify(request)));

    const permissions = request.permissionsCSV.split(',').map((p) => p.trim()).filter(Boolean);
    const grant: AssetAccessGrant = {
      assetId: request.assetId,
      did: request.targetDID,
      permissions,
      grantedBy: callerDID,
      grantedAt: request.decidedAt,
    };
    await ctx.stub.putState(accessKey(ctx, request.assetId, request.targetDID), Buffer.from(JSON.stringify(grant)));
    ctx.stub.setEvent('DelegationApproved', Buffer.from(JSON.stringify(request)));
    await recordAudit(ctx, callerDID, 'APPROVE_DELEGATION', requestId);
  }

  @Transaction()
  public async RejectDelegation(ctx: Context, requestId: string, reason: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const data = await ctx.stub.getState(delegationKey(ctx, requestId));
    if (!data || data.length === 0) {
      throw new Error(`Delegation request ${requestId} not found`);
    }
    const request: DelegationRequest = JSON.parse(data.toString());
    const asset = await getAssetOrThrow(ctx, request.assetId);
    await requirePermission(ctx, callerDID, 'APPROVE_DELEGATION', asset.orgScope);

    if (request.status !== DelegationStatus.PENDING) {
      throw new Error(`Delegation request ${requestId} is already ${request.status}`);
    }
    request.status = DelegationStatus.REJECTED;
    request.decidedBy = callerDID;
    request.decidedAt = ctx.stub.getTxTimestamp().seconds.low.toString();
    await ctx.stub.putState(delegationKey(ctx, requestId), Buffer.from(JSON.stringify(request)));
    ctx.stub.setEvent('DelegationRejected', Buffer.from(JSON.stringify(request)));
    await recordAudit(ctx, callerDID, 'REJECT_DELEGATION', requestId, reason);
  }

  /** Manager's Delegation Requests queue - every request, any status; the
   * UI filters to PENDING client-side the same way it does for assets. */
  @Transaction(false)
  @Returns('string')
  public async ListDelegations(ctx: Context): Promise<string> {
    return JSON.stringify(await listAllDelegations(ctx));
  }

  /** A User's own outgoing delegation requests, whatever their status. */
  @Transaction(false)
  @Returns('string')
  public async ListMyDelegationRequests(ctx: Context, did: string): Promise<string> {
    const requests = await listAllDelegations(ctx);
    return JSON.stringify(requests.filter((r) => r.requestedBy === did));
  }

  /** Combines a caller's RBAC role permissions with any per-asset grant. */
  @Transaction(false)
  @Returns('boolean')
  public async HasAssetAccess(ctx: Context, assetId: string, did: string, permission: string): Promise<boolean> {
    const { hasPermission } = await import('./rbac');
    const asset = await getAssetOrThrow(ctx, assetId);

    if (asset.uploadedBy === did) return true;
    if (await hasPermission(ctx, did, permission, asset.orgScope)) return true;

    const data = await ctx.stub.getState(accessKey(ctx, assetId, did));
    if (!data || data.length === 0) return false;
    const grant: AssetAccessGrant = JSON.parse(data.toString());
    return grant.permissions.includes(permission);
  }

  @Transaction(false)
  @Returns('string')
  public async GetAsset(ctx: Context, assetId: string): Promise<string> {
    return JSON.stringify(await getAssetOrThrow(ctx, assetId));
  }

  /** Full registry listing - for the Admin's Asset Registry / Auditor's Asset History pages. */
  @Transaction(false)
  @Returns('string')
  public async ListAssets(ctx: Context): Promise<string> {
    return JSON.stringify(await listAllAssets(ctx));
  }

  @Transaction(false)
  @Returns('string')
  public async ListPendingApprovals(ctx: Context): Promise<string> {
    const assets = await listAllAssets(ctx);
    return JSON.stringify(assets.filter((a) => a.status === AssetStatus.PENDING_APPROVAL));
  }

  @Transaction(false)
  @Returns('string')
  public async ListPendingMints(ctx: Context): Promise<string> {
    const assets = await listAllAssets(ctx);
    return JSON.stringify(assets.filter((a) => a.status === AssetStatus.PENDING_MINT));
  }

  /** For the User portal's "My Assets": uploaded-by-me, or an explicit access grant. */
  @Transaction(false)
  @Returns('string')
  public async ListMyAssets(ctx: Context, did: string): Promise<string> {
    const assets = await listAllAssets(ctx);
    const mine: (AssetDocument & { permissions: string[] })[] = [];
    for (const asset of assets) {
      if (asset.uploadedBy === did) {
        mine.push({ ...asset, permissions: ['VIEW', 'DOWNLOAD', 'UPLOAD_ASSET'] });
        continue;
      }
      const grants = await listAccessGrantsForAsset(ctx, asset.assetId);
      const grant = grants.find((g) => g.did === did);
      if (grant) {
        mine.push({ ...asset, permissions: grant.permissions });
      }
    }
    return JSON.stringify(mine);
  }
}
```

### `chaincode/src/index.ts`

```typescript
import { DIDRegistryContract } from './didRegistry';
import { RBACEngineContract } from './rbac';
import { AssetRegistryContract } from './asset';
import { AuditContract } from './audit';

export const contracts = [DIDRegistryContract, RBACEngineContract, AssetRegistryContract, AuditContract];
```

### `bel-ui/register-demo-identities.sh`

```bash
#!/bin/bash
# Registers three new Fabric identities (Manager, Auditor, User demo
# accounts), has each discover its own DID via WhoAmI, then uses the
# existing Admin identity to onboard and activate those exact DIDs before
# granting roles.
#
# Run this from inside fabric-samples/test-network, AFTER the network is
# up, Org3 is added, and belid is deployed with roles ADMIN/MANAGER/
# AUDITOR/USER already defined (Parts 6-9 of the setup guide).
#
# Produces: identities.json in this directory - the backend reads this to
# know which wallet/DID belongs to which role.

set -e

ORG1_DOMAIN="organizations/peerOrganizations/org1.example.com"
CA_CERT="${PWD}/organizations/fabric-ca/org1/ca-cert.pem"
ORDERER_CAFILE="${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"
PEER1_TLS="${PWD}/${ORG1_DOMAIN}/peers/peer0.org1.example.com/tls/ca.crt"
PEER2_TLS="${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"
ORDERER="-o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile ${ORDERER_CAFILE}"
ENDORSE="--peerAddresses localhost:7051 --tlsRootCertFiles ${PEER1_TLS} --peerAddresses localhost:9051 --tlsRootCertFiles ${PEER2_TLS}"

export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/../config

declare -A ROLE_PW=( ["manager-demo"]="managerpw" ["auditor-demo"]="auditorpw" ["user-demo"]="userpw" )
declare -A ROLE_ID=( ["manager-demo"]="MANAGER" ["auditor-demo"]="AUDITOR" ["user-demo"]="USER" )
# Each identity's own org unit (used for their DID document / onboarding record).
declare -A ROLE_ORGUNIT=( ["manager-demo"]="Bangalore Complex" ["auditor-demo"]="Corporate Office" ["user-demo"]="Ghaziabad" )
# Each role's RBAC GRANT scope - NOT necessarily the same as the identity's
# own org unit. MANAGER and USER act within their own unit, but AUDITOR
# ("Audit Committee tier - read-only access to the full immutable trail")
# is deliberately granted "*" so it can see across every org unit, not
# just the one its own identity happens to belong to.
declare -A ROLE_GRANTSCOPE=( ["manager-demo"]="Bangalore Complex" ["auditor-demo"]="*" ["user-demo"]="Ghaziabad" )

echo "== Step 1: Register and enroll three new identities via Org1's CA =="
export FABRIC_CA_CLIENT_HOME=${PWD}/${ORG1_DOMAIN}

for name in manager-demo auditor-demo user-demo; do
  pw=${ROLE_PW[$name]}
  msp_dir="${PWD}/${ORG1_DOMAIN}/users/${name}@org1.example.com/msp"

  fabric-ca-client register --caname ca-org1 \
    --id.name "$name" --id.secret "$pw" --id.type client \
    --tls.certfiles "${CA_CERT}" || echo "(already registered, continuing)"

  fabric-ca-client enroll -u "https://${name}:${pw}@localhost:7054" \
    --caname ca-org1 -M "${msp_dir}" \
    --tls.certfiles "${CA_CERT}"

  cp "${PWD}/${ORG1_DOMAIN}/msp/config.yaml" "${msp_dir}/config.yaml"

  echo "  -> ${name} enrolled at ${msp_dir}"
done

echo ""
echo "== Step 2: Each new identity discovers its own DID via WhoAmI =="

declare -A ROLE_DID

for name in manager-demo auditor-demo user-demo; do
  msp_dir="${PWD}/${ORG1_DOMAIN}/users/${name}@org1.example.com/msp"

  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID=Org1MSP
  export CORE_PEER_TLS_ROOTCERT_FILE=${PEER1_TLS}
  export CORE_PEER_MSPCONFIGPATH=${msp_dir}
  export CORE_PEER_ADDRESS=localhost:7051

  did=$(peer chaincode query -C belchannel -n belid -c '{"function":"DIDRegistryContract:WhoAmI","Args":[]}')
  did=$(echo "$did" | tr -d '"')
  ROLE_DID[$name]=$did
  echo "  -> ${name} is ${did}"
done

echo ""
echo "== Step 3: Switch to Admin and onboard + activate + grant roles to those exact DIDs =="

export $(./setOrgEnv.sh Org1 | xargs)

for name in manager-demo auditor-demo user-demo; do
  did=${ROLE_DID[$name]}
  role=${ROLE_ID[$name]}
  orgunit=${ROLE_ORGUNIT[$name]}
  grantscope=${ROLE_GRANTSCOPE[$name]}

  echo "  -> Requesting onboarding for ${name} (${did}), org unit: ${orgunit}"
  peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
    -c "{\"function\":\"DIDRegistryContract:RequestOnboarding\",\"Args\":[\"${did}\",\"${orgunit}\"]}" >/dev/null 2>&1 \
    || echo "     (already requested, continuing)"
  sleep 2

  echo "  -> Activating ${name} (${did})"
  peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
    -c "{\"function\":\"DIDRegistryContract:ActivateIdentity\",\"Args\":[\"${did}\"]}" >/dev/null 2>&1 \
    || echo "     (already active, continuing)"
  sleep 2

  echo "  -> Granting ${role} to ${did}, scope: ${grantscope}"
  peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
    -c "{\"function\":\"RBACEngineContract:GrantRole\",\"Args\":[\"${did}\",\"${role}\",\"${grantscope}\",\"\"]}" >/dev/null 2>&1
  sleep 2
done

echo ""
echo "== Step 4: Write identities.json for the backend =="

admin_msp="${PWD}/${ORG1_DOMAIN}/users/Admin@org1.example.com/msp"

cat > identities.json << JSONEOF
{
  "ADMIN": {
    "did": "REPLACE_WITH_YOUR_GENESIS_DID",
    "orgUnit": "Corporate Office",
    "orgScope": "*",
    "mspId": "Org1MSP",
    "certPath": "${admin_msp}/signcerts/cert.pem",
    "keyPath": "${admin_msp}/keystore/priv_sk"
  },
  "MANAGER": {
    "did": "${ROLE_DID[manager-demo]}",
    "orgUnit": "${ROLE_ORGUNIT[manager-demo]}",
    "orgScope": "${ROLE_GRANTSCOPE[manager-demo]}",
    "mspId": "Org1MSP",
    "certPath": "${PWD}/${ORG1_DOMAIN}/users/manager-demo@org1.example.com/msp/signcerts/cert.pem",
    "keyPath": "${PWD}/${ORG1_DOMAIN}/users/manager-demo@org1.example.com/msp/keystore/priv_sk"
  },
  "AUDITOR": {
    "did": "${ROLE_DID[auditor-demo]}",
    "orgUnit": "${ROLE_ORGUNIT[auditor-demo]}",
    "orgScope": "${ROLE_GRANTSCOPE[auditor-demo]}",
    "mspId": "Org1MSP",
    "certPath": "${PWD}/${ORG1_DOMAIN}/users/auditor-demo@org1.example.com/msp/signcerts/cert.pem",
    "keyPath": "${PWD}/${ORG1_DOMAIN}/users/auditor-demo@org1.example.com/msp/keystore/priv_sk"
  },
  "USER": {
    "did": "${ROLE_DID[user-demo]}",
    "orgUnit": "${ROLE_ORGUNIT[user-demo]}",
    "orgScope": "${ROLE_GRANTSCOPE[user-demo]}",
    "mspId": "Org1MSP",
    "certPath": "${PWD}/${ORG1_DOMAIN}/users/user-demo@org1.example.com/msp/signcerts/cert.pem",
    "keyPath": "${PWD}/${ORG1_DOMAIN}/users/user-demo@org1.example.com/msp/keystore/priv_sk"
  },
  "network": {
    "peerEndpoint": "localhost:7051",
    "peerHostAlias": "peer0.org1.example.com",
    "tlsCertPath": "${PEER1_TLS}",
    "mspId": "Org1MSP",
    "channelName": "belchannel",
    "chaincodeName": "belid"
  }
}
JSONEOF

echo ""
echo "Done. Wrote identities.json"
echo ""
echo "IMPORTANT: open identities.json and replace ADMIN.did with your"
echo "actual genesis DID (the one InitAdmin returned back in Part 9 -"
echo "the value starting did:fabric:...). This script does not know it,"
echo "since it was generated before this script ran."
```

### `bel-ui/identities.example.json`

```json
{
  "ADMIN": {
    "did": "did:fabric:REPLACE_WITH_YOUR_GENESIS_DID",
    "orgUnit": "Corporate Office",
    "orgScope": "*",
    "mspId": "Org1MSP",
    "certPath": "/home/you/bel-fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/signcerts/cert.pem",
    "keyPath": "/home/you/bel-fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/keystore/priv_sk"
  },
  "MANAGER": {
    "did": "did:fabric:...",
    "orgUnit": "Bangalore Complex",
    "orgScope": "Bangalore Complex",
    "mspId": "Org1MSP",
    "certPath": "/home/you/bel-fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/manager-demo@org1.example.com/msp/signcerts/cert.pem",
    "keyPath": "/home/you/bel-fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/manager-demo@org1.example.com/msp/keystore/priv_sk"
  },
  "AUDITOR": {
    "did": "did:fabric:...",
    "orgUnit": "Corporate Office",
    "orgScope": "Corporate Office",
    "mspId": "Org1MSP",
    "certPath": "/home/you/bel-fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/auditor-demo@org1.example.com/msp/signcerts/cert.pem",
    "keyPath": "/home/you/bel-fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/auditor-demo@org1.example.com/msp/keystore/priv_sk"
  },
  "USER": {
    "did": "did:fabric:...",
    "orgUnit": "Ghaziabad",
    "orgScope": "Ghaziabad",
    "mspId": "Org1MSP",
    "certPath": "/home/you/bel-fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/user-demo@org1.example.com/msp/signcerts/cert.pem",
    "keyPath": "/home/you/bel-fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/user-demo@org1.example.com/msp/keystore/priv_sk"
  },
  "network": {
    "peerEndpoint": "localhost:7051",
    "peerHostAlias": "peer0.org1.example.com",
    "tlsCertPath": "/home/you/bel-fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt",
    "mspId": "Org1MSP",
    "channelName": "belchannel",
    "chaincodeName": "belid"
  }
}
```

### `bel-ui/.gitignore`

```text
node_modules/
dist/
*.log

# Generated locally by register-demo-identities.sh - contains absolute
# filesystem paths specific to your machine. Never commit this.
identities.json

# Uploaded asset files live only on local disk, never on the chain -
# see backend/src/server.ts. Don't commit demo uploads.
backend/uploads/
```

### `bel-ui/backend/package.json`

```json
{
  "name": "bel-ui-backend",
  "version": "0.1.0",
  "private": true,
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@grpc/grpc-js": "^1.10.9",
    "@hyperledger/fabric-gateway": "^1.5.1",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/multer": "^1.4.11",
    "@types/node": "^20.11.0",
    "typescript": "^5.4.5"
  }
}
```

### `bel-ui/backend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2019",
    "module": "CommonJS",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

### `bel-ui/backend/src/gateway.ts`

```typescript
import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Gateway, Identity, Signer, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface RoleIdentity {
  did: string;
  orgUnit: string;
  orgScope: string;
  mspId: string;
  certPath: string;
  keyPath: string;
}

export interface NetworkConfig {
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
  mspId: string;
  channelName: string;
  chaincodeName: string;
}

export interface IdentitiesFile {
  ADMIN: RoleIdentity;
  MANAGER: RoleIdentity;
  AUDITOR: RoleIdentity;
  USER: RoleIdentity;
  network: NetworkConfig;
}

export type RoleName = 'ADMIN' | 'MANAGER' | 'AUDITOR' | 'USER';

interface RoleConnection {
  gateway: Gateway;
  client: grpc.Client;
  didContract: Contract;
  rbacContract: Contract;
  assetContract: Contract;
  auditContract: Contract;
}

const connections = new Map<RoleName, RoleConnection>();
let config: IdentitiesFile;

export function loadConfig(identitiesPath: string): IdentitiesFile {
  config = JSON.parse(fs.readFileSync(identitiesPath, 'utf8'));
  return config;
}

function newGrpcConnection(net: NetworkConfig): grpc.Client {
  const tlsRootCert = fs.readFileSync(net.tlsCertPath);
  const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
  return new grpc.Client(net.peerEndpoint, tlsCredentials, {
    'grpc.ssl_target_name_override': net.peerHostAlias,
  });
}

function newIdentity(role: RoleIdentity): Identity {
  const credentials = fs.readFileSync(role.certPath);
  return { mspId: role.mspId, credentials };
}

/**
 * cryptogen (and fabric-ca-client, in a slightly different way) names each
 * identity's private key file with a random hash, e.g.
 * "813c0c5a...d75e182_sk" - never a fixed name like "priv_sk". That hash
 * also changes every time the network is regenerated (network.sh down/up).
 * identities.json's keyPath is treated as best-effort: if it exists as
 * given, use it; otherwise fall back to the one *_sk file actually present
 * in that keystore directory, so a network reset doesn't require manually
 * re-editing every identity's path.
 */
function resolveKeyFile(keyPath: string): string {
  if (fs.existsSync(keyPath)) return keyPath;
  const dir = path.dirname(keyPath);
  const candidates = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('_sk')) : [];
  if (candidates.length === 0) {
    throw new Error(`No private key file found in ${dir} (expected one *_sk file - was the network reset?)`);
  }
  return path.join(dir, candidates[0]);
}

function newSigner(role: RoleIdentity): Signer {
  const privateKeyPem = fs.readFileSync(resolveKeyFile(role.keyPath));
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

/**
 * Returns (creating if needed) a Fabric Gateway connection acting as the
 * given role's own identity. Each role gets its own gRPC connection, its
 * own signing key, and its own view of the network - this is what makes
 * "acting as Manager" or "acting as User" a real cryptographic distinction
 * rather than a UI toggle.
 */
export async function getConnection(roleName: RoleName): Promise<RoleConnection> {
  const existing = connections.get(roleName);
  if (existing) return existing;

  const role = config[roleName];
  const net = config.network;

  const client = newGrpcConnection(net);
  const gateway = connect({
    client,
    identity: newIdentity(role),
    signer: newSigner(role),
    evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
    endorseOptions: () => ({ deadline: Date.now() + 15000 }),
    submitOptions: () => ({ deadline: Date.now() + 5000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
  });

  const network = gateway.getNetwork(net.channelName);
  // All four contracts live in the same chaincode package - the second
  // argument picks which one, exactly like the ContractName:Function
  // syntax used on the CLI.
  const didContract = network.getContract(net.chaincodeName, 'DIDRegistryContract');
  const rbacContract = network.getContract(net.chaincodeName, 'RBACEngineContract');
  const assetContract = network.getContract(net.chaincodeName, 'AssetRegistryContract');
  const auditContract = network.getContract(net.chaincodeName, 'AuditContract');

  const conn: RoleConnection = { gateway, client, didContract, rbacContract, assetContract, auditContract };
  connections.set(roleName, conn);
  return conn;
}

export function getRoleInfo(roleName: RoleName): RoleIdentity {
  return config[roleName];
}

export function getAllRoleInfo(): Record<RoleName, RoleIdentity> {
  return { ADMIN: config.ADMIN, MANAGER: config.MANAGER, AUDITOR: config.AUDITOR, USER: config.USER };
}

export function closeAll(): void {
  for (const conn of connections.values()) {
    conn.gateway.close();
    conn.client.close();
  }
}
```

### `bel-ui/backend/src/server.ts`

```typescript
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getAllRoleInfo, getConnection, getRoleInfo, loadConfig, RoleName } from './gateway';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const IDENTITIES_PATH = process.env.IDENTITIES_PATH || path.join(__dirname, '..', '..', 'identities.json');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

const ROLE_META: Record<RoleName, { displayName: string; description: string }> = {
  ADMIN: {
    displayName: 'Admin',
    description: 'CMD / Functional Director tier — manages identities, defines roles, and mints approved assets',
  },
  MANAGER: {
    displayName: 'Manager',
    description: 'Executive Director / GM / Divisional Head tier — approves assets and access delegations within their unit',
  },
  AUDITOR: {
    displayName: 'Auditor',
    description: 'Audit Committee tier — read-only access to the full immutable trail, across every unit',
  },
  USER: {
    displayName: 'User',
    description: 'Departmental Head tier — uploads assets and requests access delegation',
  },
};

const PERMISSION_CATALOG = [
  'MANAGE_IDENTITY', 'MANAGE_ROLE', 'MINT_ASSET', 'APPROVE_ASSET',
  'GRANT_ACCESS', 'REVOKE_ACCESS', 'APPROVE_DELEGATION', 'VIEW_AUDIT',
  'VIEW', 'DOWNLOAD', 'UPLOAD_ASSET', 'REQUEST_ACCESS_DELEGATION',
];

const ROLE_NAMES: RoleName[] = ['ADMIN', 'MANAGER', 'AUDITOR', 'USER'];

/** Fabric Gateway errors often wrap the real chaincode message inside a
 * longer gRPC error string. Best-effort extraction of the readable part;
 * falls back to the full message if the pattern doesn't match. The raw
 * error is always logged server-side too. */
function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/message:\s*"?([^"\n]+)"?/) || raw.match(/Error:\s*(.+)/);
  return match ? match[1].trim() : raw;
}

function parseRole(req: express.Request): RoleName | null {
  const role = (req.query.role || req.body?.role) as string | undefined;
  return role && ROLE_NAMES.includes(role as RoleName) ? (role as RoleName) : null;
}

/** Every locally-stored file is named "<assetId>__<original file name>" so
 * a download handler can find it by assetId alone without needing a
 * separate on-chain "storage path" field (the ledger only ever sees the
 * hash + metadata, never a filesystem path). */
function uploadedFilePath(assetId: string): string | null {
  const prefix = `${assetId}__`;
  const match = fs.readdirSync(UPLOADS_DIR).find((f) => f.startsWith(prefix));
  return match ? path.join(UPLOADS_DIR, match) : null;
}

async function main() {
  loadConfig(IDENTITIES_PATH);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const app = express();
  const frontendOrigin = process.env.FRONTEND_ORIGIN || '*';
  app.use(cors({ origin: frontendOrigin }));
  app.use(express.json());
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  // ---- Config / session -----------------------------------------------

  app.get('/api/config', (_req, res) => {
    const allRoles = getAllRoleInfo();
    const roles = ROLE_NAMES.reduce((acc, r) => {
      const info = allRoles[r];
      acc[r] = { ...ROLE_META[r], did: info.did, orgUnit: info.orgUnit, orgScope: info.orgScope };
      return acc;
    }, {} as Record<string, unknown>);
    res.json({ roles, permissionCatalog: PERMISSION_CATALOG });
  });

  /** Writes an AUTHENTICATE audit event and returns the role's DID. Call
   * this once whenever the UI switches to acting as a given role. */
  app.post('/api/login', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.didContract.submitTransaction('RecordLogin');
      res.json({ ok: true, did: Buffer.from(bytes).toString() });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.get('/api/permissions/:role', async (req, res) => {
    const roleName = req.params.role as RoleName;
    if (!ROLE_NAMES.includes(roleName)) return res.status(400).json({ error: 'unknown role' });
    const info = getRoleInfo(roleName);
    try {
      const conn = await getConnection(roleName);
      const result: Record<string, boolean> = {};
      for (const perm of PERMISSION_CATALOG) {
        const bytes = await conn.rbacContract.evaluateTransaction('HasPermission', info.did, perm, info.orgScope);
        result[perm] = Buffer.from(bytes).toString() === 'true';
      }
      res.json({ permissions: result });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  // ---- Identity (Admin: Directory / Verification) ----------------------

  app.get('/api/identities', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.didContract.evaluateTransaction('ListIdentities');
      res.json({ identities: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/identities/by-org/:orgUnit', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.didContract.evaluateTransaction('ListIdentitiesByOrgUnit', req.params.orgUnit);
      res.json({ identities: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/identities/pending', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.didContract.evaluateTransaction('ListPendingOnboarding');
      res.json({ pending: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.post('/api/identities/request-onboarding', async (req, res) => {
    const role = parseRole(req);
    const { subjectDID, orgUnit } = req.body as { subjectDID: string; orgUnit: string };
    if (!role || !subjectDID || !orgUnit) return res.status(400).json({ error: 'role, subjectDID, orgUnit required' });
    try {
      const conn = await getConnection(role);
      await conn.didContract.submitTransaction('RequestOnboarding', subjectDID, orgUnit);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  for (const [action, fn] of [
    ['activate', 'ActivateIdentity'],
    ['suspend', 'SuspendIdentity'],
    ['deactivate', 'DeactivateIdentity'],
  ] as const) {
    app.post(`/api/identities/:did/${action}`, async (req, res) => {
      const role = parseRole(req);
      if (!role) return res.status(400).json({ error: 'unknown role' });
      try {
        const conn = await getConnection(role);
        await conn.didContract.submitTransaction(fn, req.params.did);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ ok: false, error: cleanError(err) });
      }
    });
  }

  // ---- Roles & Policies (Admin) ----------------------------------------

  app.get('/api/roles', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.rbacContract.evaluateTransaction('ListRoles');
      res.json({ roles: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.post('/api/roles/define', async (req, res) => {
    const role = parseRole(req);
    const { roleId, name, permissionsCSV, orgScope } = req.body as Record<string, string>;
    if (!role || !roleId || !name || !permissionsCSV || !orgScope) {
      return res.status(400).json({ error: 'role, roleId, name, permissionsCSV, orgScope required' });
    }
    try {
      const conn = await getConnection(role);
      await conn.rbacContract.submitTransaction('DefineRole', roleId, name, permissionsCSV, orgScope);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.post('/api/roles/grant', async (req, res) => {
    const role = parseRole(req);
    const { subjectDID, roleId, orgScope, expiresAt } = req.body as Record<string, string>;
    if (!role || !subjectDID || !roleId || !orgScope) {
      return res.status(400).json({ error: 'role, subjectDID, roleId, orgScope required' });
    }
    try {
      const conn = await getConnection(role);
      await conn.rbacContract.submitTransaction('GrantRole', subjectDID, roleId, orgScope, expiresAt || '');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.post('/api/roles/revoke', async (req, res) => {
    const role = parseRole(req);
    const { subjectDID, roleId, orgScope } = req.body as Record<string, string>;
    if (!role || !subjectDID || !roleId || !orgScope) {
      return res.status(400).json({ error: 'role, subjectDID, roleId, orgScope required' });
    }
    try {
      const conn = await getConnection(role);
      await conn.rbacContract.submitTransaction('RevokeRole', subjectDID, roleId, orgScope);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  // ---- Assets ------------------------------------------------------------

  /** Multipart upload: the file's bytes never touch the chain. We hash them,
   * submit the hash + metadata to AssetRegistryContract.UploadAsset, and
   * only once we have the resulting assetId do we write the file to local
   * disk (named "<assetId>__<originalname>") - see uploadedFilePath(). */
  app.post('/api/assets/upload', upload.single('file'), async (req, res) => {
    const role = parseRole(req);
    const orgScope = req.body?.orgScope as string | undefined;
    if (!role || !req.file || !orgScope) {
      return res.status(400).json({ error: 'role, file, orgScope required' });
    }
    try {
      const conn = await getConnection(role);
      const sha256Hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const bytes = await conn.assetContract.submitTransaction(
        'UploadAsset', req.file.originalname, sha256Hash, orgScope,
      );
      const assetId = Buffer.from(bytes).toString();
      fs.writeFileSync(path.join(UPLOADS_DIR, `${assetId}__${req.file.originalname}`), req.file.buffer);
      res.json({ ok: true, assetId, sha256Hash });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.get('/api/assets', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.assetContract.evaluateTransaction('ListAssets');
      res.json({ assets: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/assets/mine', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const did = getRoleInfo(role).did;
      const bytes = await conn.assetContract.evaluateTransaction('ListMyAssets', did);
      res.json({ assets: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/assets/pending-approval', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.assetContract.evaluateTransaction('ListPendingApprovals');
      res.json({ assets: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/assets/pending-mint', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.assetContract.evaluateTransaction('ListPendingMints');
      res.json({ assets: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.post('/api/assets/:id/approve', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      await conn.assetContract.submitTransaction('ApproveAsset', req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.post('/api/assets/:id/reject', async (req, res) => {
    const role = parseRole(req);
    const reason = (req.body?.reason as string) || '';
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      await conn.assetContract.submitTransaction('RejectAsset', req.params.id, reason);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.post('/api/assets/:id/mint', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      await conn.assetContract.submitTransaction('MintAsset', req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.get('/api/assets/:id/view', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const did = getRoleInfo(role).did;
      const allowedBytes = await conn.assetContract.evaluateTransaction('HasAssetAccess', req.params.id, did, 'VIEW');
      if (Buffer.from(allowedBytes).toString() !== 'true') {
        return res.status(403).json({ error: `lacks VIEW access on ${req.params.id}` });
      }
      const bytes = await conn.assetContract.evaluateTransaction('GetAsset', req.params.id);
      res.json({ asset: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/assets/:id/download', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const did = getRoleInfo(role).did;
      const allowedBytes = await conn.assetContract.evaluateTransaction('HasAssetAccess', req.params.id, did, 'DOWNLOAD');
      if (Buffer.from(allowedBytes).toString() !== 'true') {
        return res.status(403).json({ error: `lacks DOWNLOAD access on ${req.params.id}` });
      }
      const filePath = uploadedFilePath(req.params.id);
      if (!filePath) return res.status(404).json({ error: 'file not found on this server' });
      res.download(filePath, path.basename(filePath).split('__').slice(1).join('__'));
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  // ---- Access delegation ---------------------------------------------

  app.post('/api/delegations/request', async (req, res) => {
    const role = parseRole(req);
    const { assetId, targetDID, permissionsCSV } = req.body as Record<string, string>;
    if (!role || !assetId || !targetDID || !permissionsCSV) {
      return res.status(400).json({ error: 'role, assetId, targetDID, permissionsCSV required' });
    }
    try {
      const conn = await getConnection(role);
      const bytes = await conn.assetContract.submitTransaction(
        'RequestAccessDelegation', assetId, targetDID, permissionsCSV,
      );
      res.json({ ok: true, requestId: Buffer.from(bytes).toString() });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.get('/api/delegations', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.assetContract.evaluateTransaction('ListDelegations');
      res.json({ delegations: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/delegations/mine', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const did = getRoleInfo(role).did;
      const bytes = await conn.assetContract.evaluateTransaction('ListMyDelegationRequests', did);
      res.json({ delegations: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.post('/api/delegations/:id/approve', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      await conn.assetContract.submitTransaction('ApproveDelegation', req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.post('/api/delegations/:id/reject', async (req, res) => {
    const role = parseRole(req);
    const reason = (req.body?.reason as string) || '';
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      await conn.assetContract.submitTransaction('RejectDelegation', req.params.id, reason);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  // ---- Audit trail (Auditor, plus anyone else VIEW_AUDIT is granted to) --

  app.get('/api/audit', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.auditContract.evaluateTransaction('ListEvents');
      res.json({ events: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  /** Self-scoped: always the caller's own events, regardless of whether
   * they hold VIEW_AUDIT. Powers User's "Recent Activity" page. */
  app.get('/api/audit/mine', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.auditContract.evaluateTransaction('ListMyEvents');
      res.json({ events: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  // Serves the built frontend (npm run build in frontend/) from this same
  // process, so a demo tunnel only ever needs to expose ONE port. Requests
  // become same-origin, sidestepping CORS entirely for this path.
  const frontendDist = process.env.FRONTEND_DIST || path.join(__dirname, '..', '..', 'frontend', 'dist');
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`BEL demo API listening on http://localhost:${PORT}`);
    console.log(`Reading identities from ${IDENTITIES_PATH}`);
    console.log(`Storing uploaded files in ${UPLOADS_DIR}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
```

### `bel-ui/frontend/package.json`

```json
{
  "name": "bel-ui-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.4.5",
    "vite": "^5.3.1"
  }
}
```

### `bel-ui/frontend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

### `bel-ui/frontend/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
```

### `bel-ui/frontend/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BEL Identity &amp; Asset Console</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `bel-ui/frontend/src/vite-env.d.ts`

```typescript
/// <reference types="vite/client" />
```

### `bel-ui/frontend/src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

### `bel-ui/frontend/src/App.tsx`

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Login from './Login';
import PortalLayout from './PortalLayout';

import AdminDashboard from './pages/admin/Dashboard';
import Directory from './pages/admin/Directory';
import Verification from './pages/admin/Verification';
import MintQueue from './pages/admin/MintQueue';
import AdminAssetRegistry from './pages/admin/AssetRegistry';
import Roles from './pages/admin/Roles';
import AdminAuditTrail from './pages/admin/AuditTrail';
import Network from './pages/admin/Network';

import ManagerDashboard from './pages/manager/Dashboard';
import ApprovalQueue from './pages/manager/ApprovalQueue';
import ManagerAssets from './pages/manager/Assets';
import TeamMembers from './pages/manager/TeamMembers';
import ManagerAuditLog from './pages/manager/AuditLog';

import AuditorDashboard from './pages/auditor/Dashboard';
import AuditEvents from './pages/auditor/AuditEvents';
import AssetHistory from './pages/auditor/AssetHistory';
import IdentityHistory from './pages/auditor/IdentityHistory';

import UserDashboard from './pages/user/Dashboard';
import MyAssets from './pages/user/MyAssets';
import Upload from './pages/user/Upload';
import Delegations from './pages/user/Delegations';
import RecentActivity from './pages/user/RecentActivity';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />

        <Route path="/admin" element={<PortalLayout role="ADMIN" />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="directory" element={<Directory />} />
          <Route path="verification" element={<Verification />} />
          <Route path="mint-queue" element={<MintQueue />} />
          <Route path="assets" element={<AdminAssetRegistry />} />
          <Route path="roles" element={<Roles />} />
          <Route path="audit" element={<AdminAuditTrail />} />
          <Route path="network" element={<Network />} />
        </Route>

        <Route path="/manager" element={<PortalLayout role="MANAGER" />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<ManagerDashboard />} />
          <Route path="approvals" element={<ApprovalQueue />} />
          <Route path="assets" element={<ManagerAssets />} />
          <Route path="team" element={<TeamMembers />} />
          <Route path="audit" element={<ManagerAuditLog />} />
        </Route>

        <Route path="/auditor" element={<PortalLayout role="AUDITOR" />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AuditorDashboard />} />
          <Route path="audit-events" element={<AuditEvents />} />
          <Route path="asset-history" element={<AssetHistory />} />
          <Route path="identity-history" element={<IdentityHistory />} />
        </Route>

        <Route path="/user" element={<PortalLayout role="USER" />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<UserDashboard />} />
          <Route path="my-assets" element={<MyAssets />} />
          <Route path="upload" element={<Upload />} />
          <Route path="delegations" element={<Delegations />} />
          <Route path="activity" element={<RecentActivity />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### `bel-ui/frontend/src/Login.tsx`

```tsx
import { CSSProperties, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfigResponse, fetchConfig, login, RoleName } from './api';
import { ROLE_ACCENT, ROLE_HOME, setActiveRole } from './session';
import belLogo from './assets/bel-logo.png';

const ROLE_ORDER: RoleName[] = ['ADMIN', 'MANAGER', 'AUDITOR', 'USER'];

const FEATURES = [
  'DID Registry with a 4-state identity lifecycle',
  'RBAC Engine enforced on every state-changing call',
  'Asset Registry backed by on-chain SHA-256 hashes',
  'Explicit, immutable on-chain audit trail',
];

export default function Login() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entering, setEntering] = useState<RoleName | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchConfig().then(setConfig).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function enter(role: RoleName) {
    setEntering(role);
    try {
      await login(role);
      setActiveRole(role);
      navigate(ROLE_HOME[role]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntering(null);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-hero">
        <div className="login-logo-chip">
          <img src={belLogo} alt="Bharat Electronics Limited" />
        </div>

        <div className="login-hero-copy">
          <span className="login-hero-eyebrow">SIH26125 · BEL</span>
          <h1 className="login-hero-title">Identity &amp; Asset Console</h1>
          <p className="login-hero-sub">
            A single console over a live Hyperledger Fabric ledger — decentralized identities, role-based access
            control, and an on-chain asset registry, all enforced by chaincode rather than application code.
          </p>
        </div>

        <div className="login-hero-features">
          {FEATURES.map((f) => (
            <div className="login-hero-feature" key={f}>
              <span className="dot" />
              {f}
            </div>
          ))}
        </div>

        <span className="login-hero-foot">Channel: belchannel · Chaincode: belid</span>
      </div>

      <div className="login-panel">
        <div className="login-panel-inner">
          <div className="login-panel-heading">
            <h1>Choose your identity</h1>
            <p>Each card is a real, distinct Fabric identity — entering logs an on-chain AUTHENTICATE event.</p>
          </div>

          {error && <div className="notice notice-bad login-error">{error}</div>}

          {!config ? (
            <div className="state-msg dim">Connecting to the backend…</div>
          ) : (
            <div className="login-grid">
              {ROLE_ORDER.map((role) => {
                const info = config.roles[role];
                return (
                  <button
                    key={role}
                    className="login-card"
                    style={{ '--role-accent': ROLE_ACCENT[role] } as CSSProperties}
                    onClick={() => enter(role)}
                    disabled={entering !== null}
                  >
                    <div className="login-card-top">
                      <span className="login-card-dot" />
                      <span className="login-card-role">{info.displayName}</span>
                    </div>
                    <span className="login-card-desc">{info.description}</span>
                    <span className="login-card-did mono dim">{info.did}</span>
                    <span className="login-card-cta">{entering === role ? 'Entering…' : 'Enter portal →'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

### `bel-ui/frontend/src/PortalLayout.tsx`

```tsx
import { CSSProperties, useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { ConfigResponse, fetchConfig, RoleConfig, RoleName } from './api';
import { clearActiveRole, getActiveRole, ROLE_ACCENT } from './session';
import { NAV_CONFIG, PORTAL_TITLE } from './navConfig';
import Icon from './components/Icon';
import belLogo from './assets/bel-logo.png';

export interface PortalContext {
  role: RoleName;
  roleConfig: RoleConfig;
  permissionCatalog: string[];
}

export default function PortalLayout({ role }: { role: RoleName }) {
  const active = getActiveRole();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchConfig().then(setConfig).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (!active) return <Navigate to="/login" replace />;
  if (active !== role) return <Navigate to="/login" replace />;

  function switchIdentity() {
    clearActiveRole();
    navigate('/login');
  }

  if (error) {
    return (
      <div className="app-error">
        <p>Could not reach the backend API.</p>
        <p className="mono dim">{error}</p>
        <p className="dim">Make sure the backend is running (npm start in bel-ui/backend).</p>
      </div>
    );
  }
  if (!config) return <div className="app-loading">Connecting…</div>;

  const roleConfig = config.roles[role];
  const nav = NAV_CONFIG[role];
  const accent = ROLE_ACCENT[role];

  return (
    <div className="portal-shell" style={{ '--role-accent': accent } as CSSProperties}>
      <nav className="portal-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo-chip">
            <img src={belLogo} alt="Bharat Electronics Limited" />
          </div>
          <div>
            <span className="sidebar-brand-main">{PORTAL_TITLE[role]}</span>
            <br />
            <span className="sidebar-brand-sub">{roleConfig.orgUnit}</span>
          </div>
        </div>
        <ul className="sidebar-nav">
          {nav.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link')}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <button className="sidebar-link sidebar-switch" onClick={switchIdentity}>
          <Icon name="logout" />
          <span>Switch identity</span>
        </button>
      </nav>

      <div className="portal-main">
        <header className="portal-topbar">
          <div>
            <h1>{roleConfig.displayName}</h1>
            <p className="dim">{roleConfig.description}</p>
          </div>
          <div className="topbar-identity">
            <span className="mono">{roleConfig.did}</span>
            <span className="dim">{roleConfig.orgScope === '*' ? 'All units' : roleConfig.orgScope}</span>
          </div>
        </header>
        <main className="portal-content">
          <Outlet context={{ role, roleConfig, permissionCatalog: config.permissionCatalog } satisfies PortalContext} />
        </main>
      </div>
    </div>
  );
}
```

### `bel-ui/frontend/src/api.ts`

```typescript
// Set VITE_API_BASE at build time (see .env.production) to point this at
// the deployed backend instead of your local machine. An explicitly empty
// value means "same origin" - used when the backend serves this built
// frontend itself.
const envApiBase = (import.meta as any).env?.VITE_API_BASE;
const API_BASE = envApiBase !== undefined ? envApiBase : 'http://localhost:4000';

export type RoleName = 'ADMIN' | 'MANAGER' | 'AUDITOR' | 'USER';

export interface RoleConfig {
  displayName: string;
  description: string;
  did: string;
  orgUnit: string;
  orgScope: string;
}

export interface ConfigResponse {
  roles: Record<RoleName, RoleConfig>;
  permissionCatalog: string[];
}

export type DIDStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface DIDDocument {
  did: string;
  orgUnit: string;
  status: DIDStatus;
  createdAt: string;
  createdBy: string;
}

export interface Role {
  roleId: string;
  name: string;
  permissions: string[];
  orgScope: string;
}

export type AssetStatus = 'PENDING_APPROVAL' | 'PENDING_MINT' | 'ACTIVE' | 'REJECTED';

export interface AssetDocument {
  assetId: string;
  fileName: string;
  sha256Hash: string;
  orgScope: string;
  status: AssetStatus;
  uploadedBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  mintedBy?: string;
  mintedAt?: string;
  permissions?: string[];
}

export type DelegationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface DelegationRequest {
  requestId: string;
  assetId: string;
  requestedBy: string;
  targetDID: string;
  permissionsCSV: string;
  status: DelegationStatus;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  result: 'SUCCESS' | 'FAILURE';
  message?: string;
  timestamp: string;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: opts.body instanceof FormData ? opts.headers : { 'Content-Type': 'application/json', ...opts.headers },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    throw new Error((data && (data.error || data.message)) || `${res.status} ${res.statusText}`);
  }
  return data as T;
}

function withRole(path: string, role: RoleName): string {
  return `${path}${path.includes('?') ? '&' : '?'}role=${role}`;
}

// ---- Config / session ----------------------------------------------------

export function fetchConfig(): Promise<ConfigResponse> {
  return req('/api/config');
}

export function login(role: RoleName): Promise<{ ok: boolean; did: string }> {
  return req('/api/login', { method: 'POST', body: JSON.stringify({ role }) });
}

export async function fetchPermissions(role: RoleName): Promise<Record<string, boolean>> {
  const data = await req<{ permissions: Record<string, boolean> }>(`/api/permissions/${role}`);
  return data.permissions;
}

// ---- Identity --------------------------------------------------------------

export async function fetchIdentities(role: RoleName): Promise<DIDDocument[]> {
  const data = await req<{ identities: DIDDocument[] }>(withRole('/api/identities', role));
  return data.identities;
}

export async function fetchIdentitiesByOrgUnit(role: RoleName, orgUnit: string): Promise<DIDDocument[]> {
  const data = await req<{ identities: DIDDocument[] }>(withRole(`/api/identities/by-org/${encodeURIComponent(orgUnit)}`, role));
  return data.identities;
}

export async function fetchPendingOnboarding(role: RoleName): Promise<DIDDocument[]> {
  const data = await req<{ pending: DIDDocument[] }>(withRole('/api/identities/pending', role));
  return data.pending;
}

export function requestOnboarding(role: RoleName, subjectDID: string, orgUnit: string) {
  return req<{ ok: boolean }>('/api/identities/request-onboarding', {
    method: 'POST',
    body: JSON.stringify({ role, subjectDID, orgUnit }),
  });
}

export function activateIdentity(role: RoleName, did: string) {
  return req<{ ok: boolean }>(withRole(`/api/identities/${encodeURIComponent(did)}/activate`, role), { method: 'POST' });
}

export function suspendIdentity(role: RoleName, did: string) {
  return req<{ ok: boolean }>(withRole(`/api/identities/${encodeURIComponent(did)}/suspend`, role), { method: 'POST' });
}

export function deactivateIdentity(role: RoleName, did: string) {
  return req<{ ok: boolean }>(withRole(`/api/identities/${encodeURIComponent(did)}/deactivate`, role), { method: 'POST' });
}

// ---- Roles & policies -------------------------------------------------------

export async function fetchRoles(role: RoleName): Promise<Role[]> {
  const data = await req<{ roles: Role[] }>(withRole('/api/roles', role));
  return data.roles;
}

export function defineRole(role: RoleName, roleId: string, name: string, permissionsCSV: string, orgScope: string) {
  return req<{ ok: boolean }>('/api/roles/define', {
    method: 'POST',
    body: JSON.stringify({ role, roleId, name, permissionsCSV, orgScope }),
  });
}

export function grantRole(role: RoleName, subjectDID: string, roleId: string, orgScope: string, expiresAt?: string) {
  return req<{ ok: boolean }>('/api/roles/grant', {
    method: 'POST',
    body: JSON.stringify({ role, subjectDID, roleId, orgScope, expiresAt }),
  });
}

export function revokeRole(role: RoleName, subjectDID: string, roleId: string, orgScope: string) {
  return req<{ ok: boolean }>('/api/roles/revoke', {
    method: 'POST',
    body: JSON.stringify({ role, subjectDID, roleId, orgScope }),
  });
}

// ---- Assets ------------------------------------------------------------------

export async function uploadAsset(role: RoleName, file: File, orgScope: string) {
  const form = new FormData();
  form.append('file', file);
  form.append('role', role);
  form.append('orgScope', orgScope);
  return req<{ ok: boolean; assetId: string; sha256Hash: string }>('/api/assets/upload', {
    method: 'POST',
    body: form,
  });
}

export async function fetchAssets(role: RoleName): Promise<AssetDocument[]> {
  const data = await req<{ assets: AssetDocument[] }>(withRole('/api/assets', role));
  return data.assets;
}

export async function fetchMyAssets(role: RoleName): Promise<AssetDocument[]> {
  const data = await req<{ assets: AssetDocument[] }>(withRole('/api/assets/mine', role));
  return data.assets;
}

export async function fetchPendingApprovals(role: RoleName): Promise<AssetDocument[]> {
  const data = await req<{ assets: AssetDocument[] }>(withRole('/api/assets/pending-approval', role));
  return data.assets;
}

export async function fetchPendingMints(role: RoleName): Promise<AssetDocument[]> {
  const data = await req<{ assets: AssetDocument[] }>(withRole('/api/assets/pending-mint', role));
  return data.assets;
}

export function approveAsset(role: RoleName, id: string) {
  return req<{ ok: boolean }>(withRole(`/api/assets/${id}/approve`, role), { method: 'POST' });
}

export function rejectAsset(role: RoleName, id: string, reason: string) {
  return req<{ ok: boolean }>(withRole(`/api/assets/${id}/reject`, role), {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function mintAsset(role: RoleName, id: string) {
  return req<{ ok: boolean }>(withRole(`/api/assets/${id}/mint`, role), { method: 'POST' });
}

export function viewAsset(role: RoleName, id: string) {
  return req<{ asset: AssetDocument }>(withRole(`/api/assets/${id}/view`, role));
}

export function downloadAssetUrl(role: RoleName, id: string): string {
  return `${API_BASE}${withRole(`/api/assets/${id}/download`, role)}`;
}

// ---- Delegations -------------------------------------------------------------

export function requestDelegation(role: RoleName, assetId: string, targetDID: string, permissionsCSV: string) {
  return req<{ ok: boolean; requestId: string }>('/api/delegations/request', {
    method: 'POST',
    body: JSON.stringify({ role, assetId, targetDID, permissionsCSV }),
  });
}

export async function fetchDelegations(role: RoleName): Promise<DelegationRequest[]> {
  const data = await req<{ delegations: DelegationRequest[] }>(withRole('/api/delegations', role));
  return data.delegations;
}

export async function fetchMyDelegations(role: RoleName): Promise<DelegationRequest[]> {
  const data = await req<{ delegations: DelegationRequest[] }>(withRole('/api/delegations/mine', role));
  return data.delegations;
}

export function approveDelegation(role: RoleName, id: string) {
  return req<{ ok: boolean }>(withRole(`/api/delegations/${id}/approve`, role), { method: 'POST' });
}

export function rejectDelegation(role: RoleName, id: string, reason: string) {
  return req<{ ok: boolean }>(withRole(`/api/delegations/${id}/reject`, role), {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// ---- Audit ---------------------------------------------------------------------

export async function fetchAuditEvents(role: RoleName): Promise<AuditEvent[]> {
  const data = await req<{ events: AuditEvent[] }>(withRole('/api/audit', role));
  return data.events;
}

export async function fetchMyAuditEvents(role: RoleName): Promise<AuditEvent[]> {
  const data = await req<{ events: AuditEvent[] }>(withRole('/api/audit/mine', role));
  return data.events;
}
```

### `bel-ui/frontend/src/session.ts`

```typescript
import { RoleName } from './api';

const KEY = 'bel.activeRole';

// Which identity the UI is currently acting as. There's no password login -
// each role IS a real, distinct Fabric identity (see identities.json) - this
// just remembers which one the browser tab is currently using, the same way
// a real SSO session cookie would, so a refresh doesn't drop you back to the
// role picker.
export function getActiveRole(): RoleName | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'ADMIN' || v === 'MANAGER' || v === 'AUDITOR' || v === 'USER' ? v : null;
  } catch {
    return null;
  }
}

export function setActiveRole(role: RoleName): void {
  try {
    window.localStorage.setItem(KEY, role);
  } catch {
    /* ignore */
  }
}

export function clearActiveRole(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const ROLE_HOME: Record<RoleName, string> = {
  ADMIN: '/admin/dashboard',
  MANAGER: '/manager/dashboard',
  AUDITOR: '/auditor/dashboard',
  USER: '/user/dashboard',
};

// Harmonized with the BEL brand blue (#00adef / navy #0a2e4d) - each role
// gets a distinguishable but related hue rather than a clashing rainbow.
export const ROLE_ACCENT: Record<RoleName, string> = {
  ADMIN: '#0a2e4d',
  MANAGER: '#0f8a7a',
  AUDITOR: '#5b5fc7',
  USER: '#00adef',
};
```

### `bel-ui/frontend/src/navConfig.ts`

```typescript
import { IconName } from './components/Icon';
import { RoleName } from './api';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

export const NAV_CONFIG: Record<RoleName, NavItem[]> = {
  ADMIN: [
    { to: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: 'directory', label: 'Directory', icon: 'directory' },
    { to: 'verification', label: 'Verification', icon: 'verify' },
    { to: 'mint-queue', label: 'Mint Queue', icon: 'mint' },
    { to: 'assets', label: 'Asset Registry', icon: 'asset' },
    { to: 'roles', label: 'Roles & Policies', icon: 'roles' },
    { to: 'audit', label: 'Audit Trail', icon: 'audit' },
    { to: 'network', label: 'Network', icon: 'network' },
  ],
  MANAGER: [
    { to: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: 'approvals', label: 'Approval Queue', icon: 'approve' },
    { to: 'assets', label: 'Assets', icon: 'asset' },
    { to: 'team', label: 'Team Members', icon: 'team' },
    { to: 'audit', label: 'Audit Log', icon: 'audit' },
  ],
  AUDITOR: [
    { to: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: 'audit-events', label: 'Audit Events', icon: 'audit' },
    { to: 'asset-history', label: 'Asset History', icon: 'asset' },
    { to: 'identity-history', label: 'Identity History', icon: 'directory' },
  ],
  USER: [
    { to: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: 'my-assets', label: 'My Assets', icon: 'asset' },
    { to: 'upload', label: 'Upload', icon: 'upload' },
    { to: 'delegations', label: 'Delegation Requests', icon: 'delegation' },
    { to: 'activity', label: 'Recent Activity', icon: 'activity' },
  ],
};

export const PORTAL_TITLE: Record<RoleName, string> = {
  ADMIN: 'BEL Admin',
  MANAGER: 'BEL Manager Portal',
  AUDITOR: 'BEL Auditor',
  USER: 'BEL User Portal',
};
```

### `bel-ui/frontend/src/index.css`

```css
:root {
  --bel-blue: #00adef;
  --bel-blue-dark: #0089c2;
  --bel-navy: #0a2e4d;
  --bel-navy-deep: #071f36;

  --bg: #f2f5f8;
  --panel: #ffffff;
  --panel-alt: #f5f8fb;
  --text: #171d26;
  --text-dim: #6c7787;
  --border: #e2e8f0;
  --border-strong: #cdd7e3;
  --accent: var(--bel-blue);
  --red: #d1453b;
  --green: #1d9a63;
  --role-accent: var(--bel-blue);

  --shadow-sm: 0 1px 2px rgba(10, 46, 77, 0.06);
  --shadow-md: 0 4px 16px rgba(10, 46, 77, 0.08);
  --shadow-lg: 0 16px 40px rgba(10, 46, 77, 0.16);

  --font-sans: 'Inter', 'IBM Plex Sans', -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'IBM Plex Mono', 'SFMono-Regular', monospace;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

.mono {
  font-family: var(--font-mono);
}

.dim {
  color: var(--text-dim);
}

button {
  font-family: inherit;
}

button:focus-visible {
  outline: 2px solid var(--role-accent);
  outline-offset: 2px;
}

.app-loading,
.app-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  color: var(--text-dim);
  padding: 24px;
  text-align: center;
}

/* ---- Login ------------------------------------------------------------ */

.login-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(320px, 42%) 1fr;
}

.login-hero {
  position: relative;
  background: radial-gradient(circle at 20% 20%, #123a5e 0%, var(--bel-navy) 45%, var(--bel-navy-deep) 100%);
  color: #fff;
  padding: 56px 48px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}

.login-hero::before {
  content: '';
  position: absolute;
  width: 480px;
  height: 480px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 173, 239, 0.35), transparent 70%);
  top: -140px;
  right: -160px;
}

.login-hero::after {
  content: '';
  position: absolute;
  width: 360px;
  height: 360px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 173, 239, 0.18), transparent 70%);
  bottom: -120px;
  left: -100px;
}

.login-logo-chip {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.96);
  padding: 10px 16px;
  border-radius: 10px;
  width: fit-content;
  box-shadow: var(--shadow-md);
}

.login-logo-chip img {
  height: 34px;
  width: auto;
  display: block;
}

.login-hero-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 440px;
}

.login-hero-eyebrow {
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9fd8f5;
  font-weight: 600;
}

.login-hero-title {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
}

.login-hero-sub {
  font-size: 14.5px;
  color: #c7dcec;
  line-height: 1.6;
  margin: 0;
}

.login-hero-features {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.login-hero-feature {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #dcecf8;
}

.login-hero-feature .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bel-blue);
  flex-shrink: 0;
  box-shadow: 0 0 8px rgba(0, 173, 239, 0.9);
}

.login-hero-foot {
  position: relative;
  z-index: 1;
  font-size: 11.5px;
  color: #7fa8c4;
}

.login-panel {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 48px;
}

.login-panel-inner {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
}

.login-panel-heading {
  margin-bottom: 28px;
}

.login-panel-heading h1 {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 700;
}

.login-panel-heading p {
  margin: 0;
  color: var(--text-dim);
  font-size: 13.5px;
}

.login-error {
  margin-bottom: 16px;
}

.login-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}

.login-card {
  --role-accent: var(--bel-blue);
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  text-align: left;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 18px 16px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}

.login-card:hover:not(:disabled) {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
  border-color: var(--role-accent);
}

.login-card:disabled {
  opacity: 0.55;
  cursor: default;
}

.login-card-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.login-card-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--role-accent);
  flex-shrink: 0;
}

.login-card-role {
  font-size: 15.5px;
  font-weight: 700;
}

.login-card-desc {
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.5;
}

.login-card-did {
  font-size: 10.5px;
  word-break: break-all;
  margin-top: 2px;
}

.login-card-cta {
  margin-top: 10px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--role-accent);
}

/* ---- Portal shell ------------------------------------------------------- */

.portal-shell {
  display: flex;
  min-height: 100vh;
}

.portal-sidebar {
  width: 264px;
  min-width: 264px;
  background: linear-gradient(180deg, var(--bel-navy) 0%, var(--bel-navy-deep) 100%);
  color: #eaf3fa;
  display: flex;
  flex-direction: column;
  padding: 20px 0;
}

.sidebar-brand {
  padding: 4px 20px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sidebar-logo-chip {
  display: inline-flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.95);
  padding: 6px 10px;
  border-radius: 8px;
  width: fit-content;
}

.sidebar-logo-chip img {
  height: 22px;
  width: auto;
  display: block;
}

.sidebar-brand-main {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.sidebar-brand-sub {
  font-size: 11.5px;
  color: #9db9cd;
}

.sidebar-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  background: none;
  border: none;
  border-radius: 8px;
  margin: 2px 12px;
  padding: 10px 12px;
  color: #b7cddc;
  text-decoration: none;
  cursor: pointer;
  font-size: 13.5px;
  text-align: left;
  transition: background 0.12s ease, color 0.12s ease;
  width: calc(100% - 24px);
}

.sidebar-link:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}

.sidebar-link-active {
  background: var(--role-accent, var(--bel-blue));
  color: #fff;
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.sidebar-switch {
  margin: 12px 12px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 16px;
  color: #9db9cd;
}

.portal-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.portal-topbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  padding: 22px 36px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  box-shadow: var(--shadow-sm);
}

.portal-topbar h1 {
  margin: 0 0 4px;
  font-size: 21px;
}

.portal-topbar p {
  margin: 0;
  font-size: 13px;
  max-width: 60ch;
}

.topbar-identity {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  font-size: 12px;
  flex-shrink: 0;
}

.topbar-identity .mono {
  background: var(--panel-alt);
  border: 1px solid var(--border);
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
}

.portal-content {
  flex: 1;
  padding: 28px 36px 48px;
  max-width: 1180px;
}

/* ---- Page structure ------------------------------------------------------- */

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}

.page-header h1 {
  margin: 0 0 4px;
  font-size: 20px;
}

.page-subtitle {
  margin: 0;
  color: var(--text-dim);
  font-size: 13px;
  max-width: 62ch;
}

.page-note {
  font-size: 12px;
  margin-top: 12px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-top: 3px solid var(--role-accent, var(--bel-blue));
  border-radius: 10px;
  padding: 16px 18px;
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}

.stat-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.stat-title {
  font-size: 11.5px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.stat-value {
  font-size: 27px;
  font-weight: 700;
}

.stat-hint {
  font-size: 11px;
}

.panel-section {
  margin-bottom: 32px;
}

.panel-section h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.state-msg {
  padding: 22px;
  text-align: center;
  font-size: 13px;
  background: var(--panel-alt);
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
}

.error-msg {
  color: var(--red);
  border-color: var(--red);
  background: color-mix(in srgb, var(--red) 6%, var(--panel));
}

/* ---- Table -------------------------------------------------------------- */

.table-wrap {
  overflow-x: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-sm);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table th {
  text-align: left;
  padding: 11px 14px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  background: var(--panel-alt);
}

.data-table td {
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.data-table tr:last-child td {
  border-bottom: none;
}

.data-table tr:hover td {
  background: var(--panel-alt);
}

/* ---- Pills / status ----------------------------------------------------- */

.pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.pill-good { background: color-mix(in srgb, var(--green) 14%, white); color: var(--green); }
.pill-wait { background: color-mix(in srgb, var(--bel-blue) 14%, white); color: var(--bel-blue-dark); }
.pill-warn { background: #fbe6c8; color: #93600d; }
.pill-bad  { background: color-mix(in srgb, var(--red) 14%, white); color: var(--red); }

/* ---- Buttons / forms ------------------------------------------------------ */

.btn {
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  padding: 8px 15px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: var(--panel);
  color: var(--text);
  transition: background 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-primary {
  background: var(--role-accent, var(--bel-blue));
  border-color: var(--role-accent, var(--bel-blue));
  color: #fff;
  box-shadow: var(--shadow-sm);
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.06);
  box-shadow: var(--shadow-md);
}

.btn-ghost {
  background: transparent;
}

.btn-ghost:hover:not(:disabled) {
  background: var(--panel-alt);
}

.btn-danger {
  border-color: var(--red);
  color: var(--red);
  background: transparent;
}

.btn-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--red) 8%, white);
}

.row-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.text-input {
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  padding: 8px 11px;
  font-size: 13px;
  background: var(--panel);
  color: var(--text);
  min-width: 160px;
}

.text-input:focus {
  outline: 2px solid var(--role-accent, var(--bel-blue));
  outline-offset: 1px;
  border-color: transparent;
}

.inline-form {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 12px;
}

.stacked-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 720px;
}

.form-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.form-row .text-input {
  flex: 1;
}

.permission-checks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px 16px;
  padding: 12px;
  background: var(--panel-alt);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.notice {
  margin: 10px 0;
  padding: 10px 14px;
  border-radius: 7px;
  font-size: 13px;
  border-left: 3px solid;
}

.notice-ok {
  border-left-color: var(--green);
  background: color-mix(in srgb, var(--green) 8%, white);
}

.notice-bad {
  border-left-color: var(--red);
  background: color-mix(in srgb, var(--red) 8%, white);
}

/* ---- Modal ---------------------------------------------------------------- */

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(7, 31, 54, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 20px;
}

.modal {
  background: var(--panel);
  border-radius: 12px;
  max-width: 480px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.modal-header h3 {
  margin: 0;
  font-size: 15px;
}

.modal-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-dim);
  line-height: 1;
}

.modal-body {
  padding: 20px;
}

/* ---- Responsive ------------------------------------------------------------ */

@media (max-width: 980px) {
  .login-shell {
    grid-template-columns: 1fr;
  }
  .login-hero {
    padding: 36px 28px;
  }
  .login-panel {
    padding: 32px 24px;
  }
  .login-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .portal-shell {
    flex-direction: column;
  }
  .portal-sidebar {
    width: 100%;
    min-width: 0;
    flex-direction: row;
    overflow-x: auto;
    padding: 12px 0;
  }
  .sidebar-brand {
    display: none;
  }
  .sidebar-nav {
    display: flex;
  }
  .sidebar-switch {
    margin: 0 12px;
    border-top: none;
    padding-top: 0;
  }
  .portal-topbar {
    flex-direction: column;
  }
  .topbar-identity {
    align-items: flex-start;
  }
  .portal-content {
    padding: 20px;
  }
}
```

### `bel-ui/frontend/src/components/Icon.tsx`

```tsx
export type IconName =
  | 'dashboard' | 'directory' | 'verify' | 'mint' | 'asset' | 'roles'
  | 'audit' | 'network' | 'approve' | 'team' | 'upload' | 'delegation'
  | 'activity' | 'logout' | 'check' | 'cross' | 'download' | 'view';

const PATHS: Record<IconName, string> = {
  dashboard: 'M4 4h7v7H4V4zm9 0h7v4h-7V4zm0 7h7v9h-7v-9zM4 14h7v6H4v-6z',
  directory: 'M4 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z',
  verify: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3zM9 12l2 2 4-4',
  mint: 'M12 2l3 6 6 1-4.5 4.5L17.5 20 12 17l-5.5 3L7.5 13.5 3 9l6-1 3-6z',
  asset: 'M4 7l8-4 8 4-8 4-8-4zm0 5l8 4 8-4M4 7v10l8 4 8-4V7',
  roles: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0',
  audit: 'M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9 12h6M9 16h6M9 8h2',
  network: 'M12 3v4M12 17v4M4 12h4M16 12h4M6 6l2.5 2.5M17.5 15.5 20 18M18 6l-2.5 2.5M8.5 15.5 6 18M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  approve: 'M20 6L9 17l-5-5',
  team: 'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7 1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M15 14a6 6 0 0 1 7 6',
  upload: 'M12 16V4m0 0L7 9m5-5l5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  delegation: 'M17 8l4 4-4 4M3 12h18M7 4L3 8l4 4',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  check: 'M20 6L9 17l-5-5',
  cross: 'M18 6L6 18M6 6l12 12',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 21h16',
  view: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};

export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
```

### `bel-ui/frontend/src/components/common.tsx`

```tsx
import { ReactNode, useCallback, useEffect, useState } from 'react';

// ---- Async data loading -----------------------------------------------------

export function useLoader<T>(loadFn: () => Promise<T>, deps: unknown[]): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    loadFn()
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

export function AsyncSection({ loading, error, empty, emptyLabel, children }: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyLabel?: string;
  children: ReactNode;
}) {
  if (loading) return <div className="state-msg dim">Loading…</div>;
  if (error) return <div className="state-msg error-msg">{error}</div>;
  if (empty) return <div className="state-msg dim">{emptyLabel || 'Nothing here yet.'}</div>;
  return <>{children}</>;
}

// ---- Layout primitives -------------------------------------------------------

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </div>
  );
}

export function Card({ title, value, hint }: { title: string; value: string | number; hint?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-title">{title}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint dim">{hint}</span>}
    </div>
  );
}

export function Section({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel-section">
      {title && (
        <div className="section-header">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ---- Table --------------------------------------------------------------------

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  mono?: boolean;
}

export function DataTable<T>({ columns, rows, rowKey }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.mono ? 'mono' : undefined}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Status pills ---------------------------------------------------------------

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'pill-good',
  APPROVED: 'pill-good',
  SUCCESS: 'pill-good',
  PENDING: 'pill-wait',
  PENDING_APPROVAL: 'pill-wait',
  PENDING_MINT: 'pill-wait',
  SUSPENDED: 'pill-warn',
  REJECTED: 'pill-bad',
  DEACTIVATED: 'pill-bad',
  FAILURE: 'pill-bad',
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${STATUS_CLASS[status] || 'pill-wait'}`}>{status.replace(/_/g, ' ')}</span>;
}

// ---- Buttons + forms --------------------------------------------------------------

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button' }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button type={type} className={`btn btn-${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function InlineNotice({ ok, message }: { ok: boolean; message: string }) {
  return <div className={ok ? 'notice notice-ok' : 'notice notice-bad'}>{message}</div>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
```

### `bel-ui/frontend/src/components/AuditTable.tsx`

```tsx
import { AuditEvent } from '../api';
import { AsyncSection, Column, DataTable, StatusPill } from './common';

function fmtTime(seconds: string): string {
  const n = Number(seconds);
  if (!n) return seconds;
  return new Date(n * 1000).toLocaleString();
}

const COLUMNS: Column<AuditEvent>[] = [
  { key: 'timestamp', label: 'Time', render: (e) => fmtTime(e.timestamp) },
  { key: 'actor', label: 'Actor', mono: true, render: (e) => e.actor.replace('did:fabric:', '') },
  { key: 'action', label: 'Action' },
  { key: 'target', label: 'Target', mono: true, render: (e) => e.target.replace('did:fabric:', '') },
  { key: 'result', label: 'Result', render: (e) => <StatusPill status={e.result} /> },
  { key: 'message', label: 'Detail', render: (e) => e.message || '—' },
];

export default function AuditTable({ events, loading, error, filter }: {
  events: AuditEvent[] | null;
  loading: boolean;
  error: string | null;
  filter?: (e: AuditEvent) => boolean;
}) {
  const rows = (events || []).filter(filter || (() => true)).slice().sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
  return (
    <AsyncSection loading={loading} error={error} empty={rows.length === 0} emptyLabel="No audit events recorded yet.">
      <DataTable columns={COLUMNS} rows={rows} rowKey={(e) => e.id} />
    </AsyncSection>
  );
}
```

### `bel-ui/frontend/src/pages/admin/Dashboard.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchIdentities, fetchPendingOnboarding, fetchPendingMints, fetchRoles } from '../../api';
import { useLoader, Card, PageHeader, AsyncSection } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Dashboard() {
  const { role } = useOutletContext<PortalContext>();
  const identities = useLoader(() => fetchIdentities(role), [role]);
  const pending = useLoader(() => fetchPendingOnboarding(role), [role]);
  const mints = useLoader(() => fetchPendingMints(role), [role]);
  const roles = useLoader(() => fetchRoles(role), [role]);

  const loading = identities.loading || pending.loading || mints.loading || roles.loading;
  const error = identities.error || pending.error || mints.error || roles.error;

  const activeCount = (identities.data || []).filter((d) => d.status === 'ACTIVE').length;

  return (
    <div>
      <PageHeader title="Admin Dashboard" subtitle="Identity, role and asset oversight across the whole ledger." />
      <AsyncSection loading={loading} error={error}>
        <div className="stat-grid">
          <Card title="Active identities" value={activeCount} hint={`${(identities.data || []).length} total`} />
          <Card title="Pending onboarding" value={(pending.data || []).length} hint="awaiting activation" />
          <Card title="Pending mints" value={(mints.data || []).length} hint="approved, not yet minted" />
          <Card title="Defined roles" value={(roles.data || []).length} hint="ADMIN / MANAGER / AUDITOR / USER" />
        </div>
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/admin/Directory.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { activateIdentity, deactivateIdentity, DIDDocument, fetchIdentities, suspendIdentity } from '../../api';
import { AsyncSection, Button, Column, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';
import { useState } from 'react';

export default function Directory() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchIdentities(role), [role]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, did: string) {
    setBusy(did);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<DIDDocument>[] = [
    { key: 'did', label: 'DID', mono: true, render: (d) => d.did.replace('did:fabric:', '') },
    { key: 'orgUnit', label: 'Org Unit' },
    { key: 'status', label: 'Status', render: (d) => <StatusPill status={d.status} /> },
    { key: 'createdAt', label: 'Created' },
    {
      key: 'actions',
      label: 'Actions',
      render: (d) => (
        <div className="row-actions">
          {(d.status === 'PENDING' || d.status === 'SUSPENDED') && (
            <Button variant="ghost" disabled={busy === d.did} onClick={() => run(() => activateIdentity(role, d.did), d.did)}>
              Activate
            </Button>
          )}
          {d.status === 'ACTIVE' && (
            <Button variant="ghost" disabled={busy === d.did} onClick={() => run(() => suspendIdentity(role, d.did), d.did)}>
              Suspend
            </Button>
          )}
          {d.status !== 'DEACTIVATED' && (
            <Button variant="danger" disabled={busy === d.did} onClick={() => run(() => deactivateIdentity(role, d.did), d.did)}>
              Deactivate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Identity Directory" subtitle="Every DID ever onboarded to this ledger, with its current lifecycle state." />
      {actionError && <div className="notice notice-bad">{actionError}</div>}
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No identities on the ledger yet.">
        <DataTable columns={columns} rows={data || []} rowKey={(d) => d.did} />
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/admin/Verification.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { FormEvent, useState } from 'react';
import { activateIdentity, fetchPendingOnboarding, requestOnboarding } from '../../api';
import { AsyncSection, Button, DataTable, InlineNotice, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Verification() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchPendingOnboarding(role), [role]);
  const [subjectDID, setSubjectDID] = useState('');
  const [orgUnit, setOrgUnit] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      await requestOnboarding(role, subjectDID.trim(), orgUnit.trim());
      setNotice({ ok: true, message: `Onboarding requested for ${subjectDID}.` });
      setSubjectDID('');
      setOrgUnit('');
      reload();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  async function activate(did: string) {
    setBusy(did);
    try {
      await activateIdentity(role, did);
      reload();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Identity Verification" subtitle="Review new onboarding requests and activate them onto the ledger." />

      <section className="panel-section">
        <h2>Request onboarding for a new DID</h2>
        <form className="inline-form" onSubmit={submit}>
          <input
            className="text-input mono"
            placeholder="did:fabric:… (subject DID)"
            value={subjectDID}
            onChange={(e) => setSubjectDID(e.target.value)}
            required
          />
          <input
            className="text-input"
            placeholder="Org unit (e.g. Ghaziabad)"
            value={orgUnit}
            onChange={(e) => setOrgUnit(e.target.value)}
            required
          />
          <Button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Request onboarding'}</Button>
        </form>
        {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
      </section>

      <section className="panel-section">
        <h2>Pending requests</h2>
        <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No identities are awaiting verification.">
          <DataTable
            columns={[
              { key: 'did', label: 'DID', mono: true, render: (d) => d.did.replace('did:fabric:', '') },
              { key: 'orgUnit', label: 'Org Unit' },
              { key: 'createdAt', label: 'Requested' },
              {
                key: 'actions',
                label: 'Actions',
                render: (d) => (
                  <Button variant="ghost" disabled={busy === d.did} onClick={() => activate(d.did)}>
                    {busy === d.did ? 'Activating…' : 'Activate'}
                  </Button>
                ),
              },
            ]}
            rows={data || []}
            rowKey={(d) => d.did}
          />
        </AsyncSection>
      </section>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/admin/MintQueue.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { fetchPendingMints, mintAsset } from '../../api';
import { AsyncSection, Button, DataTable, InlineNotice, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function MintQueue() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchPendingMints(role), [role]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  async function mint(assetId: string) {
    setBusy(assetId);
    setNotice(null);
    try {
      await mintAsset(role, assetId);
      setNotice({ ok: true, message: `${assetId} minted.` });
      reload();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Mint Queue" subtitle="Assets that have cleared approval and are ready to become active on-chain records." />
      {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="Nothing waiting to be minted.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'orgScope', label: 'Org Scope' },
            { key: 'uploadedBy', label: 'Uploaded by', mono: true, render: (a) => a.uploadedBy.replace('did:fabric:', '') },
            { key: 'approvedBy', label: 'Approved by', mono: true, render: (a) => (a.approvedBy || '').replace('did:fabric:', '') },
            {
              key: 'actions',
              label: 'Actions',
              render: (a) => (
                <Button disabled={busy === a.assetId} onClick={() => mint(a.assetId)}>
                  {busy === a.assetId ? 'Minting…' : 'Mint'}
                </Button>
              ),
            },
          ]}
          rows={data || []}
          rowKey={(a) => a.assetId}
        />
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/admin/AssetRegistry.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchAssets } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function AssetRegistry() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAssets(role), [role]);

  return (
    <div>
      <PageHeader title="Asset Registry" subtitle="Every asset ever uploaded, across every org unit and lifecycle stage." />
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No assets have been uploaded yet.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'orgScope', label: 'Org Scope' },
            { key: 'status', label: 'Status', render: (a) => <StatusPill status={a.status} /> },
            { key: 'uploadedBy', label: 'Uploaded by', mono: true, render: (a) => a.uploadedBy.replace('did:fabric:', '') },
            { key: 'sha256Hash', label: 'SHA-256', mono: true, render: (a) => `${a.sha256Hash.slice(0, 16)}…` },
            { key: 'createdAt', label: 'Created' },
          ]}
          rows={data || []}
          rowKey={(a) => a.assetId}
        />
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/admin/Roles.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { FormEvent, useState } from 'react';
import { defineRole, fetchRoles, grantRole, revokeRole } from '../../api';
import { AsyncSection, Button, DataTable, InlineNotice, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

function useNotice() {
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  return { notice, setNotice };
}

export default function Roles() {
  const { role, permissionCatalog } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchRoles(role), [role]);

  return (
    <div>
      <PageHeader title="Roles & Policies" subtitle="The four fixed role bundles, and the identities they're granted to." />

      <section className="panel-section">
        <h2>Defined roles</h2>
        <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No roles defined yet.">
          <DataTable
            columns={[
              { key: 'roleId', label: 'Role ID', mono: true },
              { key: 'name', label: 'Name' },
              { key: 'orgScope', label: 'Scope' },
              { key: 'permissions', label: 'Permissions', render: (r) => r.permissions.join(', ') },
            ]}
            rows={data || []}
            rowKey={(r) => r.roleId}
          />
        </AsyncSection>
      </section>

      <DefineRoleForm role={role} permissionCatalog={permissionCatalog} onDone={reload} />
      <GrantRevokeForm role={role} roles={data || []} onDone={reload} />
    </div>
  );
}

function DefineRoleForm({ role, permissionCatalog, onDone }: {
  role: PortalContext['role'];
  permissionCatalog: string[];
  onDone: () => void;
}) {
  const [roleId, setRoleId] = useState('');
  const [name, setName] = useState('');
  const [orgScope, setOrgScope] = useState('*');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const { notice, setNotice } = useNotice();

  function togglePerm(p: string) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      await defineRole(role, roleId.trim(), name.trim(), Array.from(perms).join(','), orgScope.trim());
      setNotice({ ok: true, message: `Role ${roleId} defined.` });
      setRoleId('');
      setName('');
      setPerms(new Set());
      onDone();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel-section">
      <h2>Define a role</h2>
      <form className="stacked-form" onSubmit={submit}>
        <div className="form-row">
          <input className="text-input" placeholder="Role ID (e.g. ADMIN)" value={roleId} onChange={(e) => setRoleId(e.target.value)} required />
          <input className="text-input" placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="text-input" placeholder="Org scope (or *)" value={orgScope} onChange={(e) => setOrgScope(e.target.value)} required />
        </div>
        <div className="permission-checks">
          {permissionCatalog.map((p) => (
            <label key={p} className="checkbox-label">
              <input type="checkbox" checked={perms.has(p)} onChange={() => togglePerm(p)} />
              {p}
            </label>
          ))}
        </div>
        <Button type="submit" disabled={submitting}>{submitting ? 'Defining…' : 'Define role'}</Button>
      </form>
      {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
    </section>
  );
}

function GrantRevokeForm({ role, roles, onDone }: {
  role: PortalContext['role'];
  roles: { roleId: string }[];
  onDone: () => void;
}) {
  const [subjectDID, setSubjectDID] = useState('');
  const [roleId, setRoleId] = useState('');
  const [orgScope, setOrgScope] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState<'grant' | 'revoke' | null>(null);
  const { notice, setNotice } = useNotice();

  async function grant() {
    setSubmitting('grant');
    setNotice(null);
    try {
      await grantRole(role, subjectDID.trim(), roleId.trim(), orgScope.trim(), expiresAt.trim() || undefined);
      setNotice({ ok: true, message: `Granted ${roleId} to ${subjectDID}.` });
      onDone();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(null);
    }
  }

  async function revoke() {
    setSubmitting('revoke');
    setNotice(null);
    try {
      await revokeRole(role, subjectDID.trim(), roleId.trim(), orgScope.trim());
      setNotice({ ok: true, message: `Revoked ${roleId} from ${subjectDID}.` });
      onDone();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <section className="panel-section">
      <h2>Grant / revoke a role</h2>
      <div className="stacked-form">
        <div className="form-row">
          <input className="text-input mono" placeholder="Subject DID" value={subjectDID} onChange={(e) => setSubjectDID(e.target.value)} />
          <input className="text-input" list="role-ids" placeholder="Role ID" value={roleId} onChange={(e) => setRoleId(e.target.value)} />
          <datalist id="role-ids">
            {roles.map((r) => <option key={r.roleId} value={r.roleId} />)}
          </datalist>
          <input className="text-input" placeholder="Org scope (or *)" value={orgScope} onChange={(e) => setOrgScope(e.target.value)} />
          <input className="text-input" placeholder="Expires at (optional)" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        <div className="row-actions">
          <Button disabled={submitting !== null} onClick={grant}>{submitting === 'grant' ? 'Granting…' : 'Grant'}</Button>
          <Button variant="danger" disabled={submitting !== null} onClick={revoke}>{submitting === 'revoke' ? 'Revoking…' : 'Revoke'}</Button>
        </div>
      </div>
      {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
    </section>
  );
}
```

### `bel-ui/frontend/src/pages/admin/AuditTrail.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchAuditEvents } from '../../api';
import { PageHeader, useLoader } from '../../components/common';
import AuditTable from '../../components/AuditTable';
import { PortalContext } from '../../PortalLayout';

export default function AuditTrail() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAuditEvents(role), [role]);

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="The full, explicit on-chain audit log — every state-changing call, in order." />
      <AuditTable events={data} loading={loading} error={error} />
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/admin/Network.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchIdentities } from '../../api';
import { AsyncSection, Card, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Network() {
  const { role, roleConfig } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchIdentities(role), [role]);

  const orgUnits = new Set((data || []).map((d) => d.orgUnit));

  return (
    <div>
      <PageHeader title="Network" subtitle="Channel and org-unit topology, derived from the identities registered on-chain." />
      <AsyncSection loading={loading} error={error}>
        <div className="stat-grid">
          <Card title="Channel" value="belchannel" />
          <Card title="Chaincode" value="belid" />
          <Card title="Org units represented" value={orgUnits.size} />
          <Card title="Total identities" value={(data || []).length} />
        </div>
        <p className="dim page-note">
          This view reflects org units seen in the identity registry ({roleConfig.orgUnit} included). Live Fabric
          peer/orderer telemetry (block height, endorsing peers, org MSPs) isn't wired up yet — that would need a
          separate monitoring endpoint on top of the Gateway connection.
        </p>
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/manager/Dashboard.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchAssets, fetchPendingApprovals } from '../../api';
import { AsyncSection, Card, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Dashboard() {
  const { role, roleConfig } = useOutletContext<PortalContext>();
  const approvals = useLoader(() => fetchPendingApprovals(role), [role]);
  const assets = useLoader(() => fetchAssets(role), [role]);

  const loading = approvals.loading || assets.loading;
  const error = approvals.error || assets.error;
  const myOrgAssets = (assets.data || []).filter((a) => a.orgScope === roleConfig.orgScope || roleConfig.orgScope === '*');
  const activeInOrg = myOrgAssets.filter((a) => a.status === 'ACTIVE').length;

  return (
    <div>
      <PageHeader title="Manager Dashboard" subtitle={`Approvals and asset activity for ${roleConfig.orgUnit}.`} />
      <AsyncSection loading={loading} error={error}>
        <div className="stat-grid">
          <Card title="Pending approvals" value={(approvals.data || []).length} />
          <Card title="Assets in my unit" value={myOrgAssets.length} />
          <Card title="Active in my unit" value={activeInOrg} />
        </div>
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/manager/ApprovalQueue.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { approveAsset, fetchPendingApprovals, rejectAsset } from '../../api';
import { AsyncSection, Button, DataTable, InlineNotice, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function ApprovalQueue() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchPendingApprovals(role), [role]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  async function approve(assetId: string) {
    setBusy(assetId);
    setNotice(null);
    try {
      await approveAsset(role, assetId);
      setNotice({ ok: true, message: `${assetId} approved.` });
      reload();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function reject(assetId: string) {
    setBusy(assetId);
    setNotice(null);
    try {
      await rejectAsset(role, assetId, reason);
      setNotice({ ok: true, message: `${assetId} rejected.` });
      setReasonFor(null);
      setReason('');
      reload();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Approval Queue" subtitle="Assets uploaded by your team, awaiting your sign-off before they can be minted." />
      {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="Nothing awaiting approval.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'orgScope', label: 'Org Scope' },
            { key: 'uploadedBy', label: 'Uploaded by', mono: true, render: (a) => a.uploadedBy.replace('did:fabric:', '') },
            { key: 'createdAt', label: 'Uploaded' },
            {
              key: 'actions',
              label: 'Actions',
              render: (a) =>
                reasonFor === a.assetId ? (
                  <div className="row-actions">
                    <input className="text-input" placeholder="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <Button variant="danger" disabled={busy === a.assetId} onClick={() => reject(a.assetId)}>Confirm reject</Button>
                    <Button variant="ghost" onClick={() => setReasonFor(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="row-actions">
                    <Button disabled={busy === a.assetId} onClick={() => approve(a.assetId)}>
                      {busy === a.assetId ? 'Working…' : 'Approve'}
                    </Button>
                    <Button variant="danger" onClick={() => { setReasonFor(a.assetId); setReason(''); }}>Reject</Button>
                  </div>
                ),
            },
          ]}
          rows={data || []}
          rowKey={(a) => a.assetId}
        />
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/manager/Assets.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchAssets } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Assets() {
  const { role, roleConfig } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAssets(role), [role]);
  const rows = (data || []).filter((a) => roleConfig.orgScope === '*' || a.orgScope === roleConfig.orgScope);

  return (
    <div>
      <PageHeader title="Assets" subtitle={`Assets scoped to ${roleConfig.orgUnit}.`} />
      <AsyncSection loading={loading} error={error} empty={rows.length === 0} emptyLabel="No assets in this org unit yet.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'status', label: 'Status', render: (a) => <StatusPill status={a.status} /> },
            { key: 'uploadedBy', label: 'Uploaded by', mono: true, render: (a) => a.uploadedBy.replace('did:fabric:', '') },
            { key: 'createdAt', label: 'Created' },
          ]}
          rows={rows}
          rowKey={(a) => a.assetId}
        />
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/manager/TeamMembers.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchIdentitiesByOrgUnit } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function TeamMembers() {
  const { role, roleConfig } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchIdentitiesByOrgUnit(role, roleConfig.orgUnit), [role, roleConfig.orgUnit]);

  return (
    <div>
      <PageHeader title="Team Members" subtitle={`Identities registered under ${roleConfig.orgUnit}.`} />
      <AsyncSection
        loading={loading}
        error={error}
        empty={(data || []).length === 0}
        emptyLabel="No identities found for this org unit."
      >
        <DataTable
          columns={[
            { key: 'did', label: 'DID', mono: true, render: (d) => d.did.replace('did:fabric:', '') },
            { key: 'status', label: 'Status', render: (d) => <StatusPill status={d.status} /> },
            { key: 'createdAt', label: 'Onboarded' },
          ]}
          rows={data || []}
          rowKey={(d) => d.did}
        />
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/manager/AuditLog.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchAuditEvents } from '../../api';
import { PageHeader, useLoader } from '../../components/common';
import AuditTable from '../../components/AuditTable';
import { PortalContext } from '../../PortalLayout';

export default function AuditLog() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAuditEvents(role), [role]);

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="On-chain activity relevant to approvals, minting and access decisions." />
      <AuditTable events={data} loading={loading} error={error} />
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/auditor/Dashboard.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchAssets, fetchAuditEvents } from '../../api';
import { AsyncSection, Card, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Dashboard() {
  const { role } = useOutletContext<PortalContext>();
  const events = useLoader(() => fetchAuditEvents(role), [role]);
  const assets = useLoader(() => fetchAssets(role), [role]);

  const loading = events.loading || assets.loading;
  const error = events.error || assets.error;
  const failures = (events.data || []).filter((e) => e.result === 'FAILURE').length;

  return (
    <div>
      <PageHeader title="Auditor Dashboard" subtitle="Read-only oversight of the full immutable trail, across every unit." />
      <AsyncSection loading={loading} error={error}>
        <div className="stat-grid">
          <Card title="Total audit events" value={(events.data || []).length} />
          <Card title="Recorded failures" value={failures} hint="failed calls never commit, so this is usually 0" />
          <Card title="Total assets tracked" value={(assets.data || []).length} />
        </div>
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/auditor/AuditEvents.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { fetchAuditEvents } from '../../api';
import { PageHeader, useLoader } from '../../components/common';
import AuditTable from '../../components/AuditTable';
import { PortalContext } from '../../PortalLayout';

export default function AuditEvents() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAuditEvents(role), [role]);
  const [q, setQ] = useState('');

  const filter = (e: { actor: string; action: string; target: string }) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return e.actor.toLowerCase().includes(needle) || e.action.toLowerCase().includes(needle) || e.target.toLowerCase().includes(needle);
  };

  return (
    <div>
      <PageHeader
        title="Audit Events"
        subtitle="Every SUCCESS-recorded state change on the ledger, newest first."
        action={<input className="text-input" placeholder="Filter by actor, action or target…" value={q} onChange={(e) => setQ(e.target.value)} />}
      />
      <AuditTable events={data} loading={loading} error={error} filter={filter} />
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/auditor/AssetHistory.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchAssets } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function AssetHistory() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAssets(role), [role]);

  return (
    <div>
      <PageHeader title="Asset History" subtitle="Full lifecycle timeline for every asset — upload, approval, mint or rejection." />
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No assets on the ledger yet.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'status', label: 'Status', render: (a) => <StatusPill status={a.status} /> },
            { key: 'createdAt', label: 'Uploaded' },
            { key: 'approvedAt', label: 'Approved', render: (a) => a.approvedAt || '—' },
            { key: 'mintedAt', label: 'Minted', render: (a) => a.mintedAt || '—' },
            { key: 'rejectionReason', label: 'Rejected', render: (a) => a.rejectionReason || '—' },
          ]}
          rows={data || []}
          rowKey={(a) => a.assetId}
        />
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/auditor/IdentityHistory.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchIdentities } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function IdentityHistory() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchIdentities(role), [role]);

  return (
    <div>
      <PageHeader title="Identity History" subtitle="Every DID's onboarding origin and current lifecycle status." />
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No identities on the ledger yet.">
        <DataTable
          columns={[
            { key: 'did', label: 'DID', mono: true, render: (d) => d.did.replace('did:fabric:', '') },
            { key: 'orgUnit', label: 'Org Unit' },
            { key: 'status', label: 'Status', render: (d) => <StatusPill status={d.status} /> },
            { key: 'createdBy', label: 'Created by', mono: true, render: (d) => d.createdBy.replace('did:fabric:', '') },
            { key: 'createdAt', label: 'Created' },
          ]}
          rows={data || []}
          rowKey={(d) => d.did}
        />
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/user/Dashboard.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchMyAssets, fetchMyDelegations } from '../../api';
import { AsyncSection, Card, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Dashboard() {
  const { role } = useOutletContext<PortalContext>();
  const assets = useLoader(() => fetchMyAssets(role), [role]);
  const delegations = useLoader(() => fetchMyDelegations(role), [role]);

  const loading = assets.loading || delegations.loading;
  const error = assets.error || delegations.error;
  const active = (assets.data || []).filter((a) => a.status === 'ACTIVE').length;
  const pendingDelegations = (delegations.data || []).filter((d) => d.status === 'PENDING').length;

  return (
    <div>
      <PageHeader title="My Dashboard" subtitle="Assets you've uploaded or been granted access to, and your delegation requests." />
      <AsyncSection loading={loading} error={error}>
        <div className="stat-grid">
          <Card title="My assets" value={(assets.data || []).length} />
          <Card title="Active" value={active} />
          <Card title="Pending delegation requests" value={pendingDelegations} />
        </div>
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/user/MyAssets.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { FormEvent, useState } from 'react';
import { AssetDocument, downloadAssetUrl, fetchMyAssets, requestDelegation, viewAsset } from '../../api';
import { AsyncSection, Button, DataTable, InlineNotice, Modal, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function MyAssets() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchMyAssets(role), [role]);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [delegateFor, setDelegateFor] = useState<AssetDocument | null>(null);

  async function view(a: AssetDocument) {
    setNotice(null);
    try {
      await viewAsset(role, a.assetId);
      setNotice({ ok: true, message: `Access confirmed. Metadata: ${a.fileName} (${a.sha256Hash.slice(0, 16)}…)` });
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  function download(a: AssetDocument) {
    window.open(downloadAssetUrl(role, a.assetId), '_blank');
  }

  return (
    <div>
      <PageHeader title="My Assets" subtitle="Assets you uploaded, plus anything explicitly shared with you." />
      {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="You don't have any assets yet — try Upload.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'status', label: 'Status', render: (a) => <StatusPill status={a.status} /> },
            { key: 'permissions', label: 'Your access', render: (a) => (a.permissions || []).join(', ') || '—' },
            {
              key: 'actions',
              label: 'Actions',
              render: (a) => (
                <div className="row-actions">
                  <Button variant="ghost" onClick={() => view(a)}>View</Button>
                  <Button variant="ghost" onClick={() => download(a)}>Download</Button>
                  <Button variant="ghost" onClick={() => setDelegateFor(a)}>Share…</Button>
                </div>
              ),
            },
          ]}
          rows={data || []}
          rowKey={(a) => a.assetId}
        />
      </AsyncSection>

      {delegateFor && (
        <DelegateModal
          role={role}
          asset={delegateFor}
          onClose={() => setDelegateFor(null)}
          onDone={() => {
            setDelegateFor(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function DelegateModal({ role, asset, onClose, onDone }: {
  role: PortalContext['role'];
  asset: AssetDocument;
  onClose: () => void;
  onDone: () => void;
}) {
  const [targetDID, setTargetDID] = useState('');
  const [permissions, setPermissions] = useState<Set<string>>(new Set(['VIEW']));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(p: string) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await requestDelegation(role, asset.assetId, targetDID.trim(), Array.from(permissions).join(','));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Request access delegation — ${asset.assetId}`} onClose={onClose}>
      <form className="stacked-form" onSubmit={submit}>
        <input className="text-input mono" placeholder="Target DID" value={targetDID} onChange={(e) => setTargetDID(e.target.value)} required />
        <div className="permission-checks">
          {['VIEW', 'DOWNLOAD'].map((p) => (
            <label key={p} className="checkbox-label">
              <input type="checkbox" checked={permissions.has(p)} onChange={() => toggle(p)} />
              {p}
            </label>
          ))}
        </div>
        {error && <InlineNotice ok={false} message={error} />}
        <div className="row-actions">
          <Button type="submit" disabled={submitting}>{submitting ? 'Requesting…' : 'Request delegation'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
```

### `bel-ui/frontend/src/pages/user/Upload.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { FormEvent, useState } from 'react';
import { uploadAsset } from '../../api';
import { Button, InlineNotice, PageHeader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Upload() {
  const { role, roleConfig } = useOutletContext<PortalContext>();
  const [file, setFile] = useState<File | null>(null);
  const [orgScope, setOrgScope] = useState(roleConfig.orgScope === '*' ? '' : roleConfig.orgScope);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await uploadAsset(role, file, orgScope.trim());
      setNotice({ ok: true, message: `Uploaded as ${result.assetId} (SHA-256 ${result.sha256Hash.slice(0, 16)}…). Awaiting approval.` });
      setFile(null);
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Upload Asset" subtitle="The file's bytes stay on this server — only its SHA-256 hash and metadata go on-chain." />
      <section className="panel-section">
        <form className="stacked-form" onSubmit={submit}>
          <input
            className="text-input"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
          />
          <input
            className="text-input"
            placeholder="Org scope (e.g. Ghaziabad)"
            value={orgScope}
            onChange={(e) => setOrgScope(e.target.value)}
            required
          />
          <Button type="submit" disabled={submitting || !file}>{submitting ? 'Uploading…' : 'Upload'}</Button>
        </form>
        {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
      </section>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/user/Delegations.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchMyDelegations } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Delegations() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchMyDelegations(role), [role]);

  return (
    <div>
      <PageHeader title="Delegation Requests" subtitle="Access-sharing requests you've made for your own assets." />
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="You haven't requested any delegations yet.">
        <DataTable
          columns={[
            { key: 'requestId', label: 'Request ID', mono: true },
            { key: 'assetId', label: 'Asset', mono: true },
            { key: 'targetDID', label: 'Shared with', mono: true, render: (d) => d.targetDID.replace('did:fabric:', '') },
            { key: 'permissionsCSV', label: 'Permissions' },
            { key: 'status', label: 'Status', render: (d) => <StatusPill status={d.status} /> },
            { key: 'createdAt', label: 'Requested' },
          ]}
          rows={data || []}
          rowKey={(d) => d.requestId}
        />
      </AsyncSection>
    </div>
  );
}
```

### `bel-ui/frontend/src/pages/user/RecentActivity.tsx`

```tsx
import { useOutletContext } from 'react-router-dom';
import { fetchMyAuditEvents } from '../../api';
import { PageHeader, useLoader } from '../../components/common';
import AuditTable from '../../components/AuditTable';
import { PortalContext } from '../../PortalLayout';

export default function RecentActivity() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchMyAuditEvents(role), [role]);

  return (
    <div>
      <PageHeader title="Recent Activity" subtitle="On-chain events where you were the actor." />
      <AuditTable events={data} loading={loading} error={error} />
    </div>
  );
}
```
