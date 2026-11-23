import { SetMetadata } from '@nestjs/common';
import type { Role } from './roles';

export const ROLES_KEY = 'roles';

/** Restricts a route to the listed roles. Without it, any signed-in user may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
