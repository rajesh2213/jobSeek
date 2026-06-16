const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");

const analyze = process.env.ANALYZE === "1";

module.exports = (env, argv) => {
  const isProd = argv.mode === "production";
  /** Dev builds default to local Fastify; prod builds default to hosted API unless overridden. */
  const extApiBase =
    process.env.EXTENSION_API_BASE ||
    (isProd ? "https://api.jobloom.tech" : "http://localhost:3000");

  const trustedWebOrigins = isProd
    ? ["https://jobloom.tech", "https://www.jobloom.tech"]
    : [
        "https://jobloom.tech",
        "https://www.jobloom.tech",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
      ];

  return {
    entry: {
      "background-main": "./src/background.ts",
      content: "./src/content.ts",
      presenceBeacon: "./src/presenceBeacon.ts",
      popup: "./src/popup/popup.tsx",
    },
    /** Keep production bundles reviewer-readable for Chrome Web Store policy checks. */
    devtool: isProd ? "source-map" : "cheap-module-source-map",
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: "ts-loader",
            options: { transpileOnly: true },
          },
          exclude: /node_modules/,
        },
      ],
    },
    resolve: { extensions: [".tsx", ".ts", ".js"] },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
      /** MV3 service workers: avoid webpack IIFE wrapper on the bootstrap + main bundle. */
      iife: false,
    },
    optimization: {
      /** Avoid minification/mangling to keep code readable for manual review. */
      minimize: false,
    },
    plugins: [
      new webpack.DefinePlugin({
        __EXTENSION_API_BASE__: JSON.stringify(String(extApiBase).replace(/\/+$/, "")),
        __EXT_PROD__: JSON.stringify(isProd ? "true" : "false"),
        /** Empty in production so store bundles contain no loopback URL literals (check-ext). */
        __LOCAL_API_FALLBACK__: JSON.stringify(isProd ? "" : "http://localhost:3000"),
        __TRUSTED_EXTENSION_WEB_ORIGINS__: JSON.stringify(trustedWebOrigins),
      }),
      ...(analyze
        ? [
            new (require("webpack-bundle-analyzer").BundleAnalyzerPlugin)({
              analyzerMode: "static",
              openAnalyzer: false,
              reportFilename: "bundle-report.html",
            }),
          ]
        : []),
      new CopyPlugin({
        patterns: [
          { from: "manifest.json", to: "." },
          { from: "src/background-entry.js", to: "background.js" },
          { from: "src/popup/popup.html", to: "popup.html" },
          { from: "icons", to: "assets", noErrorOnMissing: true },
        ],
      }),
    ],
  };
};
