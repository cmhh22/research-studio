export type EventType =
  | 'session.started'
  | 'plan.created'
  | 'subagent.started'
  | 'subagent.thought'
  | 'subagent.tool_call'
  | 'subagent.tool_result'
  | 'subagent.finished'
  | 'report.ready'
  | 'error';

export interface RuntimeEvent {
  id: string;
  type: EventType;
  session_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface Citation {
  id: string;
  title: string;
  url: string;
  authors?: string;
  year?: string | number;
  venue?: string;
}

export type AgentStatus = 'thinking' | 'tool_call' | 'finished' | 'error';

export interface AgentState {
  id: string;
  question: string;
  status: AgentStatus;
  lastTool?: string;
  lastToolInput?: unknown;
  findings?: string;
}

export type SessionStatus =
  | 'idle'
  | 'planning'
  | 'researching'
  | 'synthesizing'
  | 'complete'
  | 'error';

export interface DerivedState {
  sessionStatus: SessionStatus;
  query?: string;
  subquestions: string[];
  agents: Record<string, AgentState>;
  report?: { summary: string; citations: Citation[] };
  error?: string;
}
