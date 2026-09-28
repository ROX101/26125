# BEL Secure Digital Asset & Identity Platform — SIH26125

Team **GenSix** — Smart India Hackathon 2026. Problem Statement SIH26125
(Bharat Electronics Limited): a blockchain-based secure platform for
identity, access control, and digital asset management.

## `chaincode/` + `bel-ui/` — the Hyperledger Fabric implementation

This is the actual system: a permissioned Hyperledger Fabric network
running real chaincode (`chaincode/`, TypeScript — DID Registry, RBAC
Engine, Asset Registry, Audit contracts), with a full-stack client
(`bel-ui/`, Express + React) that talks to it over the Fabric Gateway gRPC
API using real signed identities. Nothing here is simulated — a denied
action is a genuine cryptographic/RBAC rejection from the ledger, not a
client-side `if` statement.

Full setup instructions, from a completely fresh machine, are in
[`REPLICATION-GUIDE.md`](./REPLICATION-GUIDE.md). It requires Docker and
WSL2 (on Windows) to stand up the Fabric network itself.

## Repo layout

```
chaincode/        Hyperledger Fabric chaincode (TypeScript) — the real ledger logic
bel-ui/            React + Express client for the deployed chaincode (Fabric Gateway)
REPLICATION-GUIDE.md   Full from-zero setup guide for the Fabric network + chaincode + bel-ui
```
