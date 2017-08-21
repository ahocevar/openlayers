const fm = require('front-matter');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const marked = require('marked');

Handlebars.registerHelper('md', function(str) {
  return new Handlebars.SafeString(marked(str));
});
Handlebars.registerHelper('indent', function(text, options) {
  if (!text) {
    return text;
  }
  var count = options.hash.spaces || 2;
  var spaces = new Array(count + 1).join(' ');
  return text.split('\n').map(function(line) {
    return line ? spaces + line : '';
  }).join('\n');
});

module.exports = function(doc) {
  const frontMatter = fm(doc);
  const data = frontMatter.attributes;
  const source = fs.readFileSync(path.resolve(__dirname, '..', data.layout), 'utf8');
  data.contents = frontMatter.body;
  const template = Handlebars.compile(source);
  return template(data);
};
