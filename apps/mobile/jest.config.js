module.exports = {
  preset: "@react-native/jest-preset",
  moduleNameMapper: {
    "^@app/(.*)$": "<rootDir>/src/$1",
  },
  // pnpm layout: RN's jest preset ships ESM setup files stored deep inside
  // node_modules/.pnpm/<pkg>@<ver>_<peer>/node_modules/<pkg>/... The default
  // ignore patterns can't express that nesting reliably, so we transform
  // everything (test surface is small; correctness over speed).
  transformIgnorePatterns: [],
};
