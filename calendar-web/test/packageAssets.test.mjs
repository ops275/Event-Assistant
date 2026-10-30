import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('calendar package includes every browser script served by its routes', () => {
  for (const name of ['onboarding-ui.js', 'dashboard-ui.js', 'miniapp-ui.js', 'ae-calendar-ui.js', 'booking-link-ui.js']) {
    assert.ok(fs.existsSync(new URL('../' + name, import.meta.url)), 'Missing browser asset: ' + name);
  }
});
