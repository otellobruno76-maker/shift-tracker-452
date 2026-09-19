import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/queryClient'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

// PWA: service worker — "passthrough" in dev (HMR untouched), "cache" in production.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const mode = import.meta.env.PROD ? 'cache' : 'passthrough'
    navigator.serviceWorker.register(`/sw.js?mode=${mode}`).catch(() => {})
  })
}
