import type { SearchHit } from '../../../../../contracts/search.ts';
export type SearchRow = SearchHit & { rank: number; sort_time: string; sort_key: string };
export type SearchPosition = { rank: number; time: string; key: string };
export interface SearchRepository {
  search(
    input: {
      workspaceId: unknown;
      subject: string;
      query: string;
      type: string;
      limit: number;
      after?: SearchPosition;
    },
  ): Promise<SearchRow[]>;
}
