# Dev Environment Setup — DID/RBAC Chaincode

This has already been verified end-to-end in a clean environment: `npm
install` completes with 0 vulnerabilities, `npm run build` compiles with
zero TypeScript errors, and both contracts load and register their
`@Transaction` methods correctly at runtime. Follow these exact steps and
you should get an identical result.

## 1. Prerequisites

| Tool | Version | Check with |
|---|---|---|
| Node.js | 18+ (verified on 22) | `node --version` |
| npm | comes with Node | `npm --version` |
| Docker + Docker Compose | for the Fabric network (Step 1 guide) | `docker --version` |

If you're on Windows, use WSL2 — same recommendation as the network guide.

## 2. Install and build

From the `chaincode/` folder (this exact folder, `package-lock.json`
included so you get the identical dependency versions that were just
verified):

```bash
npm install
npm run build
```

Expected output: no errors, and a `dist/` folder appears containing the
compiled `.js` files.

## 3. Quick sanity check (optional but recommended)

Before wiring this into the actual Fabric network, confirm the contracts
load cleanly on their own:

```bash
node -e "
const { contracts } = require('./dist/index.js');
console.log('Contracts loaded:', contracts.map(c => c.name));
"
```

Expected output: `Contracts loaded: [ 'DIDRegistryContract', 'RBACEngineContract' ]`
plus a handful of `@Transaction`/`@Info` log lines — that log output is
normal, it's the `fabric-contract-api` decorators registering themselves.

## 4. Editor setup (optional)

VS Code with the following extensions makes this much easier to work in:
- **ESLint** — catches issues before you even build
- **TypeScript Importer** — autocompletes the `import { X } from './y'` lines
- Nothing Fabric-specific is required; the `fabric-contract-api` and
  `fabric-shim` type definitions ship with the packages themselves, so
  autocomplete for `ctx.stub`, `ctx.clientIdentity`, etc. works out of the box.

## 5. Connecting this to the Fabric network

This environment is separate from (but feeds into) the Hyperledger Fabric
network environment from the Step 1 guide. Rough order of operations:

1. Set up Docker + Fabric samples/binaries (Step 1 guide, sections 0–2).
2. Set up this chaincode environment (steps 1–3 above).
3. Bring the network up (Step 1 guide, sections 3–5).
4. Deploy this chaincode in place of the placeholder `basic` contract, and
   run through the bootstrap/test sequence — both covered in
   `DEPLOY-AND-TEST.md` in this same folder.

## 6. Common early snags (from real Fabric chaincode-node projects)

- **"Cannot find module 'fabric-shim'"** at chaincode container build time
  (not local build time) — this happens if `package-lock.json` isn't
  present when Fabric builds the chaincode's Docker image. Keep the
  `package-lock.json` committed alongside `package.json`.
- **Decorator errors** ("experimentalDecorators" complaints) — already
  handled in `tsconfig.json` here; if you create new contract files, keep
  `experimentalDecorators: true` in any tsconfig you use.
- **Node version mismatches** between your machine and what Fabric's peer
  expects for chaincode-node — stick to Node 18 or newer, matching what's
  declared in `package.json`'s `engines` field.
