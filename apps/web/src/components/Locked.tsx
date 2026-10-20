/** Shown when the API refuses this device: no session yet, or it expired. */
export function Locked() {
  return (
    <div className="app">
      <main>
        <div className="page">
          <section className="panel empty-state">
            <p className="strong">Folio is locked</p>
            <p className="muted">Open your sign-in link on this device. It keeps you signed in for 90 days.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
