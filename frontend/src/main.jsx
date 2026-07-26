import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider, http, createConfig } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { injected, metaMask } from 'wagmi/connectors';
import App from './App.jsx';
import './index.css';

const config = createConfig({
  chains: [sepolia],
  connectors: [injected(), metaMask()],
  transports: { [sepolia.id]: http() },
});

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
