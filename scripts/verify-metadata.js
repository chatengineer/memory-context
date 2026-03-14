const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'openclaw.plugin.json'), 'utf8'));

const failures = [];

if (pkg.name !== manifest.id) {
  failures.push(`package.json name (${pkg.name}) must match plugin id (${manifest.id})`);
}

if (pkg.version !== manifest.version) {
  failures.push(`package.json version (${pkg.version}) must match plugin manifest version (${manifest.version})`);
}

if (manifest.kind !== 'memory') {
  failures.push(`plugin manifest kind must be "memory", got ${manifest.kind}`);
}

if (!manifest.main || !fs.existsSync(path.join(root, manifest.main))) {
  failures.push(`plugin manifest main path does not exist: ${manifest.main}`);
}

if (!pkg.main || !pkg.main.startsWith('./dist/')) {
  failures.push(`package.json main should point to built dist entry, got ${pkg.main}`);
}

if (!pkg.types || !pkg.types.startsWith('./dist/')) {
  failures.push(`package.json types should point to built declarations, got ${pkg.types}`);
}

if (!pkg.scripts || !pkg.scripts.build || !pkg.scripts.test) {
  failures.push('package.json scripts must include build and test');
}

if (failures.length > 0) {
  console.error('Metadata verification failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}

console.log(`Metadata OK for ${pkg.name}@${pkg.version}`);
