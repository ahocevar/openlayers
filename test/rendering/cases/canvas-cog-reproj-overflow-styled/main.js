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

// The cog-reproj-overflow-styled case on the canvas renderer, against the same expected
// image.  Reprojection appends a coverage band to a source without alpha, so the style
// has to be applied to the reprojected band layout rather than the source's.  Without
// that, the gaps the rotated reprojection leaves would come out black instead of
// transparent, because the color style forces the output alpha to 1.
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
