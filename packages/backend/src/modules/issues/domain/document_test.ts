import { issueDocumentSchema } from '../../../../../contracts/mod.ts';
import { documentFromDescription } from './document.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
Deno.test('Legacy descriptions become valid documents without splitting characters', () => {
  assert(documentFromDescription(' \n ').sections.length === 0);
  for (
    const description of [
      '<p>kept literally</p>',
      'a'.repeat(4999) + '\u{1F600}tail',
      '\u{1F600}'.repeat(3000),
      'x'.repeat(6000),
    ]
  ) {
    const document = documentFromDescription(description);
    const block = document.sections[0].blocks[0];
    assert(block.type === 'paragraph' && description.startsWith(block.text));
    assert(
      block.text.length <= 5000 && !/[\ud800-\udbff]$/.test(block.text),
      block.text.length + '',
    );
    assert(issueDocumentSchema.safeParse(document).success, 'Backfilled documents validate');
  }
});
