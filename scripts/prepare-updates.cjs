const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const downloadUrl = new URL(process.argv[2]);
if (downloadUrl.protocol !== 'https:' || downloadUrl.username || downloadUrl.password || downloadUrl.hash) {
  throw new Error('Provide the HTTPS download URL for the signed XPI.');
}
const manifest = JSON.parse(fs.readFileSync('app/manifest.json', 'utf8'));
if (!manifest.browser_specific_settings.gecko.update_url) {
  throw new Error('Configure the update URL before signing the extension.');
}
// This directory must contain only the result downloaded by web-ext sign.
const directory = 'dist/signed';
const files = fs.readdirSync(directory).filter(file => file.endsWith('.xpi'));
if (files.length !== 1) throw new Error('Expected exactly one signed XPI in dist/signed. Use a fresh directory for each release.');
const signed = fs.readFileSync(path.join(directory, files[0]));
const gecko = manifest.browser_specific_settings.gecko;
const metadata = { addons: { [gecko.id]: { updates: [{
  version: manifest.version,
  update_link: downloadUrl.href,
  update_hash: `sha256:${crypto.createHash('sha256').update(signed).digest('hex')}`,
  applications: { gecko: { strict_min_version: gecko.strict_min_version } }
}] } } };
fs.mkdirSync('dist/release', { recursive: true });
fs.writeFileSync('dist/release/ipravdin.xpi', signed);
fs.writeFileSync('dist/release/updates.json', JSON.stringify(metadata, null, 2) + '\n');
console.log('Prepared dist/release/ipravdin.xpi and dist/release/updates.json from the signing output.');
