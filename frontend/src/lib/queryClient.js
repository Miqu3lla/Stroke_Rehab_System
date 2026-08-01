import { QueryClient } from '@tanstack/react-query';

// staleTime keeps repeated Home/Sessions navigation from re-hitting the
// DB — data fetched within this window is served from cache instead of
// refetched on every screen mount.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});
