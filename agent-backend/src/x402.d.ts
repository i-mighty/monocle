/**
 * Type declarations for x402 SDK packages.
 *
 * These packages use `exports` in package.json which requires moduleResolution "node16".
 * Since our tsconfig uses "node" resolution, we declare the modules here.
 */

declare module "@x402/express" {
  import { Request, Response, NextFunction } from "express";

  export interface SchemeRegistration {
    network: string;
    server: SchemeNetworkServer;
  }

  export interface SchemeNetworkServer {
    readonly scheme: string;
    parsePrice?(price: any, network: string): Promise<any>;
    enhancePaymentRequirements?(req: any, kind: any, extKeys: string[]): Promise<any>;
  }

  export interface PaywallConfig {
    appName?: string;
    appLogo?: string;
    testnet?: boolean;
  }

  export interface FacilitatorClient {
    verify(payload: any, requirements: any): Promise<any>;
    settle(payload: any, requirements: any): Promise<any>;
    getSupported(): Promise<any>;
  }

  export class x402ResourceServer {
    constructor(facilitatorClients?: FacilitatorClient | FacilitatorClient[]);
    register(network: string, server: SchemeNetworkServer): x402ResourceServer;
    onAfterSettle(hook: (ctx: any) => Promise<void>): x402ResourceServer;
  }

  export class x402HTTPResourceServer {
    constructor(server: x402ResourceServer, routes: any);
  }

  export type RoutesConfig = Record<string, any>;

  export function paymentMiddleware(
    routes: RoutesConfig,
    server: x402ResourceServer,
    paywallConfig?: PaywallConfig,
    paywall?: any,
    syncFacilitatorOnStart?: boolean
  ): (req: Request, res: Response, next: NextFunction) => Promise<void>;

  export function paymentMiddlewareFromConfig(
    routes: RoutesConfig,
    facilitatorClients?: FacilitatorClient | FacilitatorClient[],
    schemes?: SchemeRegistration[],
    paywallConfig?: PaywallConfig,
    paywall?: any,
    syncFacilitatorOnStart?: boolean
  ): (req: Request, res: Response, next: NextFunction) => Promise<void>;

  export function paymentMiddlewareFromHTTPServer(
    httpServer: x402HTTPResourceServer,
    paywallConfig?: PaywallConfig,
    paywall?: any,
    syncFacilitatorOnStart?: boolean
  ): (req: Request, res: Response, next: NextFunction) => Promise<void>;

  export class ExpressAdapter {
    constructor(req: Request);
  }
}

declare module "@x402/core/server" {
  export interface FacilitatorConfig {
    url?: string;
    createAuthHeaders?: () => Promise<any>;
  }

  export interface FacilitatorClient {
    verify(payload: any, requirements: any): Promise<any>;
    settle(payload: any, requirements: any): Promise<any>;
    getSupported(): Promise<any>;
  }

  export class HTTPFacilitatorClient implements FacilitatorClient {
    readonly url: string;
    constructor(config?: FacilitatorConfig);
    verify(payload: any, requirements: any): Promise<any>;
    settle(payload: any, requirements: any): Promise<any>;
    getSupported(): Promise<any>;
  }

  export class x402ResourceServer {
    constructor(facilitatorClients?: FacilitatorClient | FacilitatorClient[]);
    register(network: string, server: any): x402ResourceServer;
  }
}

declare module "@x402/core/types" {
  export type Network = string;
  export type Price = string | number | { amount: string; asset: string; address: string; decimals: number };
  export interface PaymentRequirements {
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    payTo: string;
    [key: string]: any;
  }
  export interface PaymentPayload {
    x402Version: number;
    scheme: string;
    network: string;
    payload: Record<string, unknown>;
    [key: string]: any;
  }
  export interface PaymentRequired {
    x402Version: number;
    accepts: PaymentRequirements[];
    [key: string]: any;
  }
  export interface SchemeNetworkClient {
    readonly scheme: string;
    createPaymentPayload(x402Version: number, requirements: PaymentRequirements): Promise<any>;
  }
  export interface SchemeNetworkServer {
    readonly scheme: string;
  }
  export interface SettleResponse {
    success: boolean;
    transaction?: string;
    payer?: string;
    network?: string;
    [key: string]: any;
  }
}

declare module "@x402/svm" {
  export const SOLANA_MAINNET_CAIP2: string;
  export const SOLANA_DEVNET_CAIP2: string;
  export const SOLANA_TESTNET_CAIP2: string;
  export const USDC_MAINNET_ADDRESS: string;
  export const USDC_DEVNET_ADDRESS: string;
  export const DEVNET_RPC_URL: string;
  export const MAINNET_RPC_URL: string;

  /** Client-side SVM scheme (for paying client) */
  export class ExactSvmScheme {
    readonly scheme: string;
    constructor(signer: any, config?: { rpcUrl?: string });
    createPaymentPayload(x402Version: number, requirements: any): Promise<any>;
  }

  export type ClientSvmSigner = any;
  export type FacilitatorSvmSigner = any;
  export function toClientSvmSigner(signer: any): any;
  export function toFacilitatorSvmSigner(signer: any, rpcConfig?: any): any;
}

declare module "@x402/svm/exact/server" {
  /** Server-side SVM scheme (for resource server / middleware) */
  export class ExactSvmScheme {
    readonly scheme: string;
    parsePrice(price: any, network: string): Promise<any>;
    enhancePaymentRequirements(req: any, kind: any, extKeys: string[]): Promise<any>;
    registerMoneyParser(parser: any): ExactSvmScheme;
  }

  export function registerExactSvmScheme(server: any, config?: any): any;
}

declare module "@x402/fetch" {
  export class x402Client {
    register(network: string, client: any): x402Client;
    registerV1(network: string, client: any): x402Client;
    registerPolicy(policy: any): x402Client;
    createPaymentPayload(paymentRequired: any): Promise<any>;
  }

  export class x402HTTPClient {
    constructor(client: x402Client);
  }

  export function wrapFetchWithPayment(
    fetch: typeof globalThis.fetch,
    client: x402Client | x402HTTPClient
  ): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  export function wrapFetchWithPaymentFromConfig(
    fetch: typeof globalThis.fetch,
    config: any
  ): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  export type SelectPaymentRequirements = (version: number, reqs: any[]) => any;
  export type PaymentPolicy = (version: number, reqs: any[]) => any[];
  export type SchemeRegistration = { network: string; client: any; x402Version?: number };
  export type x402ClientConfig = {
    schemes: SchemeRegistration[];
    policies?: PaymentPolicy[];
    paymentRequirementsSelector?: SelectPaymentRequirements;
  };
}

declare module "bs58" {
  const bs58: {
    encode(buffer: Uint8Array | number[]): string;
    decode(str: string): Uint8Array;
  };
  export default bs58;
}

declare module "@solana/kit" {
  export function createKeyPairSignerFromBytes(bytes: Uint8Array): Promise<any>;
  export type TransactionSigner = any;
  export type Address = string;
}
