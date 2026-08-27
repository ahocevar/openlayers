import {assert} from 'chai';
import Map from '../../../../../../src/ol/Map.js';
import View from '../../../../../../src/ol/View.js';
import ViewHint from '../../../../../../src/ol/ViewHint.js';
import {createCanvasContext2D} from '../../../../../../src/ol/dom.js';
import TileLayer from '../../../../../../src/ol/layer/Tile.js';
import WebGLTileLayer from '../../../../../../src/ol/layer/WebGLTile.js';
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

  describe('data tiles', function () {
    let map, layer;

    /**
     * @param {Object} options Options.
     * @param {number} [options.bandCount] Bands per pixel, for array data.
     * @param {Array<number>} [options.pixel] The band values every pixel gets.
     * @param {boolean} [options.image] Load image data instead of array data.
     * @param {Object} [options.style] The raster style.
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
     * @return {Promise<void>} Resolves once rendering is done.  The renderer holds
     * `ready` until the style has been applied, so this waits for the worker too.
     */
    function rendered() {
      return new Promise((resolve) =>
        map.once('rendercomplete', () => resolve()),
      );
    }

    /**
     * @return {Object} The renderer, the tile it cached last, and its styled tile.
     */
    function lastTile() {
      const renderer = layer.getRenderer();
      const tile = renderer.tileCache_.peekLast();
      return {
        renderer: renderer,
        tile: tile,
        styledTile: renderer.styledTileCache_.peek(getUid(tile)),
      };
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

    it('keeps drawing the previous style while a new one is applied', async () => {
      createMap({
        pixel: [255],
        style: {
          variables: {red: 1},
          color: ['array', ['var', 'red'], 0, 0, 1],
        },
      });
      await rendered();

      const {renderer, tile, styledTile} = lastTile();
      const image = styledTile.getImage();

      layer.updateStyleVariables({red: 100 / 255});
      map.renderSync();

      assert.strictEqual(lastTile().styledTile, styledTile);
      assert.isFalse(styledTile.isReady());
      assert.isTrue(styledTile.isDrawable());
      assert.strictEqual(styledTile.getImage(), image);
      assert.isTrue(renderer.isDrawable(tile));
    });

    it('discards the styled tile when its cache drops it', async () => {
      createMap({style: {color: ['array', ['band', 1], 0, 0, 1]}});
      await rendered();

      const {renderer, styledTile} = lastTile();
      assert.isDefined(styledTile);

      renderer.styledTileCache_.clear();
      assert.isUndefined(lastTile().styledTile);
      assert.isNull(styledTile.getImage());
    });

    it('keeps the resolution a tile was styled at while the view is moving', async () => {
      createMap({
        pixel: [0],
        style: {color: ['array', ['*', ['resolution'], 0], 0, 0, 1]},
      });
      // between two levels, so the view resolution is not the tile's own
      map.getView().setZoom(0.5);
      await rendered();

      const {styledTile} = lastTile();
      const resolution = styledTile.resolution;
      assert.strictEqual(resolution, map.getView().getResolution());

      // zooming must not restyle what is on screen at the tile's own grid resolution
      map.getView().setHint(ViewHint.INTERACTING, 1);
      map.getView().setZoom(0.75);
      map.renderSync();

      assert.strictEqual(styledTile.resolution, resolution);
      assert.isTrue(styledTile.isReady());
    });
  });

  describe('WebGL parity', function () {
    const size = 256;

    /**
     * @param {number} bandCount Bands per pixel.
     * @return {DataTileSource} A source with a gradient in every band.
     */
    function createSource(bandCount) {
      return new DataTileSource({
        bandCount: bandCount,
        tileSize: size,
        maxZoom: 0,
        transition: 0,
        interpolate: false,
        loader: function () {
          const data = new Uint8Array(size * size * bandCount);
          for (let row = 0; row < size; ++row) {
            for (let col = 0; col < size; ++col) {
              const offset = (row * size + col) * bandCount;
              for (let band = 0; band < bandCount; ++band) {
                data[offset + band] = (col + row * band) % 256;
              }
            }
          }
          return data;
        },
      });
    }

    /**
     * @param {typeof TileLayer|typeof WebGLTileLayer} LayerClass The layer class.
     * @param {number} bandCount Bands per pixel.
     * @param {Object} [style] The raster style.
     * @return {Promise<Array<number>>} The rendered pixels.
     */
    async function renderWith(LayerClass, bandCount, style) {
      const map = new Map({
        pixelRatio: 1,
        target: createMapDiv(size, size),
        layers: [
          new LayerClass({style: style, source: createSource(bandCount)}),
        ],
        view: new View({center: [0, 0], zoom: 0}),
      });
      await new Promise((resolve) => map.once('rendercomplete', resolve));
      const context = createCanvasContext2D(size, size);
      context.drawImage(map.getViewport().querySelector('canvas'), 0, 0);
      const pixels = Array.from(context.getImageData(0, 0, size, size).data);
      disposeMap(map);
      return pixels;
    }

    it('expands bands to rgba the way the WebGL renderer does', async () => {
      for (const bandCount of [1, 2, 3, 4]) {
        const pixels = await renderWith(TileLayer, bandCount);
        // a blank canvas on both sides would make the comparison meaningless
        assert.notDeepEqual(pixels.slice(0, 4), pixels.slice(-4));
        assert.deepEqual(
          pixels,
          await renderWith(WebGLTileLayer, bandCount),
          `${bandCount} band(s)`,
        );
      }
    });

    it('applies a style the way the WebGL renderer does', async () => {
      const style = {
        color: [
          'interpolate',
          ['linear'],
          ['band', 1],
          0,
          [255, 0, 0, 1],
          1,
          [0, 0, 255, 1],
        ],
        gamma: 1.5,
      };
      const pixels = await renderWith(TileLayer, 1, style);
      assert.notDeepEqual(pixels.slice(0, 4), pixels.slice(-4));
      assert.deepEqual(pixels, await renderWith(WebGLTileLayer, 1, style));
    });
  });
});
