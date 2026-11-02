import { AppError } from '../../../../contracts/mod.ts';
import { fail } from '../errors/validation.ts';
function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'cause' in error ? databaseCode(error.cause) : undefined;
}
export async function translate<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = databaseCode(error);
    if (code === '23505') fail('conflict', 'A catalog entry with this name already exists');
    if (code === '23503' || code === '23514') {
      fail('invalid_input', 'Invalid catalog reference or constraint');
    }
    throw error;
  }
}
