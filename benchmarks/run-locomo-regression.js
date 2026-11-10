// Lightweight LoCoMo-style retrieval regression guard.
// Run after build so it exercises the emitted plugin modules.

const { BM25Index } = require('../dist/src/search/bm25-index.js');
const { QueryNormalizer } = require('../dist/src/search/query-normalizer.js');

const docs = [
  {
    id: 'turn-001',
    content: 'On 2026-04-01, Alice Chen told Sam that the deployment failed because the Redis cache key used the old tenant alias.',
    metadata: { timestamp: Date.parse('2026-04-01T10:00:00Z'), speaker: 'Alice Chen' }
  },
  {
    id: 'turn-002',
    content: 'Alice repeated that Redis cache key issue in April, but added no new root cause.',
    metadata: { timestamp: Date.parse('2026-04-02T10:00:00Z'), speaker: 'Alice' }
  },
  {
    id: 'turn-003',
    content: 'The user said their preferred newsletter CTA is a short engineering lesson followed by one concrete question.',
    metadata: { timestamp: Date.parse('2026-02-14T10:00:00Z'), speaker: 'user' }
  },
  {
    id: 'turn-004',
    content: 'In March 2026, Bruno asked to rename Project Fennec to Fennec Leap after the benchmark writeup.',
    metadata: { timestamp: Date.parse('2026-03-07T10:00:00Z'), speaker: 'Bruno' }
  },
  {
    id: 'turn-005',
    content: 'A generic discussion about model routing and latency budgets that should not outrank named evidence.',
    metadata: { timestamp: Date.parse('2026-04-20T10:00:00Z'), speaker: 'assistant' }
  }
];

const questions = [
  { q: 'What did Alice say caused the Apr 1 deployment failure?', expected: 'turn-001' },
  { q: 'What CTA did I prefer?', expected: 'turn-003' },
  { q: 'Who renamed Project Fennec in 2026-03?', expected: 'turn-004' }
];

const normalizer = new QueryNormalizer();
const index = new BM25Index({ minDocFreq: 1 });
for (const doc of docs) index.addDocument(doc);

let hits = 0;
let reciprocalRank = 0;
const failures = [];

for (const question of questions) {
  const normalized = normalizer.normalize(question.q, docs);
  const results = index.search(normalized.expanded, 5);
  const found = results.find(r => r.id === question.expected);
  if (found) {
    hits++;
    reciprocalRank += 1 / (results.findIndex(r => r.id === question.expected) + 1);
  } else {
    failures.push(question);
  }
}

const hitAt5 = hits / questions.length;
const mrr = reciprocalRank / questions.length;

console.log(`LoCoMo Regression Guard`);
console.log(`Hit@5: ${hitAt5.toFixed(2)} (target: 1.00)`);
console.log(`MRR:   ${mrr.toFixed(2)} (target: >=0.75)`);

if (failures.length > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f.q}`);
}

const pass = hitAt5 >= 1.0 && mrr >= 0.75;
process.exit(pass ? 0 : 1);