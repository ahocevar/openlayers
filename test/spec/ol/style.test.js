goog.provide('ol.test.style.Style');

describe('ol.style.Style', function() {

  describe('#setZIndex', function() {

    it('sets the zIndex', function() {
      var style = new ol.style.Style();

      style.setZIndex(0.7);
      expect(style.getZIndex()).to.be(0.7);
    });
  });

  describe('#setGeometry', function() {
    var style;
    beforeEach(function() {
      style = new ol.style.Style();
    });

    it('creates a geometry function from a string', function() {
      var feature = new ol.Feature();
      feature.set('myGeom', new ol.geom.Point([0, 0]));
      style.setGeometry('myGeom');
      expect(style.getGeometry(feature)).to.eql(feature.get('myGeom'));
    });

    it('creates a geometry function from a geometry', function() {
      var geom = new ol.geom.Point([0, 0]);
      style.setGeometry(geom);
      expect(style.getGeometry()).to.eql(geom);
    });

    it('returns the configured geometry function', function() {
      var geom = new ol.geom.Point([0, 0]);
      style.setGeometry(function() {
        return geom;
      });
      expect(style.getGeometry()).to.eql(geom);
    });
  });

  describe('#getGeometry', function() {

    it('calls feature.getGeometry() by default', function() {
      var feature = new ol.Feature();
      sinon.spy(feature, 'getGeometry');

      var style = new ol.style.Style();
      var got = style.getGeometry(feature);

      expect(got).to.be(undefined);
      expect(feature.getGeometry.calledOnce).to.be(true);
    });

    it('returns a geometry instance set on style', function() {
      var point = new ol.geom.Point([0, 0]);
      var feature = new ol.Feature();

      var style = new ol.style.Style({
        geometry: point
      });
      var got = style.getGeometry(feature);

      expect(got).to.be(point);
    });

    it('can return an alternate geometry property', function() {
      var defaultGeom = new ol.geom.Point([0, 0]);
      var altGeom = new ol.geom.Point([1, 1]);

      var feature = new ol.Feature(defaultGeom);
      feature.set('alt', altGeom);

      var style = new ol.style.Style({
        geometry: 'alt'
      });
      var got = style.getGeometry(feature);

      expect(got).to.be(altGeom);
    });

    it('calls a user provided geometry getter', function() {
      var point = new ol.geom.Point([0, 0]);
      var feature = new ol.Feature();

      var getter = sinon.spy(function(feature) {
        return point;
      });

      var style = new ol.style.Style({
        geometry: getter
      });
      var got = style.getGeometry(feature);

      expect(got).to.be(point);
      expect(getter.calledOnce).to.be(true);
      expect(getter.calledOn(style)).to.be(true);
    });

  });

});

describe('ol.style.createStyleFunction()', function() {
  var style = new ol.style.Style();

  it('creates a style function from a single style', function() {
    var styleFunction = ol.style.createStyleFunction(style);
    expect(styleFunction()).to.eql([style]);
  });

  it('creates a style function from an array of styles', function() {
    var styleFunction = ol.style.createStyleFunction([style]);
    expect(styleFunction()).to.eql([style]);
  });

  it('passes through a function', function() {
    var original = function() {
      return [style];
    };
    var styleFunction = ol.style.createStyleFunction(original);
    expect(styleFunction).to.be(original);
  });

  it('throws on (some) unexpected input', function() {
    expect(function() {
      ol.style.createStyleFunction({bogus: 'input'});
    }).to.throwException();
  });

});

goog.require('ol.Feature');
goog.require('ol.geom.Point');
goog.require('ol.style.Style');
