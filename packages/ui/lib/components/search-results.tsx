interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

type SearchResultsProps = {
  results: SearchResult[];
};

const SearchResults = ({ results }: SearchResultsProps) => {
  if (!results.length) {
    return (
      <div className="text-muted-foreground rounded-lg border px-4 py-3 text-sm">
        No search results found.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {results.map(result => (
        <a
          className="hover:bg-muted block rounded-lg border p-3 transition-colors"
          href={result.url}
          key={result.url}
          rel="noopener noreferrer"
          target="_blank">
          <div className="text-sm font-medium">{result.title}</div>
          <div className="text-muted-foreground mt-0.5 truncate text-xs">{result.url}</div>
          <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">{result.snippet}</div>
        </a>
      ))}
    </div>
  );
};

/**
 * Parse and validate search results from tool output.
 */
const parseSearchResults = (data: unknown): SearchResult[] => {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item): item is SearchResult =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.title === 'string' &&
      typeof item.url === 'string' &&
      typeof item.snippet === 'string',
  );
};

export { SearchResults, parseSearchResults };
export type { SearchResult };
