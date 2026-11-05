import { emptyIssueDocument, type IssueDocument } from '../../../../../contracts/mod.ts';

const paragraphLimit = 5000;

/** Imported plain-text bodies; must match the backfill in 20261105000200_issue_documents.sql. */
export function documentFromDescription(description: string): IssueDocument {
  const value = description.trim();
  let end = Math.min(value.length, paragraphLimit);
  const high = value.charCodeAt(end - 1);
  if (end < value.length && high >= 0xd800 && high <= 0xdbff) end--;
  const paragraph = value.slice(0, end).trimEnd();
  if (!paragraph) return emptyIssueDocument;
  return {
    lead: '',
    sections: [{ title: 'Description', blocks: [{ type: 'paragraph', text: paragraph }] }],
    criteria: [],
  };
}
