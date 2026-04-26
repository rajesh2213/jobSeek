const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");
const TerserPlugin = require("terser-webpack-plugin");

const analyze = process.env.ANALYZE === "1";
const extApiBase = process.env.EXTENSION_API_BASE || "https://jobseek-server.up.railway.app";

module.exports = (env, argv) => {
  const isProd = argv.mode === "production";

  return {
    entry: {
      background: "./src/background.ts",
      content: "./src/content.ts",
      popup: "./src/popup/popup.tsx",
    },
    devtool: isProd ? false : "cheap-module-source-map",
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
    },
    optimization: isProd
      ? {
          minimize: true,
          minimizer: [
            new TerserPlugin({
              terserOptions: {
                compress: { drop_console: true, drop_debugger: true },
                format: { comments: false },
              },
              extractComments: false,
            }),
          ],
        }
      : { minimize: false },
    plugins: [
      new webpack.DefinePlugin({
        __EXTENSION_API_BASE__: JSON.stringify(String(extApiBase).replace(/\/+$/, "")),
        __EXT_PROD__: JSON.stringify(isProd ? "true" : "false"),
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
          { from: "src/popup/popup.html", to: "popup.html" },
          { from: "icons", to: "assets", noErrorOnMissing: true },
        ],
      }),
    ],
  };
};
