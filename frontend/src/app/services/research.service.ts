import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { RuntimeEvent } from '../models/events.model';
import { deriveState } from './derive-state';

type Mode = 'idle' | 'live' | 'replay';

@Injectable({ providedIn: 'root' })
export class ResearchService {
  private http = inject(HttpClient);
  private socket: WebSocket | null = null;
  private replayTimer: ReturnType<typeof setInterval> | null = null;

  readonly events = signal<RuntimeEvent[]>([]);
  readonly connected = signal(false);
  readonly mode = signal<Mode>('idle');

  readonly state = computed(() => deriveState(this.events()));

  connectLive(question: string, sessionId: string = crypto.randomUUID()): void {
    this.reset();
    this.mode.set('live');

    this.socket = new WebSocket(`ws://localhost:8000/ws/research/${sessionId}`);
    this.socket.addEventListener('open', () => {
      this.connected.set(true);
      this.socket?.send(JSON.stringify({ question }));
    });
    this.socket.addEventListener('message', (msg) => {
      try {
        const ev = JSON.parse(msg.data) as RuntimeEvent;
        this.events.update((arr) => [...arr, ev]);
      } catch (err) {
        console.error('Bad event payload', err, msg.data);
      }
    });
    this.socket.addEventListener('close', () => this.connected.set(false));
    this.socket.addEventListener('error', (err) => {
      console.error('WebSocket error', err);
      this.connected.set(false);
    });
  }

  async startReplay(stepMs = 450): Promise<void> {
    this.reset();
    this.mode.set('replay');

    const text = await firstValueFrom(
      this.http.get('assets/demo-run.jsonl', { responseType: 'text' }),
    );
    const all: RuntimeEvent[] = text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as RuntimeEvent);

    let i = 0;
    this.connected.set(true);
    this.replayTimer = setInterval(() => {
      if (i >= all.length) {
        if (this.replayTimer) clearInterval(this.replayTimer);
        this.replayTimer = null;
        this.connected.set(false);
        return;
      }
      this.events.update((arr) => [...arr, all[i]]);
      i += 1;
    }, stepMs);
  }

  reset(): void {
    this.socket?.close();
    this.socket = null;
    if (this.replayTimer) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
    this.events.set([]);
    this.connected.set(false);
    this.mode.set('idle');
  }
}
