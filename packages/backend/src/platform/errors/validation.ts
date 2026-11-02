import { AppError } from '../../../../contracts/mod.ts';
export const fail = (
  code: ConstructorParameters<typeof AppError>[0],
  message: string,
): never => {
  throw new AppError(code, message);
};
export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail('invalid_input', `${label} is required`);
  }
  return (value as string).trim();
}
