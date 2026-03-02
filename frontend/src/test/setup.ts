import '@testing-library/jest-dom';
import globalJsdom from 'global-jsdom';

const cleanup = globalJsdom('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});

if (cleanup) {
  (globalThis as any).__SENTRIS_JS_DOM_CLEANUP__ = cleanup;
}

if (typeof window !== 'undefined' && window.HTMLElement) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    value: function scrollIntoView() {
      /* noop for tests */
    },
    configurable: true,
  });
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function () {
    return null;
  };
}

if (typeof globalThis.EventSource === 'undefined') {
  function MockEventSource(this: any, url: string) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;

    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.call(this, new Event('open'));
    }, 0);
  }

  MockEventSource.prototype.addEventListener = function () {
    /* no-op */
  };

  MockEventSource.prototype.removeEventListener = function () {
    /* no-op */
  };

  MockEventSource.prototype.close = function () {
    this.readyState = 2;
  };

  globalThis.EventSource = MockEventSource as any;
}

if (typeof globalThis.HTMLCanvasElement === 'undefined') {
  class HTMLCanvasElementStub {
    getContext() {
      return null;
    }
  }
  globalThis.HTMLCanvasElement = HTMLCanvasElementStub as any;
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// Radix UI (react-slider, react-switch) accesses window.HTMLInputElement.prototype
// and window.HTMLTextAreaElement.prototype. Ensure they exist in the jsdom environment.
if (typeof window !== 'undefined') {
  if (!window.HTMLInputElement) {
    (window as any).HTMLInputElement = globalThis.HTMLInputElement ?? class HTMLInputElement {};
  }
  if (!window.HTMLTextAreaElement) {
    (window as any).HTMLTextAreaElement =
      globalThis.HTMLTextAreaElement ?? class HTMLTextAreaElement {};
  }
}

// ---------------------------------------------------------------------------
// Pre-cache real modules before any test file's mock.module() bleeds.
// Test files that need the real module can use:
//   mock.module('@/xxx', () => realModuleExports('@/xxx'))
// and the cached real exports will be returned instead of a bled mock.
// ---------------------------------------------------------------------------
import { realModuleExports } from './restore-mocks';

const PRECACHE_MODULES = [
  // Stores
  '@/store/workflowStore',
  '@/store/executionStore',
  '@/store/notificationStore',
  '@/store/executionTimelineStore',
  '@/store/commandPaletteStore',
  '@/store/themeStore',
  '@/store/workflowUiStore',
  '@/store/workflowHistoryStore',
  '@/store/userPreferencesStore',
  '@/store/authStore',
  // Libs & utils commonly mocked
  '@/lib/queryKeys',
  '@/lib/queryClient',
  '@/lib/executionQueryOptions',
  '@/lib/logger',
  '@/utils/auth',
  '@/services/api',
  '@/components/layout/sidebar-state',
  '@/hooks/queries/useApiKeyQueries',
  '@/hooks/queries/useRunQueries',
  '@tanstack/react-query',
  'react-router-dom',
];

for (const mod of PRECACHE_MODULES) {
  realModuleExports(mod);
}
