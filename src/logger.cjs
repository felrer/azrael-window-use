'use strict';
const fs = require('node:fs');
const path = require('node:path');
function createLogger(directory, version) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'window-use.log');
  return (level, component, event, fields = {}) => {
    // Callers pass only metadata, never arguments, UI text, captures or raw errors.
    const record = { timestamp: new Date().toISOString(), level, component, event, version, platform: process.platform, arch: process.arch };
    for (const key of ['requestId','connectionId','tool','code','nativeCode','durationMs']) if (fields[key] !== undefined) record[key] = String(fields[key]).slice(0, 128);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) { const previous = file + '.1'; if (fs.existsSync(previous)) fs.unlinkSync(previous); fs.renameSync(file, previous); }
      fs.appendFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600 });
    } catch { process.stderr.write('[Window Use] Diagnostic log unavailable\n'); }
  };
}
module.exports = { createLogger };
