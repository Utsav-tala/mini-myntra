// A fixed, generated catalogue so every instance holds identical data
// without needing a database. Seeded, so runs are repeatable.

const PRODUCT_COUNT = 500;
const FEATURES = 16;

const BRANDS = ['Roadster', 'HRX', 'Mast & Harbour', 'Here&Now', 'Anouk', 'Puma', 'Nike', 'Levis'];
const CATEGORIES = ['T-Shirts', 'Jeans', 'Kurtas', 'Sneakers', 'Dresses', 'Jackets', 'Watches', 'Bags'];

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCatalog() {
  const rand = mulberry32(457);
  const products = [];
  for (let id = 1; id <= PRODUCT_COUNT; id++) {
    const mrp = 499 + Math.floor(rand() * 40) * 100;
    const discountPercent = 10 + Math.floor(rand() * 7) * 10;
    products.push({
      id,
      name: `${CATEGORIES[id % CATEGORIES.length]} #${id}`,
      brand: BRANDS[Math.floor(rand() * BRANDS.length)],
      category: CATEGORIES[id % CATEGORIES.length],
      mrp,
      discountPercent,
      price: Math.round(mrp * (1 - discountPercent / 100)),
      features: Array.from({ length: FEATURES }, () => rand() * 2 - 1),
    });
  }
  return products;
}

const products = buildCatalog();
const byId = new Map(products.map((p) => [p.id, p]));

// Public view of a product, without the feature vector.
function toPublic({ features, ...rest }) {
  return rest;
}

module.exports = { products, byId, toPublic, FEATURES, mulberry32 };
