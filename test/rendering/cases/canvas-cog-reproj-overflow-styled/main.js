import proj4 from 'proj4';
import Map from '../../../../src/ol/Map.js';
import View from '../../../../src/ol/View.js';
import TileLayer from '../../../../src/ol/layer/Tile.js';
import {transformExtent} from '../../../../src/ol/proj.js';
import {register} from '../../../../src/ol/proj/proj4.js';
import GeoTIFF from '../../../../src/ol/source/GeoTIFF.js';

proj4.defs(
  'EPSG:25832',
  '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
);
proj4.defs(
  'EPSG:25833',
  '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
);
register(proj4);

// The cog-reproj-overflow-styled case on the canvas renderer.  The style is applied to
// the source's own tiles and the styled images are reprojected afterwards, so the area
// outside the source footprint is simply where the warp drew nothing.  The colors differ
// slightly from the WebGL case, which reprojects the band data before styling it.
const source = new GeoTIFF({
  sources: [
    {
      url: '/data/raster/dop-rgb-tiled.tif',
    },
  ],
  transition: 0,
});

const map = new Map({
  layers: [
    new TileLayer({
      source: source,
      style: {
        color: ['array', ['band', 1], ['band', 2], ['band', 3], 1],
      },
    }),
  ],
  target: 'map',
  view: new View({
    projection: 'EPSG:25833',
  }),
});

source.getView().then((viewConfig) => {
  const view = map.getView();
  view.fit(
    transformExtent(
      viewConfig.extent,
      viewConfig.projection,
      view.getProjection(),
    ),
  );
});

render({
  message:
    'reprojected geotiff without alpha discards out-of-footprint pixels even with a color style',
});
