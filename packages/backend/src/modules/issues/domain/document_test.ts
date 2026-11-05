import { AppError, issueDocumentSchema } from '../../../../../contracts/mod.ts';
import { documentFromDescription, setCriterionDone } from './document.ts';
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
Deno.test('Checking a criterion changes only that criterion and rejects unknown IDs', () => {
  const document = documentFromDescription('Body');
  document.criteria = [
    { id: 'AC-1', title: 'One', detail: '', done: false },
    { id: 'AC-2', title: 'Two', detail: '', done: true },
  ];
  const change = setCriterionDone(document, 'AC-1', true);
  assert(change.before === false && change.document.criteria[0].done === true);
  assert(change.document.criteria[1] === document.criteria[1] && !document.criteria[0].done);
  try {
    setCriterionDone(document, 'AC-3', true);
    throw new Error('Accepted unknown criterion');
  } catch (error) {
    assert(error instanceof AppError && error.code === 'not_found', String(error));
  }
});
