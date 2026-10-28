import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { usePageViews } from '../../lib/analytics';
import { Footer } from './Footer';
import { Header } from './Header';
import { WhatsAppButton } from './WhatsAppButton';

/** After each navigation scrolls to the `#hash` target, or back to the top when there is none. */
function ScrollToHash() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (target) {
      target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo?.({ top: 0 });
    }
  }, [pathname, hash]);

  return null;
}

export function PublicLayout() {
  usePageViews();
  return (
    <>
      <ScrollToHash />
      <Header />
      {/* At least a screen tall: the footer never sits in view while a page is still loading,
          so swapping the spinner for the content shifts nothing visible (CLS, GES-143). */}
      <main className="w-full min-h-screen pt-20 bg-surface">
        <Outlet />
      </main>
      {/* Below the fold on every page: laid out only near the viewport (GES-143). */}
      <div className="defer-render">
        <Footer />
      </div>
      <WhatsAppButton />
    </>
  );
}
