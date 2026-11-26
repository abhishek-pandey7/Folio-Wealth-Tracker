import { BROKER_NAMES, BrokerIdSchema } from '@folio/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { takePendingLogin, useCompleteLogin } from '../lib/brokers.js';

/**
 * Where a broker sends the browser back after login (/connect/<broker>).
 * The session cookie is SameSite=Strict, so it is not sent on the broker's
 * cross-site redirect; this page loads first and then completes the login
 * with a same-site request, which does carry it.
 */
export function ConnectPage() {
  const { broker } = useParams();
  const navigate = useNavigate();
  const complete = useCompleteLogin();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  const parsed = BrokerIdSchema.safeParse(broker);
  const name = parsed.success ? BROKER_NAMES[parsed.data] : 'your broker';

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = Object.fromEntries(new URLSearchParams(window.location.search));
    // The code in the URL works once; drop it from the address bar and history straight away.
    window.history.replaceState(null, '', window.location.pathname);

    const pending = takePendingLogin();
    if (!parsed.success) {
      setError('Unknown broker.');
      return;
    }
    if (!pending || pending.broker !== parsed.data) {
      setError('This login was not started from Folio in this tab, or it took too long. Start it again.');
      return;
    }
    // Dhan returns no state; its login is accepted only because this tab started one minutes ago.
    const { state, ...rest } = params;
    if (state !== undefined && state !== pending.state) {
      setError('This login does not match the one Folio started. Start it again.');
      return;
    }
    complete.mutate(
      { broker: parsed.data, params: rest, carry: pending.carry },
      {
        onSuccess: () => navigate('/portfolio', { replace: true }),
        onError: (e) => setError(e.message),
      },
    );
  }, [parsed, complete, navigate]);

  return (
    <div className="page">
      <section className="panel empty-state">
        {error ? (
          <>
            <p className="strong">Could not connect {name}</p>
            <p className="muted">{error}</p>
            <Link to="/portfolio" className="button">
              Back to portfolio
            </Link>
          </>
        ) : (
          <>
            <p className="strong">Connecting {name}…</p>
            <p className="muted">Reading your holdings. Folio only reads them; it cannot place orders.</p>
          </>
        )}
      </section>
    </div>
  );
}
