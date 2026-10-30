const { byId, toPublic } = require('./catalog');

// Stands in for the slow primary database behind Myntra's cache
// (MongoDB in the pricing system). The delay is configurable so the
// cache-on vs cache-off experiment (E4) has something to measure.
function createSlowStore({ delayMs = 50 } = {}) {
  return {
    async getProduct(id) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const product = byId.get(id);
      return product ? toPublic(product) : null;
    },
  };
}

module.exports = { createSlowStore };
