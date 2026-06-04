import { Component, inject, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { ResearchService } from './services/research.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [JsonPipe],
  template: `
    <main>
      <h1>Research Studio <small>(3a · base funcional)</small></h1>

      <div class="bar">
        <input
          [value]="question()"
          (input)="question.set($any($event.target).value)"
          placeholder="Escribí una pregunta de investigación..."
        />
        <button (click)="runLive()" [disabled]="research.connected()">Investigar (live)</button>
        <button (click)="research.startReplay()">Reproducir demo (replay)</button>
        <button (click)="research.reset()">Limpiar</button>
      </div>

      <p class="status">
        modo: <b>{{ research.mode() }}</b> ·
        conexión: <b>{{ research.connected() ? 'activa' : 'inactiva' }}</b> ·
        sesión: <b>{{ research.state().sessionStatus }}</b>
      </p>

      @if (research.state().query) {
        <p><b>Pregunta:</b> {{ research.state().query }}</p>
      }

      @if (research.state().subquestions.length) {
        <h2>Subpreguntas</h2>
        <ol>
          @for (sq of research.state().subquestions; track sq) {
            <li>{{ sq }}</li>
          }
        </ol>
      }

      @if (agentList().length) {
        <h2>Subagentes</h2>
        <div class="agents">
          @for (a of agentList(); track a.id) {
            <div class="agent" [attr.data-status]="a.status">
              <div class="agent-head">{{ a.id }} — <span>{{ a.status }}</span></div>
              <div class="agent-q">{{ a.question }}</div>
              @if (a.lastTool) {
                <div class="agent-tool">tool: {{ a.lastTool }}</div>
              }
              @if (a.findings) {
                <div class="agent-find">{{ a.findings }}</div>
              }
            </div>
          }
        </div>
      }

      @if (research.state().report; as report) {
        <h2>Reporte</h2>
        <div class="report">{{ report.summary }}</div>
        @if (report.citations.length) {
          <h3>Citations</h3>
          <ul>
            @for (c of report.citations; track c.id) {
              <li><a [href]="c.url" target="_blank">{{ c.title }}</a> ({{ c.url }})</li>
            }
          </ul>
        }
      }

      @if (research.state().error) {
        <p class="err">Error: {{ research.state().error }}</p>
      }

      <h2>Stream de eventos ({{ research.events().length }})</h2>
      <ul class="events">
        @for (ev of research.events(); track ev.id) {
          <li><span class="t">{{ ev.type }}</span> <code>{{ ev.payload | json }}</code></li>
        } @empty {
          <li class="muted">Sin eventos. Probá "Investigar" o "Reproducir demo".</li>
        }
      </ul>
    </main>
  `,
  styles: [
    `
    main { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 1.5rem; }
    h1 small { font-size: 0.8rem; color: #888; font-weight: 400; }
    h2 { font-size: 1.05rem; margin-top: 1.5rem; color: #444; }
    .bar { display: flex; gap: 0.5rem; margin: 1rem 0; flex-wrap: wrap; }
    .bar input { flex: 1; min-width: 220px; padding: 0.5rem; }
    button { padding: 0.5rem 0.9rem; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { font-size: 0.85rem; color: #555; }
    .agents { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.6rem; }
    .agent { border: 1px solid #ddd; border-radius: 6px; padding: 0.6rem; font-size: 0.85rem; }
    .agent[data-status="finished"] { border-color: #4a4; background: #f3fbf3; }
    .agent[data-status="tool_call"] { border-color: #46a; background: #f3f6fb; }
    .agent[data-status="error"] { border-color: #c44; background: #fbf3f3; }
    .agent-head { font-weight: 600; }
    .agent-q { color: #555; margin: 0.2rem 0; }
    .agent-tool { font-family: monospace; font-size: 0.78rem; color: #46a; }
    .agent-find { margin-top: 0.3rem; font-size: 0.8rem; white-space: pre-wrap; max-height: 8rem; overflow: auto; }
    .report { white-space: pre-wrap; border: 1px solid #eee; padding: 0.8rem; border-radius: 6px; font-size: 0.9rem; }
    .events { list-style: none; padding: 0; font-size: 0.8rem; }
    .events li { padding: 0.35rem 0; border-bottom: 1px solid #f0f0f0; }
    .events .t { display: inline-block; min-width: 180px; color: #759; font-family: monospace; }
    .events code { color: #555; }
    .muted { color: #999; font-style: italic; }
    .err { color: #c33; }
  `,
  ],
})
export class AppComponent {
  readonly research = inject(ResearchService);
  readonly question = signal('What are the main effects of microplastic pollution on marine ecosystems?');

  agentList() {
    return Object.values(this.research.state().agents);
  }

  runLive(): void {
    const q = this.question().trim();
    if (q) this.research.connectLive(q);
  }
}
