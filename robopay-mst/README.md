# RoboPay MST

RoboPay is a monorepo for a robot-rental application using BridgeKey, MST Testnet, an escrow smart contract, a Next.js frontend, and a Fastify backend.

## Packages

- `packages/frontend`: Next.js customer app.
- `packages/backend`: Fastify API, SQLite projection, session/audit processing, and expiry worker.
- `packages/contracts`: Solidity contracts, Hardhat deployment scripts, and tests.
- `packages/shared`: generated deployment metadata and shared API types.

## Requirements

- Node.js 18.18 or newer.
- npm 10.9.2 recommended.

## Install and validate

From the repository root:

```powershell
npm install
npm test
npm run build
```

## Local services

Configure local environment files from the corresponding `.env.example` files. Keep all private keys and API keys in ignored server-side environment files or a deployment secret manager. Never place an operator key in frontend variables.

Start the backend from one terminal:

```powershell
cd packages/backend
npm run dev
```

Start the frontend from another terminal:

```powershell
cd packages/frontend
npm run dev
```

The default URLs are `http://localhost:4000` for the API and `http://localhost:3000` for the customer app. The backend health endpoint is `http://localhost:4000/api/v1/health`.

To use the demo-only simulated session path, set `ROBO_PAY_DEMO_MODE=true` in the backend environment. Demo samples are marked `DEMO_SIMULATED` and are not physical robot telemetry. Keep demo mode disabled for hardware operation.

## MST Testnet deployment

The Hardhat testnet network is MST Testnet, chain ID `91562037`. Deployment credentials must be supplied securely to the deploy process; do not commit them. Deployment scripts validate the configured owner/payment recipient and write contract address and ABI metadata to `packages/shared/src/contracts.ts` and `packages/contracts/deployments.json`.

The generated active deployment metadata currently points to `RoboPayEscrow` at `0x94ec9C02f240433E4eBf3FC4939A6ae283d83DB4`. That deployed contract registers RF-01, FC-01, and ST-01. The source currently also defines RoboCourier (RC-01), but RC-01 is not in the deployed contract and is not bookable until a compatible contract is deployed and the generated active metadata is updated.

The contract makes robot availability authoritative on-chain. A rental sets a robot to `IN_USE`; confirmed settlement or refund returns it to `AVAILABLE`. Timer expiry alone does not alter availability or release escrow.

## Backend security and robot integration

The operator signer is server-side only through `ROBO_PAY_OPERATOR_PRIVATE_KEY`. It must correspond to the active contract owner. `ROBOT_API_KEY` protects robot session start, telemetry, completion, and robot-authenticated failure reports. Customer-signed failure reports are not sufficient by themselves to trigger an automatic refund.

For API details and lifecycle behavior, see [packages/backend/README.md](packages/backend/README.md).
