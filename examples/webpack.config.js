const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlPlugin = require('html-webpack-plugin');
const path = require('path');
const fs = require('fs');

const examples = fs.readdirSync(__dirname)
    .filter(name => /^(?!index).*\.html$/.test(name)) // exclude index.html
    .map(name => name.replace(/\.html$/, ''));

const build = path.resolve(__dirname, 'build');

const configs = [];

// create a bundle and html file per example
examples.forEach(example => {
  configs.push({
    context: __dirname,
    target: 'web',
    devtool: 'source-map',
    entry: `./${example}.js`,
    plugins: [
      new HtmlPlugin({
        template: `${example}.html`,
        filename: `${example}.html`
      })
    ],
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
    output: {
      filename: `${example}.js`,
      path: build
    }
  });
});

configs[0].plugins.push(
    new CopyPlugin([
      {from: '../css', to: 'css'},
      {from: './resources', to: 'resources'},
      {from: './data', to: 'data'}
    ])
);

module.exports = configs;
