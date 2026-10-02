const fs = require('node:fs');
function parse(version) {
  if (typeof version !== 'string' || !/^\d{1,5}(\.\d{1,5}){0,3}$/.test(version)) throw new Error('Invalid Firefox release version.');
  const parts = version.split('.').map(Number);
  if (parts.some(part => part > 65535)) throw new Error('Firefox version components must be at most 65535.');
  while (parts.length < 4) parts.push(0);
  return parts;
}
function compare(a, b) {
  for (let index = 0; index < 4; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}
function increment(parts) {
  for (let index = 2; index >= 0; index--) {
    if (parts[index] < 65535) { parts[index]++; return; }
    parts[index] = 0;
  }
  throw new Error('Firefox version range exhausted.');
}
function resolveVersion({ source, latest, requested = '', runNumber, attempt = 1 }) {
  const baseline = parse(source);
  const published = latest ? parse(latest) : [0, 0, 0, 0];
  if (requested) {
    const explicit = parse(requested);
    if (compare(explicit, published) <= 0) throw new Error('The requested version must be higher than the latest published release.');
    return requested;
  }
  if (!Number.isInteger(runNumber) || runNumber < 1 || runNumber > 65535 || !Number.isInteger(attempt) || attempt < 1 || attempt > 65535) {
    throw new Error('Invalid workflow run number or attempt (supported range: 1–65535).');
  }
  const base = compare(baseline, published) >= 0 ? baseline : published;
  const candidate = [...base.slice(0, 3), runNumber];
  // Run numbers reserve distinct versions even if signing succeeds but publishing fails.
  // A rerun gets a later patch so it does not submit the same version to Mozilla again.
  for (let retry = 1; retry < attempt; retry++) increment(candidate);
  if (compare(candidate, base) <= 0) increment(candidate);
  return candidate.join('.');
}
async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY must contain owner/repository.');
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers, signal: AbortSignal.timeout(20000) });
  let latest;
  if (response.ok) {
    const release = await response.json();
    latest = release.tag_name.replace(/^v/, '');
  } else if (response.status !== 404) {
    throw new Error(`Cannot check the latest release (HTTP ${response.status}).`);
  }
  const manifest = JSON.parse(fs.readFileSync('app/manifest.json', 'utf8'));
  const version = resolveVersion({ source: manifest.version, latest,
    requested: process.env.REQUESTED_VERSION || '', runNumber: Number(process.env.GITHUB_RUN_NUMBER), attempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1) });
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required inside GitHub Actions.');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`Release version: ${version}`);
}
module.exports = { resolveVersion };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
