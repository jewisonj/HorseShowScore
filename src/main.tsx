import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/overpass/latin-400.css'
import '@fontsource/overpass/latin-700.css'
import './styles.css'
import App from './App'
import { startCloud } from './cloud/cloud'
import { loadDraw } from './seed'

// Ask the browser not to clear this site's storage when space runs low.
// Matters most on iPhones and iPads, where it only helps once the app is on the home screen.
void navigator.storage?.persist?.().catch(() => {})

// Classes this device has not touched get their riders from the draw of each show it knows.
loadDraw()

// Then, in the background, read the published shows from the server. Scoring does not wait for it.
void startCloud()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
