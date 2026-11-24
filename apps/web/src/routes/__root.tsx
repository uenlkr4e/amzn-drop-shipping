import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  Link,
  Outlet,
  useRouter,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <div className="min-h-screen bg-background text-foreground">
      <Outlet />
    </div>
  ),
  errorComponent: RootError,
  notFoundComponent: NotFound,
});

function CenteredCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  );
}

function RootError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <CenteredCard title="Something went wrong">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button onClick={() => router.invalidate()}>Try again</Button>
    </CenteredCard>
  );
}

function NotFound() {
  return (
    <CenteredCard title="Page not found">
      <p className="text-sm text-muted-foreground">The page you are looking for does not exist.</p>
      <Link to="/" className={buttonVariants({ variant: 'outline' })}>
        Go to dashboard
      </Link>
    </CenteredCard>
  );
}
