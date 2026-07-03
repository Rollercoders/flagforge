import { describe, it, expect } from 'vitest';
import { FlagChangeBus, FlagChange } from '../events/flagChangeBus.js';

describe('FlagChangeBus', () => {
  it('consegna gli eventi ai sottoscrittori', () => {
    const bus = new FlagChangeBus();
    const received: FlagChange[] = [];
    bus.subscribe(c => received.push(c));
    bus.emit({ projectId: 'p1', environment: 'production' });
    expect(received).toEqual([{ projectId: 'p1', environment: 'production' }]);
  });

  it('consegna a più sottoscrittori', () => {
    const bus = new FlagChangeBus();
    let a = 0, b = 0;
    bus.subscribe(() => a++);
    bus.subscribe(() => b++);
    bus.emit({ projectId: 'p1' });
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('unsubscribe ferma le notifiche', () => {
    const bus = new FlagChangeBus();
    const received: FlagChange[] = [];
    const unsub = bus.subscribe(c => received.push(c));
    unsub();
    bus.emit({ projectId: 'p1' });
    expect(received).toEqual([]);
  });
});
