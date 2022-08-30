import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import {terser} from 'rollup-plugin-terser';

export default {
  input: 'build/index.js',
  plugins: [
    resolve({
      moduleDirectories: ['build', 'node_modules'],
    }),
    commonjs(),
    babel({
      babelHelpers: 'bundled',
      presets: [
        [
          '@babel/preset-env',
          {
            'modules': false,
            'targets': '> 1%, last 2 versions, not dead',
          },
        ],
      ],
    }),
    terser(),
  ],
  output: {
    file: 'build/full/ol.js',
    name: 'ol',
    format: 'umd',
    globals: {
      geotiff: 'geotiff',
      'ol-mapbox-style': 'olms',
    },
    sourcemap: true,
  },
  external: ['geotiff', 'ol-mapbox-style'],
};
