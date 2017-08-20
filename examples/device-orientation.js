import _ol_DeviceOrientation_ from '../src/ol/deviceorientation';
import _ol_Map_ from '../src/ol/map';
import _ol_View_ from '../src/ol/view';
import _ol_control_ from '../src/ol/control';
import _ol_layer_Tile_ from '../src/ol/layer/tile';
import _ol_proj_ from '../src/ol/proj';
import _ol_source_OSM_ from '../src/ol/source/osm';

var projection = _ol_proj_.get('EPSG:3857');
var view = new _ol_View_({
  center: [0, 0],
  projection: projection,
  extent: projection.getExtent(),
  zoom: 2
});
var map = new _ol_Map_({
  layers: [
    new _ol_layer_Tile_({
      source: new _ol_source_OSM_()
    })
  ],
  target: 'map',
  controls: _ol_control_.defaults({
    attributionOptions: /** @type {olx.control.AttributionOptions} */ ({
      collapsible: false
    })
  }),
  view: view
});

var deviceOrientation = new _ol_DeviceOrientation_();

function el(id) {
  return document.getElementById(id);
}

el('track').addEventListener('change', function() {
  deviceOrientation.setTracking(this.checked);
});

deviceOrientation.on('change', function() {
  el('alpha').innerText = deviceOrientation.getAlpha() + ' [rad]';
  el('beta').innerText = deviceOrientation.getBeta() + ' [rad]';
  el('gamma').innerText = deviceOrientation.getGamma() + ' [rad]';
  el('heading').innerText = deviceOrientation.getHeading() + ' [rad]';
});

// tilt the map
deviceOrientation.on(['change:beta', 'change:gamma'], function(event) {
  var center = view.getCenter();
  var resolution = view.getResolution();
  var beta = event.target.getBeta() || 0;
  var gamma = event.target.getGamma() || 0;

  center[0] -= resolution * gamma * 25;
  center[1] += resolution * beta * 25;

  view.setCenter(view.constrainCenter(center));
});
