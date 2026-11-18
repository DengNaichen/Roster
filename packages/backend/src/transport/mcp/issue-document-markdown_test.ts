import { issueDocumentSchema } from '../../../../contracts/issue-document.ts';
import { parseIssueDocumentMarkdown } from './issue-document-markdown.ts';

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}

Deno.test('parseIssueDocumentMarkdown maps Markdown blocks and AC checklist into valid IssueDocument', () => {
  const markdown = `
Keep the existing workspace grant when refreshing OAuth tokens, using \`/oauth/token\`.

## Scope
::: compare
### In scope
- Preserve \`workspace\` grant on refresh
- Add integration test
### Out of scope
- Multi-workspace token switching
:::

## Implementation steps
1. **Validate grant** Load existing row from \`oauth_grants\`
2. **Issue token** Return refreshed access token

> [!NOTE] Security boundary
> Never accept \`workspace\` overrides in refresh requests.

| Field | Rule |
| --- | --- |
| \`grant\` | Immutable |

\`\`\`ts
return { workspace: grant.workspace };
\`\`\`

## Acceptance criteria
- [ ] [AC-1] Refresh keeps workspace: Call refresh and inspect \`whoami\`
- [x] **Existing grants stay valid** Old sessions continue working
`;

  const doc = parseIssueDocumentMarkdown(markdown);
  const parsed = issueDocumentSchema.parse(doc);
  assert(
    parsed.lead ===
      'Keep the existing workspace grant when refreshing OAuth tokens, using `/oauth/token`.',
  );
  assert(parsed.sections.length === 2);
  assert(parsed.sections[0].title === 'Scope');
  assert(parsed.sections[0].blocks[0].type === 'compare');
  assert(parsed.sections[1].title === 'Implementation steps');
  assert(parsed.sections[1].blocks.map((b) => b.type).join(',') === 'list,note,table,code');
  assert(parsed.criteria.length === 2);
  assert(parsed.criteria[0].id === 'AC-1' && !parsed.criteria[0].done);
  assert(parsed.criteria[1].id === 'AC-2' && parsed.criteria[1].done);
  assert(parsed.criteria[1].title === 'Existing grants stay valid');
});

Deno.test('parseIssueDocumentMarkdown degrades long preambles and horizontal rules cleanly', () => {
  const longPreamble = 'x'.repeat(2100);
  const parsed = issueDocumentSchema.parse(
    parseIssueDocumentMarkdown(`${longPreamble}\n\n---\n\n### Subnote\nBody text`),
  );
  assert(parsed.lead === '');
  assert(parsed.sections.length === 1 && parsed.sections[0].title === 'Description');
  assert(parsed.sections[0].blocks.length === 3);
  assert(parsed.sections[0].blocks[0].type === 'paragraph');
  assert(
    parsed.sections[0].blocks[1].type === 'paragraph' &&
      parsed.sections[0].blocks[1].text === 'Subnote',
  );
});
