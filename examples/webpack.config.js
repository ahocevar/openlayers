const CopyPlugin = require('copy-webpack-plugin');
const HtmlPlugin = require('html-webpack-plugin');
const path = require('path');
const fs = require('fs');

const examples = fs.readdirSync(__dirname)
    .filter(name => /^[^A-Z]*\.js$/.test(name)) // only lowercase js files
    .map(name => name.replace(/\.js$/, ''));

const build = path.resolve(__dirname, 'build');

const plugins = [];

// create a bundle and html file per example
const entry = {};
examples.forEach(example => {
  entry[example] = `./${example}.js`;
  plugins.push(
      new HtmlPlugin({
        chunks: [example],
        template: `${example}.html`,
        filename: `${example}.html`
      })
  );
});

plugins.push(
    new CopyPlugin([
      {from: '../css', to: 'css'},
      {from: './resources', to: 'resources'},
      {from: './data', to: 'data'}
    ])
);

module.exports = {
  context: __dirname,
  target: 'web',
  entry: entry,
  devtool: 'source-map',
  devServer: {
    filename: /\.html/,
    contentBase: build
  },

  module: {
    loaders: [
      {
        test: /\.(jpe?g|png|gif|svg)$/i,
        loader: 'file-loader'
      }, {
        test: /\.html$/,
        loader: 'html-loader'
      }, {
        test: /\.html$/,
        loader: path.resolve(__dirname, '..', 'config', 'examples', 'loaders', 'frontmatter-loader')
      }
    ]
  },
  plugins: plugins,
  output: {
    filename: '[name].js',
    path: build
  }
};
