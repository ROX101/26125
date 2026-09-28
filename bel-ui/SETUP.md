# BEL Identity Console — Setup Guide

A working multi-role UI on top of the DID Registry + RBAC Engine chaincode.
Four real Fabric identities (Admin, Manager, Auditor, User), each with their
own certificate and key — switching roles in the UI switches which real
identity is signing every request.

**Prerequisite:** the network is up, `belid` is deployed, and all four
roles (`ADMIN`, `MANAGER`, `AUDITOR`, `USER`) are already defined on-chain
(the setup from `REPLICATION-GUIDE.md`).

---

## Part 1 — Register the three demo identities and wire up their roles

From `fabric-samples/test-network`:

```bash
cp <path-to-this-folder>/register-demo-identities.sh .
chmod +x register-demo-identities.sh
./register-demo-identities.sh
```

This registers `manager-demo`, `auditor-demo`, `user-demo` via Fabric CA,
has each discover its own DID via the new `WhoAmI` query, then uses your
existing Admin identity to issue DIDs and grant them `MANAGER`, `AUDITOR`,
`USER` respectively — each scoped to a different real BEL unit.

It writes `identities.json` in the current directory.

**One manual step:** open `identities.json` and replace
`"REPLACE_WITH_YOUR_GENESIS_DID"` under `ADMIN` with your actual genesis DID
— the value `InitAdmin` returned back when you first bootstrapped (starts
`did:fabric:...`). The script can't know this value on its own.

## Part 2 — Move identities.json next to the UI folders

```bash
cp identities.json <path-to-this-folder>/
```

The backend expects `identities.json` to sit one level above its own
folder — i.e. alongside `backend/` and `frontend/`, not inside either.

## Part 3 — Run the backend

```bash
cd backend
npm install
npm run build
npm start
```

Expect: `BEL demo API listening on http://localhost:4000`

Quick check it's actually connected:
```bash
curl http://localhost:4000/api/config
```
Should return JSON with all four roles and their real DIDs.

## Part 4 — Run the frontend

In a **second terminal**:

```bash
cd frontend
npm install
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`).

## Using it

- Click between **Admin / Manager / Auditor / User** in the left rail —
  each is a genuinely separate Fabric identity.
- The **Permissions** panel lights up amber for every permission that role
  actually holds, checked live via `HasPermission`.
- **Try an action** — the same five buttons appear for every role. As
  Admin, all five succeed. As Manager, Auditor, or User, every one of them
  gets denied — and the **Activity log** shows exactly why, straight from
  the chaincode's own error message.

That denial, live, on a UI switching between real signed identities, is
the actual proof the PS asks for.

## Troubleshooting

- **"Could not reach the demo API"** on the frontend — the backend isn't
  running, or crashed on startup. Check its terminal for errors, most
  commonly a wrong path in `identities.json` (cert/key files not found) or
  the network not being up.
- **Every action fails, even as Admin** — check the peer/orderer TLS cert
  paths in `identities.json`'s `network` block still match your actual
  `fabric-samples/test-network` folder location.
- **A role's DID looks wrong or empty** — re-run
  `register-demo-identities.sh`; it's safe to run again (registration and
  issuance steps tolerate "already exists").
