module.exports = function (api) {
  api.cache(true);
  const expoPreset = require.resolve("expo/node_modules/babel-preset-expo");

  return {
    presets: [[expoPreset, { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
