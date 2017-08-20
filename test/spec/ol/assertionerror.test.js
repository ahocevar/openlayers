

import _ol_ from '../../../src/ol';
import _ol_AssertionError_ from '../../../src/ol/assertionerror';

describe('ol.AssertionError', function() {
  it('generates a message', function() {
    var error = new _ol_AssertionError_(42);
    expect(error.message).to.be('Assertion failed. See https://openlayers.org/en/latest/doc/errors/#42 for details.');
  });

  it('generates a message with a versioned url', function() {
    var error = new _ol_AssertionError_(42);
    var path = _ol_.VERSION ? _ol_.VERSION.split('-')[0] : 'latest';
    expect(error.message).to.be('Assertion failed. See https://openlayers.org/en/' + path + '/doc/errors/#42 for details.');
  });

  it('has an error code', function() {
    var error = new _ol_AssertionError_(42);
    expect(error.code).to.be(42);
  });

  it('has a name', function() {
    var error = new _ol_AssertionError_(42);
    expect(error.name).to.be('AssertionError');
  });
});
