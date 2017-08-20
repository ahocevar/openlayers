

import _ol_Feature_ from '../../../../src/ol/feature';
import _ol_ext_PBF_ from 'pbf';
import {VectorTile as _ol_ext_vectortile_VectorTile_} from '@mapbox/vector-tile';
import _ol_extent_ from '../../../../src/ol/extent';
import _ol_format_MVT_ from '../../../../src/ol/format/mvt';
import _ol_geom_Point_ from '../../../../src/ol/geom/point';
import _ol_render_Feature_ from '../../../../src/ol/render/feature';

where('ArrayBuffer.isView').describe('ol.format.MVT', function() {

  var data;
  beforeEach(function(done) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'spec/ol/data/14-8938-5680.vector.pbf');
    xhr.responseType = 'arraybuffer';
    xhr.onload = function() {
      data = xhr.response;
      done();
    };
    xhr.send();
  });

  describe('#readFeatures', function() {

    it('uses ol.render.Feature as feature class by default', function() {
      var format = new _ol_format_MVT_({layers: ['water']});
      var features = format.readFeatures(data);
      expect(features[0]).to.be.a(_ol_render_Feature_);
    });

    it('parses only specified layers', function() {
      var format = new _ol_format_MVT_({layers: ['water']});
      var features = format.readFeatures(data);
      expect(features.length).to.be(10);
    });

    it('parses geometries correctly', function() {
      var format = new _ol_format_MVT_({
        featureClass: _ol_Feature_,
        layers: ['poi_label']
      });
      var pbf = new _ol_ext_PBF_(data);
      var tile = new _ol_ext_vectortile_VectorTile_(pbf);
      var geometry, rawGeometry;

      rawGeometry = tile.layers['poi_label'].feature(0).loadGeometry();
      geometry = format.readFeatures(data)[0]
          .getGeometry();
      expect(geometry.getType()).to.be('Point');
      expect(geometry.getCoordinates())
          .to.eql([rawGeometry[0][0].x, rawGeometry[0][0].y]);

      rawGeometry = tile.layers['water'].feature(0).loadGeometry();
      format.setLayers(['water']);
      geometry = format.readFeatures(data)[0]
          .getGeometry();
      expect(geometry.getType()).to.be('Polygon');
      expect(rawGeometry[0].length)
          .to.equal(geometry.getCoordinates()[0].length);
      expect(geometry.getCoordinates()[0][0])
          .to.eql([rawGeometry[0][0].x, rawGeometry[0][0].y]);

      rawGeometry = tile.layers['barrier_line'].feature(0).loadGeometry();
      format.setLayers(['barrier_line']);
      geometry = format.readFeatures(data)[0]
          .getGeometry();
      expect(geometry.getType()).to.be('MultiLineString');
      expect(rawGeometry[1].length)
          .to.equal(geometry.getCoordinates()[1].length);
      expect(geometry.getCoordinates()[1][0])
          .to.eql([rawGeometry[1][0].x, rawGeometry[1][0].y]);
    });

    it('parses id property', function() {
      // ol.Feature
      var format = new _ol_format_MVT_({
        featureClass: _ol_Feature_,
        layers: ['building']
      });
      var features = format.readFeatures(data);
      expect(features[0].getId()).to.be(2);
      // ol.render.Feature
      format = new _ol_format_MVT_({
        layers: ['building']
      });
      features = format.readFeatures(data);
      expect(features[0].getId()).to.be(2);
    });

    it('sets the extent of the last readFeatures call', function() {
      var format = new _ol_format_MVT_();
      format.readFeatures(data);
      var extent = format.getLastExtent();
      expect(_ol_extent_.getWidth(extent)).to.be(4096);
    });

  });

});

describe('ol.format.MVT', function() {

  describe('#readFeature_', function() {
    it('accepts a geometryName', function() {
      var format = new _ol_format_MVT_({
        featureClass: _ol_Feature_,
        geometryName: 'myGeom'
      });
      var rawFeature = {
        id: 1,
        properties: {
          geometry: 'foo'
        },
        type: 1,
        loadGeometry: function() {
          return [[0, 0]];
        }
      };
      var feature = format.readFeature_(rawFeature, 'mapbox');
      var geometry = feature.getGeometry();
      expect(geometry).to.be.a(_ol_geom_Point_);
      expect(feature.get('myGeom')).to.equal(geometry);
      expect(feature.get('geometry')).to.be('foo');
    });
  });

});
