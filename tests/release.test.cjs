const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const scripts = path.resolve('scripts');
const { resolveVersion } = require('../scripts/release-version.cjs');

test('push releases generate increasing versions without modifying the source version', () => {
  assert.equal(resolveVersion({ source: '2.1.0', latest: '2.1.0', runNumber: 4 }), '2.1.0.4');
  assert.equal(resolveVersion({ source: '2.1.0', latest: '2.1.0.4', runNumber: 5 }), '2.1.0.5');
  assert.equal(resolveVersion({ source: '2.1.0', latest: '2.2.0', runNumber: 6 }), '2.2.0.6');
  assert.equal(resolveVersion({ source: '2.3.0', latest: '2.2.0.6', runNumber: 7 }), '2.3.0.7');
  assert.equal(resolveVersion({ source: '2.1.0', latest: '2.1.0.100', runNumber: 8 }), '2.1.1.8');
});

test('reruns reserve a different version and manual releases cannot downgrade the published release', () => {
  assert.equal(resolveVersion({ source: '2.1.0', latest: '2.1.0', runNumber: 4, attempt: 2 }), '2.1.1.4');
  assert.equal(resolveVersion({ source: '2.1.0', latest: '2.1.0.4', requested: '2.2.0' }), '2.2.0');
  assert.throws(() => resolveVersion({ source: '2.1.0', latest: '2.1.0.4', requested: '2.1.0' }));
  assert.throws(() => resolveVersion({ source: '2.1.0', runNumber: 65536 }));
  assert.throws(() => resolveVersion({ source: '2.1.0', runNumber: 1, requested: '2.1.0\nversion=evil' }));
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ipravdin-release-'));
  fs.mkdirSync(path.join(directory, 'app'));
  fs.writeFileSync(path.join(directory, 'app/manifest.json'), JSON.stringify({
    version: '2.0.1', browser_specific_settings: { gecko: { id: 'fixture@example.test', strict_min_version: '140.0' } }
  }));
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '2.0.1' }));
  fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({ version: '2.0.1', packages: { '': { version: '2.0.1' } } }));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^ipravdin-release-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    run: (script, ...args) => execFileSync(process.execPath, [path.join(scripts, script), ...args], { cwd: directory, stdio: 'pipe' }),
    read: file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
  };
}

test('release version updates the extension, package and lockfile consistently', t => {
  const f = fixture(t);
  f.run('version.cjs', '2.0.2');
  for (const file of ['app/manifest.json', 'package.json', 'package-lock.json']) assert.equal(f.read(file).version, '2.0.2');
  assert.equal(f.read('package-lock.json').packages[''].version, '2.0.2');
  for (const value of ['v2.0.3', '65536.0', '2.0.0.0.1', '2.0;echo bad']) assert.throws(() => f.run('version.cjs', value));
  assert.equal(f.read('app/manifest.json').version, '2.0.2');
});

test('update URL rejects insecure addresses and embedded credentials without changing the manifest', t => {
  const f = fixture(t);
  for (const url of ['http://example.test/updates.json', 'https://user:password@example.test/updates.json', 'https://example.test/updates.json#fragment']) {
    assert.throws(() => f.run('configure-updates.cjs', url));
    assert.equal(f.read('app/manifest.json').browser_specific_settings.gecko.update_url, undefined);
  }
});

test('update metadata uses the downloaded XPI hash, extension ID and release version', t => {
  const f = fixture(t);
  f.run('version.cjs', '2.0.2');
  f.run('configure-updates.cjs', 'https://example.test/updates.json');
  fs.mkdirSync(path.join(f.directory, 'dist/signed'), { recursive: true });
  // This tests metadata generation, not cryptographic verification of an XPI.
  const bytes = Buffer.from('signing-output-fixture');
  fs.writeFileSync(path.join(f.directory, 'dist/signed/downloaded.xpi'), bytes);
  f.run('prepare-updates.cjs', 'https://example.test/v2.0.2/ipravdin.xpi');
  const update = f.read('dist/release/updates.json').addons['fixture@example.test'].updates[0];
  assert.equal(update.version, '2.0.2');
  assert.equal(update.update_link, 'https://example.test/v2.0.2/ipravdin.xpi');
  assert.equal(update.update_hash, 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(update.applications.gecko.strict_min_version, '140.0');
  assert.deepEqual(fs.readFileSync(path.join(f.directory, 'dist/release/ipravdin.xpi')), bytes);
  fs.writeFileSync(path.join(f.directory, 'dist/signed/stale.xpi'), bytes);
  assert.throws(() => f.run('prepare-updates.cjs', 'https://example.test/v2.0.2/ipravdin.xpi'));
});
