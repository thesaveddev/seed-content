import { readFileSync } from 'fs';

const cov = JSON.parse(readFileSync('coverage/coverage-final.json', 'utf8'));
const out = [];
for (const [file, data] of Object.entries(cov)) {
  const path = file.replace(/\\/g, '/').split('/apps/posty/')[1] || file;
  const uncov = [];
  for (const [id, count] of Object.entries(data.s)) {
    if (count === 0) uncov.push(data.statementMap[id].start.line);
  }
  const uncovBranch = [];
  for (const [id, counts] of Object.entries(data.b)) {
    counts.forEach((c, i) => { if (c === 0) uncovBranch.push(data.branchMap[id].locations[i].start.line); });
  }
  if (uncov.length || uncovBranch.length) {
    const uniq = [...new Set(uncov)].sort((a, b) => a - b);
    const buniq = [...new Set(uncovBranch)].sort((a, b) => a - b);
    out.push(path + '\n  stmts: ' + uniq.join(',') + (buniq.length ? '\n  branches: ' + buniq.join(',') : ''));
  }
}
console.log(out.join('\n'));
