// Keep k6's pretty end-of-test summary on stdout AND dump the full JSON to
// /results for later inspection. (textSummary is fetched from the k6 jslib CDN
// on first run — the load-generator machine needs outbound internet once.)
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

export function handleSummary(data) {
  return {
    stdout: '\n' + textSummary(data, { indent: '  ', enableColors: true }) + '\n',
    '/results/summary.json': JSON.stringify(data, null, 2),
  };
}
