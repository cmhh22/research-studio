import { Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ResearchService } from './services/research.service';
import { AgentState } from './models/events.model';
import { miniMarkdown } from './services/mini-markdown';

const SUGGESTIONS = [
  'What are the main effects of microplastic pollution on marine ecosystems?',
  'How does CRISPR gene editing work and what are its risks?',
  'What caused the 2008 financial crisis?',
  'How do large language models actually generate text?',
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [],
  template: `
    <div class="app">
      <!-- HEADER -->
      <header class="hdr">
        <div class="brand">
          <div class="logo">RS</div>
          <span class="brand-name">Research Studio</span>
          <span class="brand-ver">v0.3</span>
        </div>
        <div class="hdr-status">
          <span class="dot" [class.on]="research.connected()"></span>
          <span>{{ research.connected() ? 'conectado' : 'inactivo' }}</span>
          <span class="sep">·</span>
          <span>sesión: <b>{{ research.state().sessionStatus }}</b></span>
          <span class="sep">·</span>
          <span>modo: <b>{{ research.mode() }}</b></span>
        </div>
      </header>

      @if (isEmpty()) {
        <!-- EMPTY STATE -->
        <section class="empty">
          <h1>Investigación multi-agente</h1>
          <p>Escribí una pregunta y varios agentes la investigan en paralelo,
             buscan fuentes, y sintetizan un reporte con citas.</p>
          <div class="empty-input">
            <input
              [value]="question()"
              (input)="question.set($any($event.target).value)"
              (keydown.enter)="runLive()"
              placeholder="What are the main effects of...?"
            />
            <button class="btn-primary" (click)="runLive()">Investigar</button>
          </div>
          <div class="empty-replay">
            o <button class="link" (click)="research.startReplay()">reproducir una corrida de demo</button>
          </div>
          <div class="suggestions">
            @for (s of suggestions; track s) {
              <button class="chip" (click)="useSuggestion(s)">{{ s }}</button>
            }
          </div>
        </section>
      } @else {
        <!-- ACTIVE: 3-column layout -->
        <div class="grid">
          <!-- LEFT: question + plan -->
          <aside class="col-left">
            <div class="section-label">Pregunta</div>
            <div class="q-text">{{ research.state().query }}</div>

            @if (research.state().subquestions.length) {
              <div class="section-label">Plan · {{ research.state().subquestions.length }} nodos</div>
              <div class="plan">
                @for (sq of research.state().subquestions; track sq; let i = $index) {
                  <div class="plan-node" [class.active]="hasAgent(i)">
                    <div class="plan-node-text">{{ sq }}</div>
                  </div>
                }
              </div>
            }

            <div class="left-actions">
              <button class="btn-ghost" (click)="research.reset()">Nueva sesión</button>
            </div>
          </aside>

          <!-- CENTER: agent cards / report -->
          <main class="col-center">
            @if (research.state().report; as report) {
              <div class="section-label">Reporte final</div>
              <article class="report" [innerHTML]="reportHtml()"></article>

              @if (report.citations.length) {
                <div class="section-label" style="margin-top:18px">Fuentes · {{ report.citations.length }}</div>
                <div class="citations">
                  @for (c of report.citations; track c.id; let i = $index) {
                    <a class="citation" [href]="c.url" target="_blank" rel="noopener">
                      <span class="citation-num">{{ i + 1 }}</span>
                      <span class="citation-body">
                        <span class="citation-title">{{ c.title }}</span>
                        <span class="citation-url">{{ c.url }}</span>
                      </span>
                    </a>
                  }
                </div>
              }
            } @else {
              <div class="section-label">Subagentes activos</div>
              <div class="agents">
                @for (a of agentList(); track a.id) {
                  <div class="agent" [attr.data-status]="a.status">
                    <div class="agent-head">
                      <span class="agent-id">{{ a.id }}</span>
                      <span class="agent-status">
                        <span class="agent-status-dot"></span>
                        {{ agentStatusLabel(a.status) }}
                      </span>
                    </div>
                    <div class="agent-q">{{ a.question }}</div>
                    @if (a.status === 'tool_call' && a.lastTool) {
                      <div class="agent-tool">{{ toolText(a) }}</div>
                    }
                    @if (a.findings) {
                      <div class="agent-findings">{{ a.findings }}</div>
                    }
                  </div>
                } @empty {
                  <div class="hint">Esperando el plan de investigación...</div>
                }
              </div>
            }
          </main>

          <!-- RIGHT: event stream with filters -->
          <aside class="col-right">
            <div class="stream-hdr">
              <span class="section-label" style="margin:0">Stream</span>
              <span class="stream-count">{{ research.events().length }}</span>
            </div>
            <div class="stream-filters">
              @for (f of EVENT_FILTERS; track f.key) {
                <button class="filter-chip" [class.active]="activeFilter() === f.key"
                        (click)="activeFilter.set(f.key)">{{ f.label }}</button>
              }
            </div>
            <div class="stream">
              @for (ev of filteredEvents(); track ev.id) {
                <div class="stream-row" [attr.data-type]="ev.type">
                  <span class="stream-type">{{ ev.type }}</span>
                  @if (subOf(ev)) { <span class="stream-sub">{{ subOf(ev) }}</span> }
                </div>
              } @empty {
                <div class="hint">Sin eventos.</div>
              }
            </div>
          </aside>
        </div>
      }
    </div>
  `,
  styles: [`
    .app { min-height: 100vh; display: flex; flex-direction: column; }

    /* Header */
    .hdr { display: flex; align-items: center; justify-content: space-between;
      padding: 10px 16px; border-bottom: 0.5px solid var(--border); background: var(--bg-1); }
    .brand { display: flex; align-items: center; gap: 10px; }
    .logo { width: 26px; height: 26px; border-radius: 6px; background: var(--accent);
      color: #fff; display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 600; }
    .brand-name { font-weight: 500; }
    .brand-ver { font-family: var(--font-mono); font-size: 12px; color: var(--text-3); }
    .hdr-status { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2); }
    .hdr-status b { color: var(--accent); font-weight: 500; }
    .hdr-status .sep { color: var(--text-3); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
    .dot.on { background: var(--ok); }

    /* Empty state */
    .empty { flex: 1; max-width: 620px; margin: 0 auto; padding: 12vh 1.5rem 0; text-align: center; }
    .empty h1 { font-size: 1.6rem; font-weight: 500; margin: 0 0 0.5rem; }
    .empty p { color: var(--text-2); margin: 0 0 1.5rem; line-height: 1.6; }
    .empty-input { display: flex; gap: 8px; }
    .empty-input input { flex: 1; padding: 0.7rem 0.9rem; background: var(--bg-2);
      border: 0.5px solid var(--border-strong); border-radius: var(--radius);
      color: var(--text-1); font-size: 14px; }
    .empty-input input:focus { outline: none; border-color: var(--accent); }
    .empty-replay { margin-top: 0.8rem; font-size: 13px; color: var(--text-3); }
    .suggestions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 1.5rem; }
    .chip { padding: 0.5rem 0.8rem; background: var(--bg-1); border: 0.5px solid var(--border);
      border-radius: 999px; color: var(--text-2); font-size: 12px; cursor: pointer; text-align: left; }
    .chip:hover { border-color: var(--accent-border); color: var(--text-1); }

    /* Buttons */
    .btn-primary { padding: 0.7rem 1.2rem; background: var(--accent); color: #fff;
      border: none; border-radius: var(--radius); font-size: 14px; font-weight: 500; cursor: pointer; }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-ghost { padding: 0.5rem 0.9rem; background: transparent; color: var(--text-2);
      border: 0.5px solid var(--border-strong); border-radius: var(--radius); font-size: 13px; cursor: pointer; }
    .btn-ghost:hover { color: var(--text-1); border-color: var(--accent-border); }
    .link { background: none; border: none; color: var(--accent); cursor: pointer;
      font-size: 13px; text-decoration: underline; padding: 0; }

    /* 3-column grid */
    .grid { flex: 1; display: grid; grid-template-columns: 220px 1fr 250px; min-height: 0; }
    .col-left { border-right: 0.5px solid var(--border); padding: 14px 12px; overflow-y: auto; }
    .col-center { padding: 14px; overflow-y: auto; }
    .col-right { border-left: 0.5px solid var(--border); padding: 14px 12px; background: var(--bg-1); overflow-y: auto; }

    .section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--text-3); margin: 0 0 8px; }
    .col-left .section-label:not(:first-child),
    .col-center .section-label:not(:first-child) { margin-top: 18px; }

    /* Left column */
    .q-text { font-size: 13px; color: var(--text-1); line-height: 1.5; }
    .plan { display: flex; flex-direction: column; gap: 6px; }
    .plan-node { padding: 8px; border-radius: var(--radius); background: var(--bg-1);
      border-left: 2px solid var(--border-strong); }
    .plan-node.active { background: var(--accent-bg); border-left-color: var(--accent); }
    .plan-node-text { font-size: 11px; color: var(--text-2); line-height: 1.4; }
    .plan-node.active .plan-node-text { color: var(--accent); }
    .left-actions { margin-top: 18px; }

    /* Agent cards */
    .agents { display: flex; flex-direction: column; gap: 10px; }
    .agent { background: var(--bg-2); border: 0.5px solid var(--border);
      border-radius: var(--radius-lg); padding: 12px; transition: border-color 0.3s, background 0.3s;
      animation: cardIn 0.3s ease; }
    .agent[data-status="tool_call"] { border-color: var(--accent-border); background: var(--accent-bg); }
    .agent[data-status="finished"] { border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
    .agent[data-status="error"] { border-color: color-mix(in srgb, var(--danger) 50%, transparent); background: var(--danger-bg); }
    .agent-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .agent-id { font-family: var(--font-mono); font-size: 12px; font-weight: 500; color: var(--text-1); }
    .agent-status { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-2); }
    .agent-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
    .agent[data-status="thinking"] .agent-status-dot { background: var(--text-3); animation: pulse 1.2s ease-in-out infinite; }
    .agent[data-status="tool_call"] .agent-status { color: var(--accent); }
    .agent[data-status="tool_call"] .agent-status-dot { background: var(--accent); }
    .agent[data-status="finished"] .agent-status { color: var(--ok); }
    .agent[data-status="finished"] .agent-status-dot { background: var(--ok); }
    .agent[data-status="error"] .agent-status { color: var(--danger); }
    .agent[data-status="error"] .agent-status-dot { background: var(--danger); }
    .agent-q { font-size: 12px; color: var(--text-2); line-height: 1.4; }
    .agent-tool { font-family: var(--font-mono); font-size: 11px; background: var(--bg-0);
      border-radius: 6px; padding: 6px 8px; color: var(--accent); margin-top: 8px; word-break: break-all; }
    .agent-findings { font-size: 12px; color: var(--text-2); line-height: 1.5; margin-top: 8px;
      max-height: 10rem; overflow-y: auto; white-space: pre-wrap; border-top: 0.5px solid var(--border); padding-top: 8px; }

    /* Report */
    .report { font-size: 13.5px; line-height: 1.65; color: var(--text-1); }
    .report h2 { font-size: 1.1rem; font-weight: 500; margin: 1.2rem 0 0.5rem; }
    .report h3 { font-size: 0.98rem; font-weight: 500; margin: 1rem 0 0.4rem; color: var(--text-1); }
    .report p { margin: 0 0 0.8rem; color: var(--text-2); }
    .report strong { color: var(--text-1); font-weight: 500; }
    .report sup a { color: var(--accent); text-decoration: none; font-size: 0.7em; padding: 0 1px; }

    /* Citations */
    .citations { display: flex; flex-direction: column; gap: 8px; }
    .citation { display: flex; gap: 10px; align-items: flex-start; padding: 10px;
      background: var(--bg-2); border: 0.5px solid var(--border); border-radius: var(--radius);
      text-decoration: none; transition: border-color 0.2s; }
    .citation:hover { border-color: var(--accent-border); }
    .citation-num { flex-shrink: 0; width: 20px; height: 20px; border-radius: 5px;
      background: var(--accent-bg); color: var(--accent); font-size: 11px; font-weight: 500;
      display: flex; align-items: center; justify-content: center; }
    .citation-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .citation-title { font-size: 12.5px; color: var(--text-1); }
    .citation-url { font-size: 11px; color: var(--text-3); font-family: var(--font-mono);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Event stream */
    .stream-filters { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 10px; }
    .filter-chip { padding: 3px 8px; background: transparent; border: 0.5px solid var(--border);
      border-radius: 999px; color: var(--text-3); font-size: 10.5px; cursor: pointer; }
    .filter-chip.active { background: var(--accent-bg); border-color: var(--accent-border); color: var(--accent); }
    .stream { display: flex; flex-direction: column; }
    .stream-row { display: flex; align-items: center; gap: 6px; padding: 4px 4px;
      border-bottom: 0.5px solid var(--border); animation: rowIn 0.25s ease; }
    .stream-type { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-2); }
    .stream-row[data-type^="report"] .stream-type { color: var(--ok); }
    .stream-row[data-type="error"] .stream-type { color: var(--danger); }
    .stream-row[data-type*="tool"] .stream-type { color: var(--accent); }
    .stream-sub { font-family: var(--font-mono); font-size: 10px; color: var(--text-3); }
    .hint { font-size: 12px; color: var(--text-3); font-style: italic; padding: 8px 0; }

    /* Animations */
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    @keyframes cardIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes rowIn { from { opacity: 0; } to { opacity: 1; } }

    @media (max-width: 800px) {
      .grid { grid-template-columns: 1fr; }
      .col-left, .col-right { border: none; border-bottom: 0.5px solid var(--border); }
    }
  `],
})
export class AppComponent {
  readonly research = inject(ResearchService);
  private sanitizer = inject(DomSanitizer);
  readonly question = signal('');
  readonly suggestions = SUGGESTIONS;

  readonly EVENT_FILTERS = [
    { key: 'all', label: 'todos' },
    { key: 'plan', label: 'plan' },
    { key: 'subagent', label: 'agentes' },
    { key: 'tool', label: 'tools' },
    { key: 'report', label: 'reporte' },
  ];
  readonly activeFilter = signal('all');

  readonly isEmpty = computed(
    () => this.research.mode() === 'idle' && this.research.events().length === 0,
  );

  agentList(): AgentState[] {
    return Object.values(this.research.state().agents);
  }

  hasAgent(index: number): boolean {
    return Object.keys(this.research.state().agents).length > index;
  }

  runLive(): void {
    const q = this.question().trim();
    if (q) this.research.connectLive(q);
  }

  useSuggestion(s: string): void {
    this.question.set(s);
    this.research.connectLive(s);
  }

  filteredEvents() {
    const f = this.activeFilter();
    const evs = this.research.events();
    if (f === 'all') return evs;
    if (f === 'plan') return evs.filter((e) => e.type.startsWith('session') || e.type.startsWith('plan'));
    if (f === 'subagent') return evs.filter((e) => e.type.startsWith('subagent'));
    if (f === 'tool') return evs.filter((e) => e.type.includes('tool'));
    if (f === 'report') return evs.filter((e) => e.type.startsWith('report') || e.type === 'error');
    return evs;
  }

  reportHtml(): SafeHtml {
    const r = this.research.state().report;
    return this.sanitizer.bypassSecurityTrustHtml(miniMarkdown(r?.summary ?? ''));
  }

  agentStatusLabel(status: string): string {
    const map: Record<string, string> = {
      thinking: 'pensando',
      tool_call: 'ejecutando tool',
      finished: 'terminado',
      error: 'error',
    };
    return map[status] ?? status;
  }

  toolText(a: AgentState): string {
    if (!a.lastTool) return '';
    const input = a.lastToolInput as Record<string, unknown> | undefined;
    const arg = input?.['query'] ?? input?.['url'] ?? '';
    return `${a.lastTool}(${arg ? '"' + arg + '"' : ''})`;
  }

  subOf(ev: { payload: Record<string, unknown> }): string {
    const s = ev.payload?.['subagent'];
    return s ? String(s) : '';
  }
}