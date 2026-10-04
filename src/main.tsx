import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';

/**
 * Entry. `?dev=<domain>` opens a domain's isolated dev page (e.g. ?dev=canvas, ?dev=build),
 * which renders against contracts/fixtures without the rest of the app.
 */
const pages = {
  app: lazy(() => import('./app').then((m) => ({ default: m.App }))),
  canvas: lazy(() => import('./canvas/dev')),
  build: lazy(() => import('./build/dev')),
};

const key = new URLSearchParams(location.search).get('dev') as keyof typeof pages | null;
const Page = (key && pages[key]) || pages.app;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
);
