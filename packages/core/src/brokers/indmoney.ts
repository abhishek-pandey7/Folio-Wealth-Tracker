import { BadRequestError, UpstreamError } from '../errors.js';
import { BrokerRequestError, call, type Fetch, field, text } from './http.js';
import type { BrokerAdapter, BrokerHolding, BrokerSession, LoginStart } from './types.js';

const ORIGIN = 'https://mcp.indmoney.com';
const RESOURCE = `${ORIGIN}/mcp`;
/** Read-only: INDmoney's server also offers insights:write, which Folio never asks for. */
const SCOPE = 'portfolio:read';
const PROTOCOL = '2025-06-18';

interface Carry {
  clientId: string;
  clientSecret: string | null;
  verifier: string;
}

interface Refresh {
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

function parseJson<T>(value: string | null, what: string): T {
  try {
    return JSON.parse(value ?? '') as T;
  } catch {
    throw new BadRequestError(`The INDmoney ${what} is missing or damaged; start the login again`);
  }
}

/**
 * INDmoney's official MCP server (mcp.indmoney.com), which is read-only by
 * design. Folio connects the way an MCP client such as Claude does: it
 * registers itself as an OAuth client (RFC 7591), the owner signs in on
 * INDmoney's page with mobile, OTP and MPIN (OAuth 2.1 with PKCE), and the
 * refresh token keeps the connection alive without a daily login.
 */
export class IndmoneyAdapter implements BrokerAdapter {
  readonly id = 'indmoney' as const;
  readonly login = 'redirect' as const;

  constructor(private readonly fetchFn: Fetch = fetch) {}

  async startLogin(redirectUri: string, state: string): Promise<LoginStart> {
    const registered = await call(this.fetchFn, {
      broker: 'INDmoney',
      url: `${ORIGIN}/register`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_name: 'Folio',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          scope: SCOPE,
        }),
      },
    });
    const clientId = text(registered, 'client_id');
    if (!clientId) throw new UpstreamError('INDmoney did not register Folio as a client');
    const { verifier, challenge } = await pkce();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
    });
    const carry: Carry = { clientId, clientSecret: text(registered, 'client_secret'), verifier };
    return { url: `${ORIGIN}/authorize?${query}`, carry: JSON.stringify(carry) };
  }

  async completeLogin(
    params: Record<string, string>,
    redirectUri: string,
    carry: string | null,
  ): Promise<BrokerSession> {
    if (params.error) throw new BadRequestError(`INDmoney did not complete the login (${params.error.slice(0, 80)})`);
    const code = params.code;
    if (!code) throw new BadRequestError('INDmoney did not send a login code back');
    const { clientId, clientSecret, verifier } = parseJson<Carry>(carry, 'login session');
    return this.token(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      },
      clientId,
      clientSecret,
      null,
    );
  }

  async refresh(refresh: string): Promise<BrokerSession> {
    const { clientId, clientSecret, refreshToken } = parseJson<Refresh>(refresh, 'saved session');
    return this.token(
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      clientId,
      clientSecret,
      refreshToken,
    );
  }

  private async token(
    grant: Record<string, string>,
    clientId: string,
    clientSecret: string | null,
    previousRefresh: string | null,
  ): Promise<BrokerSession> {
    const body = await call(this.fetchFn, {
      broker: 'INDmoney',
      url: `${ORIGIN}/token`,
      init: {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...grant,
          client_id: clientId,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          resource: RESOURCE,
        }),
      },
      // A refused refresh token (invalid_grant) means the owner has to sign in again.
      sessionError: (status, b) => status === 401 || status === 403 || text(b, 'error') === 'invalid_grant',
    });
    const accessToken = text(body, 'access_token');
    if (!accessToken) throw new UpstreamError('INDmoney did not return an access token');
    const expiresIn = Number(field(body, 'expires_in'));
    // Refresh tokens may rotate: keep the new one if INDmoney sends it, else the one just used.
    const refreshToken = text(body, 'refresh_token') ?? previousRefresh;
    const refresh: Refresh | null = refreshToken ? { clientId, clientSecret, refreshToken } : null;
    return {
      accessToken,
      expiresAt: new Date(Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000),
      userName: null,
      refresh: refresh ? JSON.stringify(refresh) : null,
    };
  }

  async holdings(accessToken: string): Promise<BrokerHolding[]> {
    const session = await this.mcpSession(accessToken);
    const result = await session.request('tools/call', { name: 'networth_holdings', arguments: US_STOCKS_ARGUMENTS });
    return parseUsHoldings(result);
  }

  /** A Streamable HTTP MCP session: initialize, then JSON-RPC requests carrying the session id. */
  private async mcpSession(accessToken: string) {
    let sessionId: string | null = null;
    let nextId = 1;
    const send = async (payload: Record<string, unknown>): Promise<unknown> => {
      let response: Response;
      try {
        response = await this.fetchFn(RESOURCE, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': PROTOCOL,
            ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
          },
          body: JSON.stringify({ jsonrpc: '2.0', ...payload }),
        });
      } catch {
        throw new UpstreamError('INDmoney could not be reached');
      }
      sessionId = response.headers.get('mcp-session-id') ?? sessionId;
      if (response.status === 401 || response.status === 403) {
        throw new BrokerRequestError('INDmoney: session expired', response.status, undefined, true);
      }
      if (!response.ok)
        throw new BrokerRequestError(
          `INDmoney: request failed (${response.status})`,
          response.status,
          undefined,
          false,
        );
      if (!('id' in payload)) return undefined;
      const message = readRpcMessage(await response.text(), response.headers.get('content-type') ?? '', payload.id);
      const error = field(message, 'error');
      if (error) throw new UpstreamError(`INDmoney: ${text(error, 'message') ?? 'the tool call failed'}`);
      return field(message, 'result');
    };
    await send({
      id: nextId++,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'folio', version: '1.0.0' } },
    });
    await send({ method: 'notifications/initialized' });
    return { request: (method: string, params: Record<string, unknown>) => send({ id: nextId++, method, params }) };
  }
}

/** A JSON-RPC response, sent either as plain JSON or as server-sent events. */
function readRpcMessage(body: string, contentType: string, id: unknown): unknown {
  const candidates = contentType.includes('text/event-stream')
    ? body
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
    : [body];
  for (const candidate of candidates) {
    try {
      const message = JSON.parse(candidate) as unknown;
      if (field(message, 'id') === id) return message;
    } catch {
      // keep looking: event streams can carry notifications before the response
    }
  }
  throw new UpstreamError('INDmoney sent a response Folio could not read');
}

// Filled in from a live call: the tool's arguments and the shape of its result
// are not documented, so they are confirmed against a real account first.
const US_STOCKS_ARGUMENTS: Record<string, unknown> = {};

export function parseUsHoldings(_result: unknown): BrokerHolding[] {
  throw new UpstreamError('INDmoney holdings are not supported yet');
}
