import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './theme/base.css';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
