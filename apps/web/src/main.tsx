import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.js';
import { ApiError } from './api.js';
import { DemoBanner } from './components/DemoBanner.js';
import { startSession } from './session.js';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // A 4xx (bad symbol, unknown fund) will not change on retry; network blips might.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
    },
  },
});

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}

void startSession().then((mode) => {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {mode === 'demo' && <DemoBanner />}
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
});
