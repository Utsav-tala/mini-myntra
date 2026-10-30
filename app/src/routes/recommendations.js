const express = require('express');
const { products, toPublic, FEATURES, mulberry32 } = require('../catalog');

// A user's taste as a feature vector, derived from the user ID so the
// same user always gets the same recommendations on any instance.
function userVector(userId) {
  const rand = mulberry32(userId * 7919);
  return Array.from({ length: FEATURES }, () => rand() * 2 - 1);
}

// Scores every product against the user several times over (a stand-in
// for Myntra's per-request ranking model). This is CPU-bound on purpose:
// it is what pushes instance CPU past the 50% autoscaling target.
function rank(userId, rounds) {
  const u = userVector(userId);
  const scores = new Float64Array(products.length);
  for (let r = 0; r < rounds; r++) {
    const shift = r % FEATURES;
    for (let p = 0; p < products.length; p++) {
      const f = products[p].features;
      let dot = 0;
      for (let k = 0; k < FEATURES; k++) {
        dot += u[k] * f[(k + shift) % FEATURES];
      }
      scores[p] += dot / (r + 1);
    }
  }
  return scores;
}

function recommendationsRouter({ rounds }) {
  const router = express.Router();

  router.get('/:userId', (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) {
      return res.status(400).json({ error: 'user id must be a positive integer' });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 20);

    const scores = rank(userId, rounds);
    const top = products
      .map((p, i) => ({ p, score: scores[i] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ p, score }) => ({ ...toPublic(p), score: Number(score.toFixed(4)) }));

    return res.json({ userId, count: top.length, items: top });
  });

  return router;
}

module.exports = { recommendationsRouter };
