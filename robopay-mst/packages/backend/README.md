# RoboPay Backend

Additive backend package for the existing customer app and the active `RoboPayEscrow` deployment. Customer rent transactions remain BridgeKey-signed in the frontend; backend rental state is always read from the active generated deployment and chain.

## Setup

1. Install dependencies in the monorepo root:
   npm install
2. Copy environment file:
   cp packages/backend/.env.example packages/backend/.env
3. Set unique `ADMIN_API_KEY` and `ROBOT_API_KEY` values. Set `ROBO_PAY_OPERATOR_PRIVATE_KEY` only in the server environment when operator writes are required; it must resolve to the on-chain owner. Never use a `NEXT_PUBLIC_` variable for secrets. `ROBO_PAY_DEMO_MODE` defaults to `false`; only set it to `true` for a clearly labelled simulated session demo.
4. Run Prisma client generation:
   npm --prefix packages/backend run db:generate
5. Push the additive schema to local SQLite:
   npm --prefix packages/backend run db:push
6. Start the backend:
   npm --prefix packages/backend run dev

## Environment

See `packages/backend/.env.example`.

## NPM scripts

- `npm --prefix packages/backend run dev`
- `npm --prefix packages/backend run build`
- `npm --prefix packages/backend run start`
- `npm --prefix packages/backend run test`
- `npm --prefix packages/backend run db:generate`
- `npm --prefix packages/backend run db:push`

## API

The service listens on `http://localhost:4000` by default. Base URL: `http://localhost:4000/api/v1`.

Key endpoints:

- `GET /health`, `/blockchain/info`, `/robots`, `/robots/:robotId/status`, `/robots/:robotId/active-rental`
- `GET /rentals/active`, `/rentals/history`, `/rentals/:orderId`, `/rentals/customer/:address`
- `POST /rentals/verify-transaction` verifies an already BridgeKey-signed transaction; it never accepts keys or submits customer rent.
- `GET /verify/rental/:orderId`, `/verify/activity/:orderId`, `/audit/:orderId`
- Robot-key protected `POST /sessions/start`, `/sessions/:orderId/telemetry`, `/sessions/:orderId/complete`, `/sessions/:orderId/robot-failure`
- Admin-key and owner-validated `POST /admin/audit/:orderId/anchor`, `/admin/rentals/:orderId/settle`, `/admin/rentals/:orderId/refund`
- Customer failure reports require an EIP-191 signature and only create `REPORTED` evidence; they never refund automatically.

## Security notes

- Customer payments remain frontend-side through BridgeKey.
- The operator private key is used only server-side via `ROBO_PAY_OPERATOR_PRIVATE_KEY`.
- Startup reads `RoboPayEscrow` from generated shared deployment metadata, verifies MST Testnet and contract bytecode, and checks a configured operator against `owner()`.
- Without an authorized operator key the service starts read-only; settlement, refund, and hash anchoring are unavailable.
- Do not expose any backend secret to the browser.
- The SQLite database is a projection/cache. Contract state remains authoritative.
- Expiry alone never sets success or robot availability; settlement/refund transactions and final robot status are confirmed from MST Testnet.
- Telemetry endpoints require a robot API key. Authenticated robot evidence is required for automatic failure refunds; customer-signed reports remain `REPORTED` until operator validation.
- With `ROBO_PAY_DEMO_MODE=true`, the backend creates deterministic session samples from confirmed on-chain rental data. The API/UI marks these records `DEMO_SIMULATED`; they are not physical robot telemetry. Leave demo mode off for production/hardware operation.

## Blockchain

- Network: MST Testnet
- Chain ID: `91562037`
- Active contract: resolved from `packages/shared/src/contracts.ts` as `RoboPayEscrow` (`0x94ec9C02f240433E4eBf3FC4939A6ae283d83DB4`). Legacy deployment metadata is never selected.
- Active ABI supports `settleRental`, `refundRental`, and `recordActivityHash`; it does not expose `endRental`.
- Settlement requires an ended rental and an on-chain activity hash; refund requires a nonzero activity hash and verified operator failure evidence.

## Hardware integration remaining

The physical robot client/heartbeat transport is not part of this repository package. Provision each robot with `ROBOT_API_KEY` through a secure device provisioning process and send authenticated telemetry to the telemetry endpoint. For hardware mode, the operator expiry worker requires real end-spanning heartbeats, operation-complete telemetry, consistent session hashes, and no critical-fault/e-stop signals. Demo mode is explicitly simulated and is not evidence of hardware success.
