import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Button,
} from './ui';
import { ChevronDownIcon } from 'lucide-react';
import { memo } from 'react';

type AgentInfo = {
  id: string;
  name: string;
  emoji: string;
};

type AgentSwitcherProps = {
  agents: AgentInfo[];
  activeAgentId: string;
  onAgentChange: (agentId: string) => void;
};

const PureAgentSwitcher = ({ agents, activeAgentId, onAgentChange }: AgentSwitcherProps) => {
  const activeAgent = agents.find(a => a.id === activeAgentId) ?? agents[0];
  if (!activeAgent || agents.length <= 1) {
    // Don't render if only one agent
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-8 gap-1 px-2 text-xs" size="sm" variant="ghost">
          <span>{activeAgent.emoji || '\u{1F916}'}</span>
          <span className="max-w-[80px] truncate">{activeAgent.name}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {agents.map(agent => (
          <DropdownMenuItem key={agent.id} onClick={() => onAgentChange(agent.id)}>
            <span className="mr-2">{agent.emoji || '\u{1F916}'}</span>
            <span className="truncate">{agent.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const AgentSwitcher = memo(PureAgentSwitcher);

export { AgentSwitcher };
export type { AgentSwitcherProps, AgentInfo as AgentSwitcherAgent };
