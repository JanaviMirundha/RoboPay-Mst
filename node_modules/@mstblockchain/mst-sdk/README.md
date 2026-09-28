# MST Blockchain SDK

A modular and lightweight blockchain development kit for interacting with any MST-compatible network. This SDK provides easy-to-use abstractions for providers, signers, and contract interactions.

## Table of Contents
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [1. Initialize the Client](#1-initialize-the-client)
  - [2. Generate a Random Wallet](#2-generate-a-random-wallet)
  - [3. Check Account Balance (via Provider)](#3-check-account-balance-via-provider)
  - [4. Estimate Gas & Send Transactions](#4-estimate-gas--send-transactions)
  - [5. Deploy Contract & Get Address](#5-deploy-contract--get-address)
- [Core Modules](#core-modules)
  - [1. Client](#1-client)
  - [2. Provider](#2-provider-read-only)
  - [3. Signer](#3-signer-identity--writing)
  - [4. Errors](#4-errors)
- [Testing](#testing)
- [License](#license)

## Features

- **Client Orchestration**: Universal entry point for all SDK features.
- **Provider Management**: Simple JSON-RPC provider for fetching block data and account state.
- **Secure Signing**: Integrated `Signer` using `ethers.js` for secure transaction signing and address management.
- **Balances**: Built-in utilities for checking native token balances.

## Installation

```bash
npm install blockchain-sdk
```

*(Note: Ensure you have `ethers` installed as it is a peer dependency.)*

## Quick Start

### 1. Initialize the Client

```javascript
const { Client } = require('blockchain-sdk');

const rpcUrl = 'https://testnetrpc.mstblockchain.com';
const privateKey = '0x...'; 

const client = new Client(rpcUrl, privateKey);
```

### 2. Generate a Random Wallet

```javascript
// Creates a new client with a fresh random private key
const client = Client.createRandom(rpcUrl);
console.log(`Generated Address: ${client.signer.address}`);
console.log(`Private Key: ${client.signer.getPrivateKey()}`);
```

### 3. Check Account Balance (via Provider)

```javascript
async function checkBalance() {
    const address = '0x...';
    // Access balance through the provider
    const balance = await client.provider.getBalance(address);
    console.log(`Address Balance: ${balance.toString()} wei`);
}
```

### 4. Estimate Gas & Send Transactions

```javascript
async function sendTx() {
    const toAddress = '0x...';
    const amount = '1000000000000000000'; // 1 TOKEN
    
    // 1. Estimate gas first
    const gasLimit = await client.signer.estimateGas("sendNative", [toAddress, amount]);
    console.log(`Estimated Gas: ${gasLimit}`);

    // 2. Send the transaction
    const txHash = await client.signer.sendNative(toAddress, amount);
    console.log(`Transaction Hash: ${txHash}`);
}
```

### 5. Deploy Contract & Get Address

```javascript
async function deployContract() {
    const abi = [...];
    const bytecode = "0x...";
    const args = ["InitialValue"];

    // 1. Start deployment
    const txHash = await client.signer.deploy(abi, bytecode, args);
    console.log(`Deployment Hash: ${txHash}`);

    // 2. Wait for it to be mined
    const receipt = await client.provider.waitForTransaction(txHash);

    // 3. Get the new contract address
    console.log(`Contract Deployed at: ${receipt.contractAddress}`);
}
```

## Core Modules

### 1. `Client`
The root container and main entry point.
- `static createRandom(rpcUrl)`: Returns a new Client instance with a random signer.
- `provider`: Instance of `Provider`.
- `signer`: Instance of `Signer` (if privateKey provided).

### 2. `Provider` (Read-only)
Accessed via `client.provider`.
- `getBlockNumber()`: Returns the latest block.
- `getBalance(address)`: Fetches raw balance.
- `getTransactionReceipt(hash)`: Fetches the receipt of a mined txn.
- `waitForTransaction(hash)`: Waits for a txn to be mined.
- `estimateGas(txObject)`: Estimates gas for a raw transaction object.

### 3. `Signer` (Identity & Writing)
Accessed via `client.signer`.
- `static createRandom(provider)`: Generates a new random Signer attached to a provider.
- `getPrivateKey()`: Returns the private key of the current wallet.
- `estimateGas(method, args)`: Estimates gas for Signer methods (`sendNative`, `sendToken`, `deploy`).
- `sendTransaction(tx)`: Signs and broadcasts any transaction.
- `sendNative(to, amount)`: Shortcut for sending native tokens.
- `sendToken(tokenAddress, to, amount)`: Sends ERC20 tokens.
- `deploy(abi, bytecode, args?)`: Deploys smart contracts.
- `getAddress()`: Returns the signer's public address.

### 4. `Errors`
Custom error classes for better debugging.
- `ProviderError`: Network or RPC issues.
- `TransactionError`: Validation or on-chain submission failures.
- `WalletError`: Private key or signer initialization issues.

## Testing

Run the test suite to ensure everything is configured correctly:

```bash
npm test
```

## License

ISC
