import type { Broker, BrokerId } from '@folio/shared';
import { ArrowsClockwiseIcon, LinkBreakIcon } from '@phosphor-icons/react';
import { type FormEvent, useState } from 'react';
import {
  startBrokerLogin,
  useAutoSync,
  useBrokers,
  useCompleteLogin,
  useDisconnectBroker,
  useSyncBroker,
} from '../lib/brokers.js';

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const time = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

function statusLine(broker: Broker): string {
  const c = broker.connection;
  if (!c) return 'Not connected';
  const parts = [c.userName, `${c.holdings} ${c.holdings === 1 ? 'holding' : 'holdings'}`];
  if (c.status === 'expired') {
    parts.push(c.syncedAt ? `login expired, showing holdings from ${ago(c.syncedAt)}` : 'login expired');
  } else {
    parts.push(c.syncedAt ? `synced ${ago(c.syncedAt)}` : 'not synced yet');
    if (!c.renews && c.expiresAt) parts.push(`login valid until ${time(c.expiresAt)}`);
  }
  return parts.filter(Boolean).join(', ');
}

/**
 * Brokers the owner can sync holdings from. Read-only: Folio reads holdings
 * and has no way to place, change or cancel orders. Hidden in the demo.
 */
export function BrokersPanel() {
  const brokers = useBrokers();
  const autoSync = useAutoSync(brokers.data);
  const sync = useSyncBroker();
  const disconnect = useDisconnectBroker();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<BrokerId | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<BrokerId | null>(null);

  if (!brokers.data?.enabled) return null;
  const available = brokers.data.brokers.filter((b) => b.configured || b.connection);
  const notSetUp = brokers.data.brokers.filter((b) => !b.configured && !b.connection);

  async function connect(broker: Broker) {
    setError(null);
    if (broker.login === 'credentials') {
      setCredentialsFor(broker.id);
      return;
    }
    setStarting(broker.id);
    try {
      await startBrokerLogin(broker.id);
    } catch (e) {
      setError((e as Error).message);
      setStarting(null);
    }
  }

  const busy = sync.isPending || autoSync.isPending;
  const failure = error ?? sync.error?.message ?? disconnect.error?.message ?? null;

  return (
    <section className="panel" aria-label="Brokers">
      <header className="panel-head">
        <h2>Brokers</h2>
        <span className="tag" title="Folio reads holdings only. It cannot place, change or cancel orders.">
          Read-only
        </span>
      </header>
      <p className="muted small">
        Holdings sync from your broker and are valued at live prices. Folio only reads them; it cannot buy or sell.
      </p>
      {failure && <p className="inline-error">{failure}</p>}

      {available.length > 0 && (
        <ul className="tx-list">
          {available.map((b) => {
            const c = b.connection;
            return (
              <li key={b.id}>
                <span className="tx-main">
                  <span className="strong">{b.name}</span>
                  <span className="row-sub">{statusLine(b)}</span>
                  {c?.error && <span className="row-sub warn-text">{c.error}</span>}
                </span>
                {(!c || c.status === 'expired') && (
                  <button
                    type="button"
                    className={c ? 'button' : 'button secondary'}
                    disabled={!b.configured || starting !== null}
                    onClick={() => connect(b)}
                  >
                    {starting === b.id ? 'Opening…' : c ? 'Log in' : 'Connect'}
                  </button>
                )}
                {c?.status === 'active' && (
                  <button
                    type="button"
                    className="icon-button visible"
                    aria-label={`Sync ${b.name} now`}
                    title="Sync now"
                    disabled={busy}
                    onClick={() => sync.mutate(b.id)}
                  >
                    <ArrowsClockwiseIcon size={16} className={busy ? 'spin' : undefined} />
                  </button>
                )}
                {c && (
                  <button
                    type="button"
                    className="icon-button visible"
                    aria-label={`Disconnect ${b.name}`}
                    title="Disconnect"
                    disabled={disconnect.isPending}
                    onClick={() => {
                      const ok = window.confirm(
                        `Disconnect ${b.name}? Its synced holdings are removed from Folio. Nothing changes in your ${b.name} account.`,
                      );
                      if (ok) disconnect.mutate(b.id);
                    }}
                  >
                    <LinkBreakIcon size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {credentialsFor && <CredentialsForm broker={credentialsFor} onDone={() => setCredentialsFor(null)} />}

      {notSetUp.length > 0 && (
        <p className="muted small">
          Not set up: {notSetUp.map((b) => b.name).join(', ')}. Add a broker's API key to this deployment to offer it
          here.
        </p>
      )}
    </section>
  );
}

/** Angel One logs in with client code, PIN and TOTP. Folio passes them through once and keeps only the session. */
function CredentialsForm({ broker, onDone }: { broker: BrokerId; onDone: () => void }) {
  const complete = useCompleteLogin();
  const [clientCode, setClientCode] = useState('');
  const [pin, setPin] = useState('');
  const [totp, setTotp] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    complete.mutate({ broker, params: { clientCode, pin, totp }, carry: null }, { onSuccess: onDone });
  }

  return (
    <form className="account-form compact" onSubmit={submit} autoComplete="off">
      <div className="field">
        <label htmlFor="broker-client" className="field-label">
          Client code
        </label>
        <input id="broker-client" value={clientCode} onChange={(e) => setClientCode(e.target.value)} maxLength={20} />
      </div>
      <div className="field">
        <label htmlFor="broker-pin" className="field-label">
          PIN
        </label>
        <input
          id="broker-pin"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          maxLength={6}
        />
      </div>
      <div className="field">
        <label htmlFor="broker-totp" className="field-label">
          Authenticator code
        </label>
        <input
          id="broker-totp"
          inputMode="numeric"
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          maxLength={6}
        />
      </div>
      <div className="field">
        <span className="field-label">&nbsp;</span>
        <span className="row-actions">
          <button type="submit" className="button" disabled={complete.isPending || !clientCode || !pin || !totp}>
            {complete.isPending ? 'Logging in…' : 'Log in'}
          </button>
          <button type="button" className="button secondary" onClick={onDone}>
            Cancel
          </button>
        </span>
      </div>
      <p className="field-hint span-all">
        Used once to start a session and never stored. The session lasts until the end of the day.
      </p>
      {complete.error && <p className="inline-error span-all">{complete.error.message}</p>}
    </form>
  );
}
