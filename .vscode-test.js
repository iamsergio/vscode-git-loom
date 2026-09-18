const { defineConfig } = require("@vscode/test-cli");

module.exports = defineConfig([
  {
    files: "out/test/integration/smoke.test.js",
    mocha: {
      timeout: 60000,
      ui: "tdd",
    },
  },
]);
