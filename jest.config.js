"use strict";

module.exports = {
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  reporters: ["default", ["jest-junit", { output: "./reports/junit.xml" }]],
  testEnvironment: "node",
};
