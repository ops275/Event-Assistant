import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Historical video tests create tiny fixture assets next to the source modules.
// Run against a temporary source copy so real application media is never changed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyplay-bot-tests-'));
try {
  fs.cpSync(path.join(root, 'bot'), temporary, {
    recursive: true,
    filter: source => !source.split(path.sep).includes('node_modules') && !/\.(?:mp4|png|jpg|jpeg)$/i.test(source),
  });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  // This regression checks the real web response policy alongside bot helpers.
  fs.copyFileSync(path.join(root, 'calendar-web/calendar-web.mjs'), path.join(temporary, 'calendar-web.mjs'));
  const tests = fs.readdirSync(path.join(temporary, 'test')).filter(name => name.endsWith('.test.js')).map(name => path.join(temporary, 'test', name));
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], {cwd: temporary, stdio: 'inherit'});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}
