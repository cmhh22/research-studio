import { Component, computed, inject, signal } from '@angular/core';
import { ResearchService } from './services/research.service';
import { AgentState } from './models/events.model';

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

          <!-- CENTER: placeholder (parte 2 = agent cards) -->
          <main class="col-center">
            <div class="section-label">Subagentes activos</div>
            <div class="agents-placeholder">
              @for (a of agentList(); track a.id) {
                <div class="agent-tmp">
                  <b>{{ a.id }}</b> — {{ a.status }}
                  <div class="agent-tmp-q">{{ a.question }}</div>
                </div>
              }
            </div>

            @if (research.state().report; as report) {
              <div class="section-label">Reporte</div>
              <div class="report-tmp">{{ report.summary }}</div>
            }
          </main>

          <!-- RIGHT: placeholder (parte 2 = event stream) -->
          <aside class="col-right">
            <div class="stream-hdr">
              <span class="section-label">Stream</span>
              <span class="stream-count">{{ research.events().length }}</span>
            </div>
            <div class="stream-tmp">
              @for (ev of research.events(); track ev.id) {
                <div class="stream-row">{{ ev.type }}</div>
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

    /* Placeholders (replaced in part 2) */
    .agent-tmp { background: var(--bg-2); border: 0.5px solid var(--border); border-radius: var(--radius-lg);
      padding: 12px; margin-bottom: 10px; font-size: 12px; }
    .agent-tmp-q { color: var(--text-2); margin-top: 4px; }
    .report-tmp { white-space: pre-wrap; font-size: 13px; color: var(--text-1);
      background: var(--bg-2); border: 0.5px solid var(--border); border-radius: var(--radius-lg); padding: 12px; }
    .stream-hdr { display: flex; align-items: center; justify-content: space-between; }
    .stream-count { font-family: var(--font-mono); font-size: 11px; color: var(--text-3); }
    .stream-tmp { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-2); }
    .stream-row { padding: 4px 0; border-bottom: 0.5px solid var(--border); }

    @media (max-width: 800px) {
      .grid { grid-template-columns: 1fr; }
      .col-left, .col-right { border: none; border-bottom: 0.5px solid var(--border); }
    }
  `],
})
export class AppComponent {
  readonly research = inject(ResearchService);
  readonly question = signal('');
  readonly suggestions = SUGGESTIONS;

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
}