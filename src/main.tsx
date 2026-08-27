import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { Buffer } from 'buffer';
import App from './App.tsx';
import { WindowShell } from './WindowShell.tsx';
import './index.css';

// Polyfill Buffer for libraries that expect it
if (typeof window !== 'undefined' && !window.Buffer) {
  (window as any).Buffer = Buffer;
}

// A window opened with ?window=<id> is a POPPED-OUT window: render only that
// window's content as a bus client, not the whole desktop. The main window has
// no such param and renders the full App exactly as before.
const windowId = new URLSearchParams(window.location.search).get('window');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {windowId ? <WindowShell windowId={windowId} /> : <App />}
  </StrictMode>,
);
