const express = require('express');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A small landing page for the live URL. It names the server that
// answered, so refreshing while the group has several instances shows
// the load balancer switching between them.
function homeRouter({ instanceId, redis }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const uptime = Math.round(process.uptime());
    const redisState = redis ? redis.status || 'connected' : 'off';

    res.set('Cache-Control', 'no-store');
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mini-Myntra</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #1f2328; }
  h1 { margin-bottom: 4px; }
  .sub { color: #59636e; margin-top: 0; }
  .card { border: 1px solid #d1d9e0; border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
  code { background: #f6f8fa; padding: 2px 6px; border-radius: 4px; }
  td { padding: 4px 12px 4px 0; vertical-align: top; }
</style>
</head>
<body>
<h1>Mini-Myntra</h1>
<p class="sub">Flash-sale scaling proof of concept on AWS (IT457, Group 9)</p>

<div class="card">
  <table>
    <tr><td>Status</td><td><strong>OK</strong></td></tr>
    <tr><td>Served by instance</td><td><code>${escapeHtml(instanceId)}</code></td></tr>
    <tr><td>Instance uptime</td><td>${uptime} s</td></tr>
    <tr><td>Redis</td><td>${escapeHtml(redisState)}</td></tr>
  </table>
  <p>Refresh while the Auto Scaling Group runs several instances to see the load balancer switch servers.</p>
</div>

<h2>Endpoints</h2>
<table>
  <tr><td><a href="/health">GET /health</a></td><td>Load balancer health check</td></tr>
  <tr><td><a href="/api/products/7">GET /api/products/7</a></td><td>Product and price, Redis cache first</td></tr>
  <tr><td><a href="/api/recommendations/42">GET /api/recommendations/42</a></td><td>Personalised picks (CPU-heavy)</td></tr>
  <tr><td><a href="/api/flash-deal">GET /api/flash-deal</a></td><td>Flash-deal stock left</td></tr>
  <tr><td>POST /api/checkout</td><td>Buy the flash deal: <code>curl -X POST -H "Content-Type: application/json" -d '{"quantity":1}' &lt;this-url&gt;/api/checkout</code></td></tr>
</table>
</body>
</html>`);
  });

  return router;
}

module.exports = { homeRouter };
