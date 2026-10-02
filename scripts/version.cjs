const fs = require('node:fs');
const version = process.argv[2];
if (!version || !/^\d{1,9}(\.\d{1,9}){0,3}$/.test(version) || version.split('.').some(n => Number(n) > 65535)) {
  throw new Error('Use a Firefox release version, for example: npm run version:set -- 2.0.2 (components 0–65535).');
}
for (const file of ['app/manifest.json', 'package.json', 'package-lock.json']) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.version = version;
  if (data.packages?.['']) data.packages[''].version = version;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
console.log(`Version set to ${version}.`);
