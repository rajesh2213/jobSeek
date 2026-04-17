const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: {
    background: "./src/background.ts",
    content: "./src/content.ts",
    popup: "./src/popup/popup.tsx",
  },
  // MV3 extension pages block eval(); avoid webpack's eval-based default devtool.
  devtool: "cheap-module-source-map",
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
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "manifest.json", to: "." },
        { from: "src/popup/popup.html", to: "popup.html" },
        { from: "icons", to: "icons", noErrorOnMissing: true },
      ],
    }),
  ],
};
