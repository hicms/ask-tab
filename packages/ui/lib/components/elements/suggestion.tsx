import { Button } from '../ui';

type SuggestionProps = {
  suggestion: string;
  onClick: (suggestion: string) => void;
};

const Suggestion = ({ suggestion, onClick }: SuggestionProps) => (
  <Button
    className="h-auto whitespace-normal rounded-full px-3 py-1.5 text-left text-sm"
    onClick={() => onClick(suggestion)}
    variant="outline">
    {suggestion}
  </Button>
);

export { Suggestion };
export type { SuggestionProps };
