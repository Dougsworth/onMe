module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Strip every console.* call from production bundles. Dev builds keep
    // them. EAS production / preview builds set NODE_ENV=production.
    env: {
      production: {
        plugins: [["transform-remove-console", { exclude: ["error", "warn"] }]],
      },
    },
  };
};
