import { z } from 'zod';
// Supabase authorization_id is an opaque frontend identifier, not its internal row UUID.
export const authorizationIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
