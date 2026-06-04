import { AgentState, Citation, DerivedState, RuntimeEvent } from '../models/events.model';

export function deriveState(events: RuntimeEvent[]): DerivedState {
  const state: DerivedState = {
    sessionStatus: 'idle',
    subquestions: [],
    agents: {},
  } as any;

  for (const ev of events) {
    const p = ev.payload as Record<string, any>;
    const subId = p['subagent'] as string | undefined;

    switch (ev.type) {
      case 'session.started':
        state.sessionStatus = 'planning';
        state.query = p['query'];
        break;

      case 'plan.created':
        state.subquestions = (p['subquestions'] as string[]) ?? [];
        state.sessionStatus = 'researching';
        break;

      case 'subagent.started':
        if (subId) {
          state.agents[subId] = {
            id: subId,
            question: p['question'] ?? '',
            status: 'thinking',
          } as AgentState;
        }
        break;

      case 'subagent.thought':
        if (subId && state.agents[subId]) {
          state.agents[subId].status = 'thinking';
        }
        break;

      case 'subagent.tool_call':
        if (subId && state.agents[subId]) {
          state.agents[subId].status = 'tool_call';
          state.agents[subId].lastTool = p['tool'];
          state.agents[subId].lastToolInput = p['input'];
        }
        break;

      case 'subagent.tool_result':
        if (subId && state.agents[subId]) {
          state.agents[subId].status = 'thinking';
        }
        break;

      case 'subagent.finished':
        if (subId && state.agents[subId]) {
          state.agents[subId].status = 'finished';
          state.agents[subId].findings = p['findings'];
        }
        break;

      case 'report.ready':
        state.report = {
          summary: (p['summary'] as string) ?? '',
          citations: (p['citations'] as any) ?? [],
        } as { summary: string; citations: Citation[] };
        state.sessionStatus = 'complete';
        break;

      case 'error':
        state.sessionStatus = 'error';
        state.error = p['error'] as string;
        break;
    }
  }

  if (state.sessionStatus === 'researching') {
    const agents: AgentState[] = Object.values(state.agents);
    if (agents.length > 0 && agents.every((a) => a.status === 'finished')) {
      state.sessionStatus = 'synthesizing';
    }
  }

  return state;
}
