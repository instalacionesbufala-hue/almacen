import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './estilos.css';
import { modoNube } from './store/nube/cliente';
import { iniciarNube } from './store/nube/sync';

if (modoNube) void iniciarNube();

// app instalable y notificaciones push (solo en la versión publicada, con https)
if (import.meta.env.PROD && 'serviceWorker' in navigator) addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => undefined); });

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
