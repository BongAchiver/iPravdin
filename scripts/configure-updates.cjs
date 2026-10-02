const fs = require('node:fs');
const updateUrl = process.argv[2];
const url = new URL(updateUrl);
if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
  throw new Error('The update manifest needs an HTTPS URL without credentials or a fragment.');
}
const file = 'app/manifest.json';
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.browser_specific_settings.gecko.update_url = url.href;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Firefox will check ${url.href} for updates.`);
