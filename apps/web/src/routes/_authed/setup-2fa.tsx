import { createFileRoute, useRouter } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/_authed/setup-2fa')({ component: SetupTwoFactorPage });

function SetupTwoFactorPage() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<{ totpURI: string; backupCodes: string[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function onEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const password = String(new FormData(event.currentTarget).get('password'));
    const { data, error: enableError } = await authClient.twoFactor.enable({ password });
    if (enableError || !data || !('totpURI' in data)) {
      setError(enableError?.message ?? 'Could not start 2FA setup');
      return;
    }
    setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const code = String(new FormData(event.currentTarget).get('code')).trim();
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({ code });
    if (verifyError) {
      setError(verifyError.message ?? 'Invalid code');
      return;
    }
    await router.invalidate();
    await router.navigate({ to: '/' });
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>Set up two-factor authentication</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enrollment ? (
          <form onSubmit={onEnable} className="space-y-4">
            <p className="text-sm">
              Two-factor authentication is required. Confirm your password to start.
            </p>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit">Continue</Button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="space-y-4">
            <p className="text-sm">
              Scan this code with your authenticator app, then enter the 6-digit code.
            </p>
            <div className="flex justify-center rounded bg-white p-4">
              <QRCodeSVG value={enrollment.totpURI} size={192} />
            </div>
            <div>
              <p className="text-sm font-medium">Backup codes — store them somewhere safe:</p>
              <pre className="mt-2 rounded bg-muted p-3 text-sm">
                {enrollment.backupCodes.join('\n')}
              </pre>
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Authenticator code</Label>
              <Input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </div>
            <Button type="submit">Verify and finish</Button>
          </form>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
