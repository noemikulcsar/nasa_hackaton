import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled locally so the console works without internet (as on board).
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import App from './App.jsx';
import './styles/app.css';

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
