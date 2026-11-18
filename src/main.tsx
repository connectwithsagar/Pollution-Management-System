import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Tier 1 Google Maps Platform quota & auth failure defense (Demo Key Case A)
(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  window.dispatchEvent(
    new CustomEvent('gmp-map-error', {
      detail:
        'Google Maps authentication failed. Verify that your API key is valid, billing is enabled, Maps JavaScript API is active, and this domain is allowed under HTTP referrer restrictions.',
    })
  );
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  origConsoleError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
  if (msg.includes('RefererNotAllowedMapError')) {
    window.dispatchEvent(
      new CustomEvent('gmp-map-error', {
        detail: `Google Maps blocked this domain (${window.location.origin}). Add "${window.location.origin}/*" to your Google Cloud API key HTTP referrer restrictions (AI Studio demo keys are restricted to AI Studio domains).`,
      })
    );
  } else if (msg.includes('ApiNotActivatedMapError')) {
    window.dispatchEvent(
      new CustomEvent('gmp-map-error', {
        detail: 'Maps JavaScript API is not enabled on the Google Cloud project for this API key.',
      })
    );
  } else if (msg.includes('BillingNotEnabledMapError')) {
    window.dispatchEvent(
      new CustomEvent('gmp-map-error', {
        detail: 'Google Cloud billing is not enabled for this Google Maps API key.',
      })
    );
  } else if (msg.includes('InvalidKeyMapError') || msg.includes('ExpiredKeyMapError')) {
    window.dispatchEvent(
      new CustomEvent('gmp-map-error', {
        detail: 'The configured Google Maps API key is invalid or expired.',
      })
    );
  }
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
