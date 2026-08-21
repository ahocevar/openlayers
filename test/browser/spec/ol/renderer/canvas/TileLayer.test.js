import {assert} from 'chai';
import Map from '../../../../../../src/ol/Map.js';
import View from '../../../../../../src/ol/View.js';
import TileLayer from '../../../../../../src/ol/layer/Tile.js';
import {fromLonLat} from '../../../../../../src/ol/proj.js';
import DataTileSource from '../../../../../../src/ol/source/DataTile.js';
import ImageTile from '../../../../../../src/ol/source/ImageTile.js';
import TileDebug from '../../../../../../src/ol/source/TileDebug.js';
import XYZ from '../../../../../../src/ol/source/XYZ.js';
import {getUid} from '../../../../../../src/ol/util.js';

describe('ol/renderer/canvas/TileLayer', function () {
  describe('#renderFrame', function () {
    let map, layer;
    beforeEach(function () {
      layer = new TileLayer({
        source: new XYZ({
          cacheSize: 1,
          url: 'bogus-url/{z}/{x}/{y}.png',
        }),
      });
      map = new Map({
        target: createMapDiv(100, 100),
        layers: [layer],
        view: new View({
          center: fromLonLat([-122.416667, 37.783333]),
          zoom: 5,
        }),
      });
    });
    afterEach(function () {
      disposeMap(map);
    });

    it("respects the source's zDirection setting", () =>
      new Promise((resolve) => {
        layer.getSource().zDirection = 1;
        map.getView().setZoom(5.8); // would lead to z6 tile request with the default zDirection
        map.once('rendercomplete', function () {
          const tileCache = layer.getRenderer().tileCache_;
          const keys = tileCache.getKeys();
          assert.strictEqual(
            keys.some((key) => key.startsWith('6/')),
            false,
          );
          resolve();
        });
      }));

    it('image smoothing is re-enabled after rendering', () =>
      new Promise((resolve) => {
        let context;
        layer.on('postrender', function (e) {
          context = e.context;
          context.imageSmoothingEnabled = false;
        });
        map.on('postrender', function () {
          assert.strictEqual(context.imageSmoothingEnabled, true);
          resolve();
        });
      }));

    describe('caching', () => {
      it('updates the size of the tile cache ', () =>
        new Promise((resolve) => {
          const source = new TileDebug();
          const layer = new TileLayer({source: source});
          const spy = vi.spyOn(layer.getRenderer(), 'updateCacheSize');
          map.addLayer(layer);
          map.once('rendercomplete', () => {
            // rendercomplete triggers before the postrender functions with the cleanup are run,
            // so wait another cycle
            setTimeout(() => {
              assert.isAbove(spy.mock.calls.length, 0);
              resolve();
            }, 0);
          });
        }));
      it('expires the tile cache, which disposes unused tiles', async () => {
        const source = new TileDebug();
        const layer = new TileLayer({source: source, cacheSize: 0});
        const tiles = [];
        layer.getSource().on('tileloadend', (event) => {
          tiles.push(event.tile);
        });
        map.addLayer(layer);
        await new Promise((resolve) => map.once('rendercomplete', resolve));
        assert.strictEqual(layer.getRenderer().tileCache_.highWaterMark, 4);
        for (let i = 0; i < 4; ++i) {
          map.getView().setZoom(map.getView().getZoom() + 1);
          await new Promise((resolve) => map.once('rendercomplete', resolve));
        }
        assert.strictEqual(tiles.length, 12);
        for (let i = 0; i < 4; ++i) {
          assert.strictEqual(tiles[i].disposed, true);
        }
      });

      it('caches tiles and clears the cache when the source is refreshed', async () => {
        const source = new TileDebug();
        const layer = new TileLayer({source: source});
        const tiles = [];
        source.on('tileloadend', (event) => {
          tiles.push(event.tile);
        });
        map.addLayer(layer);
        await new Promise((resolve) => map.once('rendercomplete', resolve));
        assert.strictEqual(tiles.length, 2);
        map.render();
        await new Promise((resolve) => map.once('rendercomplete', resolve));
        assert.strictEqual(tiles.length, 2);
        source.refresh();
        await new Promise((resolve) => map.once('rendercomplete', resolve));
        assert.strictEqual(tiles.length, 4);
      });

      it('clears the cache when the layer has a new source with the same key', async () => {
        const tiles = [];
        let source = new TileDebug();
        source.on('tileloadend', (event) => {
          tiles.push(event.tile);
        });
        source.setKey('foo');
        const layer = new TileLayer({source: source});
        map.addLayer(layer);
        await new Promise((resolve) => map.once('rendercomplete', resolve));
        assert.strictEqual(tiles.length, 2);
        source.dispose();
        source = new TileDebug();
        source.on('tileloadend', (event) => {
          tiles.push(event.tile);
        });
        source.setKey('foo');
        layer.setSource(source);
        await new Promise((resolve) => map.once('rendercomplete', resolve));
        assert.strictEqual(tiles.length, 4);
      });

      it('does not mark alt/stale error tiles as newer', async () => {
        const source = new ImageTile({
          url: '#/{z}/{x}/{y}.png',
        });
        const layer = new TileLayer({source: source, cacheSize: 0});
        const tiles = [];
        layer.getSource().on('tileloadend', (event) => {
          tiles.push(event.tile);
        });
        map.addLayer(layer);
        await new Promise((resolve) => map.once('rendercomplete', resolve));
        assert.strictEqual(layer.getRenderer().tileCache_.highWaterMark, 4);
        for (let i = 0; i < 4; ++i) {
          map.getView().setZoom(map.getView().getZoom() + 1);
          await new Promise((resolve) => map.once('rendercomplete', resolve));
        }
        assert.strictEqual(
          layer.getRenderer().tileCache_.newest_.value_.tileCoord[0],
          9,
        );
      });

      it('caches source tiles when reprojecting', async () => {
        const source = new TileDebug();
        const layer = new TileLayer({
          source: source,
        });
        map.addLayer(layer);
        map.setView(
          new View({
            projection: 'EPSG:4326',
            center: [-122.416667, 37.783333],
            zoom: 5,
          }),
        );
        await new Promise((resolve) => map.once('rendercomplete', resolve));
        assert.isAbove(
          layer.getRenderer().sourceTileCache_.getKeys().length,
          0,
        );
      });

      it('does not cache source tiles when not reprojecting', async () => {
        const source = new TileDebug();
        const layer = new TileLayer({
          source: source,
        });
        map.addLayer(layer);
        await new Promise((resolve) => map.once('rendercomplete', resolve));
        assert.strictEqual(layer.getRenderer().sourceTileCache_, null);
      });
    });
  });

  describe('data tiles with array data', function () {
    let map, layer;

    /**
     * @param {number} bandCount Bands per pixel.
     * @param {Function} ArrayType The array constructor.
     * @param {Array<number>} pixel The band values every pixel gets.
     */
    function createMap(bandCount, ArrayType, pixel) {
      layer = new TileLayer({
        source: new DataTileSource({
          bandCount: bandCount,
          maxZoom: 0,
          transition: 0,
          loader: function () {
            const data = new ArrayType(256 * 256 * bandCount);
            for (let i = 0, ii = 256 * 256; i < ii; ++i) {
              for (let band = 0; band < bandCount; ++band) {
                data[i * bandCount + band] = pixel[band];
              }
            }
            return data;
          },
        }),
      });
      map = new Map({
        target: createMapDiv(100, 100),
        layers: [layer],
        view: new View({center: [0, 0], zoom: 0}),
      });
    }

    afterEach(function () {
      disposeMap(map);
    });

    it('renders three band data as opaque rgb', () =>
      new Promise((resolve) => {
        createMap(3, Uint8Array, [10, 20, 30]);
        map.once('rendercomplete', function () {
          const canvas = layer.getRenderer().getImage();
          const data = canvas.getContext('2d').getImageData(50, 50, 1, 1).data;
          assert.deepEqual(Array.from(data), [10, 20, 30, 255]);
          resolve();
        });
      }));

    it('renders one band data as luminance', () =>
      new Promise((resolve) => {
        createMap(1, Uint8Array, [42]);
        map.once('rendercomplete', function () {
          const canvas = layer.getRenderer().getImage();
          const data = canvas.getContext('2d').getImageData(50, 50, 1, 1).data;
          assert.deepEqual(Array.from(data), [42, 42, 42, 255]);
          resolve();
        });
      }));

    it('reports the tile band values from getData()', () =>
      new Promise((resolve) => {
        createMap(3, Uint8Array, [10, 20, 30]);
        map.once('rendercomplete', function () {
          const data = layer.getData([50, 50]);
          assert.instanceOf(data, Uint8Array);
          assert.deepEqual(Array.from(data), [10, 20, 30]);
          resolve();
        });
      }));
  });

  describe('data tiles with a raster style', function () {
    let map, layer;

    /**
     * @param {Object} style The raster style.
     * @param {number} bandCount Bands per pixel.
     * @param {Array<number>} pixel The band values every pixel gets.
     */
    function createMap(style, bandCount, pixel) {
      layer = new TileLayer({
        style: style,
        source: new DataTileSource({
          bandCount: bandCount,
          maxZoom: 0,
          transition: 0,
          loader: function () {
            const data = new Uint8Array(256 * 256 * bandCount);
            for (let i = 0, ii = 256 * 256; i < ii; ++i) {
              for (let band = 0; band < bandCount; ++band) {
                data[i * bandCount + band] = pixel[band];
              }
            }
            return data;
          },
        }),
      });
      map = new Map({
        target: createMapDiv(100, 100),
        layers: [layer],
        view: new View({center: [0, 0], zoom: 0}),
      });
    }

    /**
     * @return {Promise<Uint8ClampedArray>} The center pixel once the style has been applied.
     */
    function centerPixel() {
      return new Promise((resolve) => {
        // The renderer holds `ready` until the style has been applied, so
        // rendercomplete already waits for the worker.
        map.once('rendercomplete', () => {
          resolve(
            layer
              .getRenderer()
              .getImage()
              .getContext('2d')
              .getImageData(50, 50, 1, 1).data,
          );
        });
      });
    }

    afterEach(function () {
      disposeMap(map);
    });

    it('applies a color expression to band values', async () => {
      createMap({color: ['array', ['band', 1], 0, 0, 1]}, 1, [200]);
      const data = await centerPixel();
      assert.deepEqual(Array.from(data), [200, 0, 0, 255]);
    });

    it('applies a palette', async () => {
      createMap(
        {
          color: [
            'palette',
            ['*', ['band', 1], 2],
            [
              [255, 0, 0],
              [0, 0, 255],
            ],
          ],
        },
        1,
        [255],
      );
      const data = await centerPixel();
      assert.deepEqual(Array.from(data), [0, 0, 255, 255]);
    });

    it('re-renders with new style variables', async () => {
      createMap(
        {
          variables: {red: 1},
          color: ['array', ['var', 'red'], 0, 0, 1],
        },
        1,
        [255],
      );
      let data = await centerPixel();
      assert.deepEqual(Array.from(data), [255, 0, 0, 255]);

      layer.updateStyleVariables({red: 100 / 255});
      data = await centerPixel();
      assert.deepEqual(Array.from(data), [100, 0, 0, 255]);
    });

    it('discards the styled tile when the tile cache drops the tile', async () => {
      createMap({color: ['array', ['band', 1], 0, 0, 1]}, 1, [200]);
      await centerPixel();

      const renderer = layer.getRenderer();
      const tile = renderer.tileCache_.peekLast();
      const styledTile = renderer.styledTiles_[getUid(tile)];
      assert.isDefined(styledTile);

      renderer.tileCache_.clear();
      assert.isUndefined(renderer.styledTiles_[getUid(tile)]);
      assert.isNull(styledTile.image);
    });

    it('reports raw band values from getData(), not styled ones', async () => {
      createMap({color: ['array', ['band', 1], 0, 0, 1]}, 1, [200]);
      await centerPixel();
      assert.deepEqual(Array.from(layer.getData([50, 50])), [200]);
    });

    it('throws for a style with a missing variable', function () {
      assert.throws(
        () => new TileLayer({style: {color: ['var', 'missing']}}),
        /Missing 'missing' in style variables/,
      );
    });
  });
});
