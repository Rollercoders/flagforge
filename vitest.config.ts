import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // I test HTTP usano supertest con `request(app)`: ogni richiesta apre un
    // server effimero, e sotto carico un socket puo' essere resettato
    // (`read ECONNRESET`), causando fallimenti sporadici non deterministici.
    // Il retry ritenta il singolo test flaky invece di far fallire l'intera
    // suite (ed evita che l'hook pre-commit si blocchi per rumore di rete).
    retry: 2,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'examples/']
    }
  }
});
