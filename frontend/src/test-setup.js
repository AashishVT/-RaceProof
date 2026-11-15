import '@testing-library/jest-dom/vitest';

const values = new Map();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  },
});
