/** Shown to visitors without a session: they are looking at sample data, not anyone's real portfolio. */
export function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <strong>Demo portfolio.</strong> Sample accounts, trades and SIPs with live market data. Add, edit or delete
      anything; it resets every night.
    </div>
  );
}
