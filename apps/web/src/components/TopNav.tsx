import { NavLink } from 'react-router';
import { useWatchlist } from '../hooks.js';
import { GlobalSearch } from './GlobalSearch.js';
import { StatusBar } from './StatusBar.js';

const LINKS = [
  { to: '/portfolio', label: 'Portfolio', end: false },
  { to: '/', label: 'Markets', end: true },
  { to: '/discover', label: 'Discover', end: false },
  { to: '/funds', label: 'Funds', end: false },
] as const;

export function TopNav() {
  const { items } = useWatchlist();

  return (
    <header className="topbar">
      <NavLink to="/" className="brand" aria-label="Folio home">
        folio<span className="brand-dot">.</span>
      </NavLink>
      <nav className="nav-links" aria-label="Main">
        {LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end}>
            {link.label}
          </NavLink>
        ))}
        <NavLink to="/starred">
          Starred
          {items.length > 0 && <span className="count">{items.length}</span>}
        </NavLink>
      </nav>
      <GlobalSearch />
      <StatusBar />
    </header>
  );
}
