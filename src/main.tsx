import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './estilos.css';
import { modoNube } from './store/nube/cliente';
import { iniciarNube } from './store/nube/sync';

if (modoNube) void iniciarNube();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
