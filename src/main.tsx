import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/overpass/latin-400.css'
import '@fontsource/overpass/latin-700.css'
import './styles.css'
import App from './App'
import { loadDraw } from './seed'

// Ask the browser not to clear this site's storage when space runs low.
// Matters most on iPhones and iPads, where it only helps once the app is on the home screen.
void navigator.storage?.persist?.().catch(() => {})

// The test data ships with Saturday's draw. Classes this device has not touched get their riders.
loadDraw()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
