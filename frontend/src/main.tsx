import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { TechnicianPortalView } from './pages/TechnicianPortalView.tsx';
import './index.css';

const isTechnicianPortal = window.location.pathname === '/portal-tecnico';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isTechnicianPortal ? <TechnicianPortalView /> : <App />}
  </React.StrictMode>,
);
