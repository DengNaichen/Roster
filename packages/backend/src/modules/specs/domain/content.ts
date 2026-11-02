import type { SpecContent } from '../../../../../contracts/spec.ts';
import { fail } from '../../../platform/errors/validation.ts';
export function ids(content: SpecContent) {
  return new Set(
    [...content.stories, ...content.requirements, ...content.success_criteria].map((i) => i.id),
  );
}
/** Match Go JSON normalization and count encoded UTF-8 bytes, not UTF-16 string length. */
export function encodeSpec(content: SpecContent): string {
  const normalized = { ...content };
  if (!normalized.branch) delete normalized.branch;
  normalized.requirements = content.requirements.map((r) => {
    const value = { ...r };
    if (!value.clarify) delete value.clarify;
    return value;
  });
  const encoded = JSON.stringify(normalized).replace(
    /[<>&\u2028\u2029]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  if (new TextEncoder().encode(encoded).length > 256 * 1024) {
    fail('invalid_input', 'Spec content is larger than 256 KiB');
  }
  return encoded;
}
