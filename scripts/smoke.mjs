// Zero-network smoke: the build artifact exists and carries the app title.
import { readFileSync, existsSync } from 'node:fs';

const dist = new URL('../dist/index.html', import.meta.url);
if (!existsSync(dist)) {
  console.error('smoke: FAIL — dist/index.html missing (run npm run build first)');
  process.exit(1);
}
const html = readFileSync(dist, 'utf8');
if (!html.includes('PrivRedact')) {
  console.error('smoke: FAIL — title missing from dist/index.html');
  process.exit(1);
}
console.log('smoke: OK (dist/index.html carries PrivRedact, zero network)');
