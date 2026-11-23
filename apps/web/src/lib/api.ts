import createClient from 'openapi-fetch';
import type { components, paths } from '@/api/schema';

export const api = createClient<paths>({ baseUrl: window.location.origin, credentials: 'include' });

export type Me = components['schemas']['MeDto'];
export type OpsStatus = components['schemas']['OpsStatusDto'];

export type MeResult =
  | { kind: 'ok'; user: Me }
  | { kind: 'unauthenticated' }
  | { kind: 'two-factor-setup-required' };

export async function fetchMe(): Promise<MeResult> {
  const { data, error, response } = await api.GET('/api/me');
  if (data) return { kind: 'ok', user: data };
  if (response.status === 401) return { kind: 'unauthenticated' };
  const code = (error as { code?: string } | undefined)?.code;
  if (response.status === 403 && code === 'TWO_FACTOR_SETUP_REQUIRED') {
    return { kind: 'two-factor-setup-required' };
  }
  throw new Error(`Unexpected /api/me response: ${response.status}`);
}

export class ForbiddenError extends Error {}

export async function fetchOpsStatus(): Promise<OpsStatus> {
  const { data, response } = await api.GET('/api/ops/status');
  if (data) return data;
  if (response.status === 403) throw new ForbiddenError('Forbidden');
  throw new Error(`Unexpected /api/ops/status response: ${response.status}`);
}
