export const globals = new Set(Object.getOwnPropertyNames(globalThis))

// Not available in node.js, but add to use in tests
globals.add('fetch')
