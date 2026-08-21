import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './style.css';
import './consent-or-pay.css';

const root = document.getElementById('app');
if (!root) {
  throw new Error('BannerBye popup: #app root element niet gevonden');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
