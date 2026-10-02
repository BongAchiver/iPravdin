const fs = require('node:fs');
const path = require('node:path');
const { ZipArchive } = require('archiver');
const manifest = JSON.parse(fs.readFileSync('app/manifest.json', 'utf8'));
const outputPath = path.resolve('dist', `ipravdin-firefox-${manifest.version}.zip`);
fs.mkdirSync('dist', { recursive: true });
const output = fs.createWriteStream(outputPath);
const archive = new ZipArchive({ zlib: { level: 9 } });
archive.on('error', error => { console.error(error); process.exitCode = 1; });
output.on('close', () => {
  fs.copyFileSync(outputPath, outputPath.replace(/\.zip$/, '.xpi'));
  console.log(`Built ${outputPath} (${archive.pointer()} bytes). XPI is unsigned.`);
});
archive.pipe(output);
archive.directory('app/', false);
archive.finalize();
