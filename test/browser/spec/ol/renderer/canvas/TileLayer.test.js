import {assert} from 'chai';
import Map from '../../../../../../src/ol/Map.js';
import View from '../../../../../../src/ol/View.js';
import ViewHint from '../../../../../../src/ol/ViewHint.js';
import TileLayer from '../../../../../../src/ol/layer/Tile.js';
import {fromLonLat} from '../../../../../../src/ol/proj.js';
import {
  dropLayerHandlers,
  ensureHandler,
  getStyleProcessor,
} from '../../../../../../src/ol/raster/processor.js';
import ReprojTile from '../../../../../../src/ol/reproj/Tile.js';
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

  describe('data tiles', function () {
    let map, layer;

    /**
     * @param {Object} options Options.
     * @param {number} [options.bandCount] Bands per pixel, for array data.
     * @param {Array<number>} [options.pixel] The band values every pixel gets.
     * @param {boolean} [options.image] Load image data instead of array data.
     * @param {Object} [options.style] The raster style.
     * @param {string} [options.projection] The source projection, to render reprojected.
     */
    function createMap(options) {
      const bandCount = options.bandCount || 1;
      const pixel = options.pixel || [200];
      layer = new TileLayer({
        style: options.style,
        source: new DataTileSource({
          bandCount: bandCount,
          maxZoom: 0,
          transition: 0,
          projection: options.projection,
          loader: function () {
            if (options.image) {
              const rgba = new Uint8ClampedArray(256 * 256 * 4);
              for (let i = 0; i < 256 * 256; ++i) {
                rgba.set(pixel, i * 4);
              }
              return createImageBitmap(new ImageData(rgba, 256, 256));
            }
            const data = new Uint8Array(256 * 256 * bandCount);
            for (let i = 0, ii = 256 * 256; i < ii; ++i) {
              data.set(pixel, i * bandCount);
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
     * @return {Promise<Uint8ClampedArray>} The center pixel once rendering is done.
     */
    function rendered() {
      // The renderer holds `ready` until the style has been applied, so
      // rendercomplete already waits for the worker.
      return new Promise((resolve) => {
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

    it('reports band values from getData()', async () => {
      createMap({bandCount: 3, pixel: [10, 20, 30]});
      await rendered();
      const data = layer.getData([50, 50]);
      assert.instanceOf(data, Uint8Array);
      assert.deepEqual(Array.from(data), [10, 20, 30]);
    });

    it('reports band values from getData(), not styled ones', async () => {
      createMap({style: {color: ['array', ['band', 1], 0, 0, 1]}});
      await rendered();
      assert.deepEqual(Array.from(layer.getData([50, 50])), [200]);
    });

    it('reports the rgba of image data from getData()', async () => {
      createMap({
        image: true,
        pixel: [10, 20, 30, 255],
        style: {color: ['array', ['band', 3], ['band', 2], ['band', 1], 1]},
      });
      await rendered();
      assert.deepEqual(Array.from(layer.getData([50, 50])), [10, 20, 30, 255]);
    });

    it('re-renders with new style variables', async () => {
      createMap({
        pixel: [255],
        style: {
          variables: {red: 1},
          color: ['array', ['var', 'red'], 0, 0, 1],
        },
      });
      let data = await rendered();
      assert.deepEqual(Array.from(data), [255, 0, 0, 255]);

      layer.updateStyleVariables({red: 100 / 255});
      data = await rendered();
      assert.deepEqual(Array.from(data), [100, 0, 0, 255]);
    });

    it('renders a variable used as a color', async () => {
      createMap({
        pixel: [255],
        style: {
          variables: {tint: 'red'},
          color: ['var', 'tint'],
        },
      });
      let data = await rendered();
      assert.deepEqual(Array.from(data), [255, 0, 0, 255]);

      layer.updateStyleVariables({tint: [0, 128, 0, 1]});
      data = await rendered();
      assert.deepEqual(Array.from(data), [0, 128, 0, 255]);
    });

    it('keeps drawing the previous style while a new one is applied', async () => {
      createMap({
        pixel: [255],
        style: {
          variables: {red: 1},
          color: ['array', ['var', 'red'], 0, 0, 1],
        },
      });
      await rendered();

      const renderer = layer.getRenderer();
      const tile = renderer.tileCache_.peekLast();
      const styledTile = renderer.styledTileCache_.peek(getUid(tile));
      const image = styledTile.getImage();

      layer.updateStyleVariables({red: 100 / 255});
      map.renderSync();

      assert.strictEqual(
        renderer.styledTileCache_.peek(getUid(tile)),
        styledTile,
      );
      assert.isFalse(styledTile.isReady());
      assert.isTrue(styledTile.isDrawable());
      assert.strictEqual(styledTile.getImage(), image);
      assert.isTrue(renderer.isDrawable(tile));
    });

    it('discards the styled tile when its cache drops it', async () => {
      createMap({style: {color: ['array', ['band', 1], 0, 0, 1]}});
      await rendered();

      const renderer = layer.getRenderer();
      const tile = renderer.tileCache_.peekLast();
      const styledTile = renderer.styledTileCache_.peek(getUid(tile));
      assert.isDefined(styledTile);

      renderer.styledTileCache_.clear();
      assert.isUndefined(renderer.styledTileCache_.peek(getUid(tile)));
      assert.isNull(styledTile.getImage());
    });

    it('drops the compiled handlers when it is disposed', async () => {
      const style = {color: ['array', ['band', 1], 0, 0, 1]};
      createMap({style: style});
      await rendered();

      const styleId = `${getUid(layer)}/${layer.getStyleRevision()}`;
      const pool = getStyleProcessor();
      // the tile that just rendered registered this handler, so nothing is rebuilt
      ensureHandler(styleId, style, 1, undefined);
      assert.strictEqual(getStyleProcessor(), pool);

      disposeMap(map);
      map = null;
      layer.dispose();
      // the handler went with the layer, so the same style has to be compiled again
      ensureHandler(styleId, style, 1, undefined);
      assert.notStrictEqual(getStyleProcessor(), pool);
      dropLayerHandlers(getUid(layer));
    });

    it('applies a style that reads the resolution', async () => {
      createMap({
        pixel: [0],
        // red only where the resolution is a real, positive number.  Without one it is NaN,
        // every comparison is false, and the tile comes out black.
        style: {
          color: ['array', ['case', ['>', ['resolution'], 0], 1, 0], 0, 0, 1],
        },
      });
      const data = await rendered();
      assert.deepEqual(Array.from(data), [255, 0, 0, 255]);
    });

    it('keeps the resolution a tile was styled at while the view is moving', async () => {
      createMap({
        pixel: [0],
        style: {color: ['array', ['*', ['resolution'], 0], 0, 0, 1]},
      });
      // between two levels, so the view resolution is not the tile's own
      map.getView().setZoom(0.5);
      await rendered();

      const renderer = layer.getRenderer();
      const tile = renderer.tileCache_.peekLast();
      const styledTile = renderer.styledTileCache_.peek(getUid(tile));
      const resolution = styledTile.resolution;
      assert.strictEqual(resolution, map.getView().getResolution());

      // zooming must not restyle what is on screen at the tile's own grid resolution
      map.getView().setHint(ViewHint.INTERACTING, 1);
      map.getView().setZoom(0.75);
      map.renderSync();

      assert.strictEqual(styledTile.resolution, resolution);
      assert.isTrue(styledTile.isReady());
    });

    it('records the resolution only for a style that reads it', async () => {
      createMap({
        pixel: [255],
        style: {color: ['array', ['band', 1], 0, 0, 1]},
      });
      await rendered();
      assert.isFalse(layer.getStyleUsesResolution());

      layer.setStyle({color: ['array', ['*', ['resolution'], 0], 0, 0, 1]});
      await rendered();
      assert.isTrue(layer.getStyleUsesResolution());
    });

    it('throws when a variable is still missing where the style is applied', function () {
      // the values may arrive after the style is set, as they do for a WebGL tile layer,
      // so this is only an error once there are pixels to make
      const layer = new TileLayer({style: {color: ['var', 'missing']}});
      assert.throws(
        () => layer.getRenderVariables(),
        /Missing 'missing' in style variables/,
      );
      layer.updateStyleVariables({missing: '#ff8000'});
      assert.deepEqual(layer.getRenderVariables().missing, [255, 128, 0, 1]);
    });

    it('reads the variables a style was given as they are when a tile is styled', async () => {
      // the shaded relief example fills its variables in after the layer is built, and
      // keeps mutating the same object
      const variables = {};
      createMap({
        pixel: [255],
        style: {
          variables: variables,
          color: ['array', ['var', 'red'], 0, 0, 1],
        },
      });
      variables.red = 1;
      let data = await rendered();
      assert.deepEqual(Array.from(data), [255, 0, 0, 255]);

      variables.red = 100 / 255;
      layer.updateStyleVariables(variables);
      data = await rendered();
      assert.deepEqual(Array.from(data), [100, 0, 0, 255]);
    });

    describe('reprojected', function () {
      it('warps images made from the source projection tiles', async () => {
        createMap({
          projection: 'EPSG:4326',
          style: {color: ['array', ['band', 1], 0, 0, 1]},
        });
        await rendered();

        const renderer = layer.getRenderer();
        assert.instanceOf(renderer.tileCache_.peekLast(), ReprojTile);
        const sourceTile = renderer.sourceTileCache_.peekLast();
        assert.isDefined(renderer.styledTileCache_.peek(getUid(sourceTile)));
      });

      it('appends no coverage band, so getData() reports the source bands', async () => {
        createMap({
          bandCount: 3,
          pixel: [10, 20, 30],
          projection: 'EPSG:4326',
        });
        await rendered();
        assert.instanceOf(
          layer.getRenderer().tileCache_.peekLast(),
          ReprojTile,
        );
        assert.deepEqual(Array.from(layer.getData([50, 50])), [10, 20, 30]);
      });

      it('reports band values from getData(), not styled ones', async () => {
        createMap({
          projection: 'EPSG:4326',
          style: {color: ['array', ['band', 1], 0, 0, 1]},
        });
        await rendered();
        assert.deepEqual(Array.from(layer.getData([50, 50])), [200]);
      });

      it('keeps drawing the previous style while warping again', async () => {
        createMap({
          pixel: [255],
          projection: 'EPSG:4326',
          style: {
            variables: {red: 1},
            color: ['array', ['var', 'red'], 0, 0, 1],
          },
        });
        await rendered();

        const renderer = layer.getRenderer();
        const tile = renderer.tileCache_.peekLast();
        const image = tile.getImage();

        layer.updateStyleVariables({red: 100 / 255});
        map.renderSync();

        assert.strictEqual(renderer.tileCache_.peekLast(), tile);
        assert.isTrue(tile.refreshing);
        assert.strictEqual(tile.getImage(), image);
        assert.isTrue(renderer.isDrawable(tile));

        const data = await rendered();
        assert.deepEqual(Array.from(data), [100, 0, 0, 255]);
      });
    });
  });
});
