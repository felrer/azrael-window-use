'use strict';
// Synthetic local identities must exercise Windows normalization and preserve
// Unix case without requiring the executable fixture to exist on disk.
const fixtureExecutable = relative => process.platform === 'win32' ? 'C:\\' + relative.replaceAll('/', '\\') : '/' + relative;
const expectedExecutable = relative => process.platform === 'win32' ? fixtureExecutable(relative).toLowerCase() : fixtureExecutable(relative);
module.exports = { fixtureExecutable, expectedExecutable };
