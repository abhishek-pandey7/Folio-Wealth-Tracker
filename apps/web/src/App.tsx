import { Link, Route, Routes } from 'react-router';
import { TopNav } from './components/TopNav.js';
import { DiscoverPage } from './pages/DiscoverPage.js';
import { FundPage } from './pages/FundPage.js';
import { FundsPage } from './pages/FundsPage.js';
import { MarketsPage } from './pages/MarketsPage.js';
import { PortfolioPage } from './pages/PortfolioPage.js';
import { StarredPage } from './pages/StarredPage.js';
import { StockPage } from './pages/StockPage.js';

export function App() {
  return (
    <div className="app">
      <TopNav />
      <main>
        <Routes>
          <Route path="/" element={<MarketsPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/discover/:universeId" element={<DiscoverPage />} />
          <Route path="/stock/:symbol" element={<StockPage />} />
          <Route path="/funds" element={<FundsPage />} />
          <Route path="/funds/:categoryId" element={<FundsPage />} />
          <Route path="/fund/:code" element={<FundPage />} />
          <Route path="/starred" element={<StarredPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <div className="page">
      <section className="panel empty-state">
        <p className="strong">Page not found</p>
        <Link to="/" className="button">
          Back to markets
        </Link>
      </section>
    </div>
  );
}
