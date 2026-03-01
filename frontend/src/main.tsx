import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeTheme } from '@/store/themeStore';
import { AnalyticsWrapper } from '@/components/AnalyticsWrapper';

initializeTheme();

// Defer timeline store initialization — it's ~1000 lines and only needed for workflow executions.
// setTimeout(0) defers past the synchronous render cycle but fires before user interaction.
setTimeout(() => {
  import('@/store/executionTimelineStore').then(({ initializeTimelineStore }) => {
    initializeTimelineStore();
  });
}, 0);

const appContent = (
  <AnalyticsWrapper>
    <App />
  </AnalyticsWrapper>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  import.meta.env.DEV ? <React.StrictMode>{appContent}</React.StrictMode> : appContent,
);
