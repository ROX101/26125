# bel-ui

A multi-role demo console for the `bel-chaincode` DID/RBAC chaincode
(**SIH26125**, Bharat Electronics Limited).

Four real Fabric identities — Admin, Manager, Auditor, User — each with
their own certificate and signing key. Switching roles in the UI switches
which real identity is signing every request to the ledger, so a denied
action is a genuine cryptographic denial, not a UI-level simulation.

## Structure

- `register-demo-identities.sh` — registers the three non-Admin identities
  via Fabric CA, has each discover its own DID through the chaincode's
  `WhoAmI` query, and grants them their roles
- `backend/` — Express API holding one Fabric Gateway connection per
  identity (the "BEL Chaincode Gateway" from the architecture diagram, made
  real)
- `frontend/` — React console: an identity rail, live permission
  indicators, and a shared set of actions every role can attempt

## Setup

See `SETUP.md` for the full sequence. Run this only after `bel-chaincode`
is deployed and all four roles are already defined on-chain.

## Why this is a separate repo from the chaincode

The chaincode is installed, approved, and committed onto the Fabric network
itself, versioned by sequence number — an entirely different lifecycle from
restarting a Node server or rebuilding a React app. This UI is just one
possible client of the already-deployed chaincode; a different team could
build a mobile wallet or another dashboard against the exact same `belid`
chaincode without ever touching this repo.

## Note on `identities.json`

This file is generated locally by `register-demo-identities.sh` and
contains absolute filesystem paths specific to your machine. It's
gitignored on purpose — never commit it. `identities.example.json` shows
the expected shape.
