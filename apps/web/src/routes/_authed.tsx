import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Outlet, redirect, useRouter } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { fetchMe } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const me = await fetchMe();
    if (me.kind === 'unauthenticated') {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    if (me.kind === 'two-factor-setup-required' && location.pathname !== '/setup-2fa') {
      throw redirect({ to: '/setup-2fa' });
    }
    return { me: me.kind === 'ok' ? me.user : null };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { me } = Route.useRouteContext();
  const router = useRouter();
  const queryClient = useQueryClient();

  async function signOut() {
    await authClient.signOut();
    // Drop cached data from the signed-out session so the next user never sees it.
    queryClient.clear();
    await router.navigate({ to: '/login', search: { redirect: '/' } });
  }

  return (
    <div>
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-semibold">Dropship Platform</span>
        <div className="flex items-center gap-4 text-sm">
          {me && (
            <span>
              {me.email} · {me.role}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
