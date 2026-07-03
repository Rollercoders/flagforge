import { EventEmitter } from 'events';

export interface FlagChange {
  projectId: string;
  environment?: string;
}

const EVENT = 'flag-change';

export class FlagChangeBus {
  private emitter = new EventEmitter();

  constructor() {
    // Molte connessioni SSE possono sottoscrivere: alza il limite per evitare il warning di leak.
    this.emitter.setMaxListeners(0);
  }

  emit(change: FlagChange): void {
    this.emitter.emit(EVENT, change);
  }

  subscribe(listener: (change: FlagChange) => void): () => void {
    this.emitter.on(EVENT, listener);
    return () => this.emitter.off(EVENT, listener);
  }
}
