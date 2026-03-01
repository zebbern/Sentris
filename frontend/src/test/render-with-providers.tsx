/**
 * Shared render helpers for tests that need React Router and/or TanStack Query context.
 *
 * Usage:
 * ```tsx
 * import { renderWithProviders } from '@/test/render-with-providers';
 *
 * it('renders the page', () => {
 *   const { getByText, queryClient } = renderWithProviders(<MyPage />, {
 *     initialEntries: ['/workflows'],
 *   });
 *   expect(getByText('Workflows')).toBeInTheDocument();
 * });
 * ```
 *
 * This eliminates the need to `mock.module('react-router-dom')` or
 * `mock.module('@tanstack/react-query')` — use real providers instead.
 */

import type { ReactElement, ReactNode } from 'react';
import {
  render,
  renderHook,
  type RenderOptions,
  type RenderHookOptions,
  type RenderResult,
  type RenderHookResult,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Test QueryClient factory
// ---------------------------------------------------------------------------

/**
 * Creates a fresh `QueryClient` configured for tests:
 * - `retry: false` — fail fast, no flaky retries
 * - `gcTime: 0` — garbage-collect immediately to prevent state leaks
 *
 * Use this standalone when testing hooks via `renderHook` that only need
 * a QueryClient (not a full render wrapper).
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial URL entries for MemoryRouter (defaults to `['/']`). */
  initialEntries?: MemoryRouterProps['initialEntries'];
  /** Additional MemoryRouter props (e.g. `initialIndex`). */
  routerProps?: Omit<MemoryRouterProps, 'initialEntries' | 'children'>;
  /** Override the QueryClient (defaults to a fresh `createTestQueryClient()`). */
  queryClient?: QueryClient;
}

export interface RenderHookWithProvidersOptions<TProps> extends Omit<
  RenderHookOptions<TProps>,
  'wrapper'
> {
  initialEntries?: MemoryRouterProps['initialEntries'];
  routerProps?: Omit<MemoryRouterProps, 'initialEntries' | 'children'>;
  queryClient?: QueryClient;
}

// ---------------------------------------------------------------------------
// renderWithProviders
// ---------------------------------------------------------------------------

/**
 * Renders a component wrapped in `MemoryRouter` + `QueryClientProvider`.
 *
 * Returns the standard `@testing-library/react` render result plus a
 * `queryClient` reference for cache assertions.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const {
    initialEntries = ['/'],
    routerProps = {},
    queryClient = createTestQueryClient(),
    ...renderOptions
  } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries} {...routerProps}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  }

  const result = render(ui, { wrapper: Wrapper, ...renderOptions });

  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// renderHookWithProviders
// ---------------------------------------------------------------------------

/**
 * Renders a hook wrapped in `MemoryRouter` + `QueryClientProvider`.
 *
 * Useful for testing hooks that call `useNavigate`, `useParams`,
 * `useQuery`, etc.
 */
export function renderHookWithProviders<TResult, TProps>(
  hook: (props: TProps) => TResult,
  options: RenderHookWithProvidersOptions<TProps> = {},
): RenderHookResult<TResult, TProps> & { queryClient: QueryClient } {
  const {
    initialEntries = ['/'],
    routerProps = {},
    queryClient = createTestQueryClient(),
    ...hookOptions
  } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries} {...routerProps}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  }

  const result = renderHook(hook, { wrapper: Wrapper, ...hookOptions });

  return { ...result, queryClient };
}
