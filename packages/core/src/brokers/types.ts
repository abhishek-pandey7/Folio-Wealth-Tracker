import type { BrokerId, BrokerLogin, Decimal } from '@folio/shared';

export interface BrokerSession {
  accessToken: string;
  expiresAt: Date;
  /** The name or client code the broker reports, to show which login is connected. */
  userName: string | null;
  /**
   * What the adapter needs to renew the session without a new login, if the
   * broker allows that (INDmoney's OAuth refresh token). Opaque to the
   * service, which stores it encrypted.
   */
  refresh?: string | null;
}

/** One holding as a broker reports it, before it is matched to a market symbol. */
export interface BrokerHolding {
  /** The broker's symbol, e.g. RELIANCE, RELIANCE-EQ, or AAPL. */
  tradingSymbol: string;
  /** NSE, BSE, ALL (Dhan, for shares held across both), or US. */
  exchange: string;
  isin: string | null;
  name: string | null;
  /** Delivered plus T1 units. */
  quantity: Decimal;
  /** Per unit, in `currency`. */
  averagePrice: Decimal;
  lastPrice: Decimal | null;
  currency: 'INR' | 'USD';
}

export interface LoginStart {
  url: string;
  /**
   * Values the second half of the login needs (a PKCE verifier, a registered
   * client). The service encrypts it before it reaches the browser and the
   * browser hands it back unchanged, so no login state is kept on the server.
   */
  carry?: string;
}

/**
 * One broker's API, read-only by construction: adapters call login and
 * holdings endpoints and nothing else, so no code path in Folio can place,
 * change or cancel an order.
 */
export interface BrokerAdapter {
  readonly id: BrokerId;
  readonly login: BrokerLogin;
  /** The broker's login page to send the browser to (redirect logins only). */
  startLogin?(redirectUri: string, state: string): Promise<LoginStart>;
  /** Exchanges what came back (redirect query parameters, or the credentials form) for a session. */
  completeLogin(params: Record<string, string>, redirectUri: string, carry: string | null): Promise<BrokerSession>;
  /** Renews a session from `BrokerSession.refresh`, for brokers that allow it. */
  refresh?(refresh: string): Promise<BrokerSession>;
  holdings(accessToken: string): Promise<BrokerHolding[]>;
}
