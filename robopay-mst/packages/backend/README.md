# RoboPay Backend

This package contains the backend for the RoboPay MST Testnet application.

## Setup

1. Install dependencies in the monorepo root:
   npm install
2. Copy environment file:
   cp packages/backend/.env.example packages/backend/.env
3. Fill in the required values for the owner wallet and API keys.
4. Run Prisma client generation:
   npm --prefix packages/backend run db:generate
5. Push schema to SQLite:
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

The service listens on `http://localhost:4000` by default.

Base path: `/api/v1`

## Security notes

- Customer payments remain frontend-side through BridgeKey.
- The owner private key is only used server-side via `ROBO_PAY_OWNER_PRIVATE_KEY`.
- Do not expose any backend secret to the browser.

## Blockchain

- Network: MST Testnet
- Chain ID: `91562037`
- Contract: `0xe4CA28050580918c252b53c181ff361B65C9f667`
