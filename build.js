#!/usr/bin/env node

const esbuild = require('esbuild');
const { sassPlugin } = require('esbuild-sass-plugin');
const { clean } = require('esbuild-plugin-clean');
const { copy } = require('esbuild-plugin-copy');
const svgrPlugin = require('esbuild-plugin-svgr');

const isProd =
  process.argv.indexOf('prod') !== -1 ||
  process.argv.indexOf('prod-hosted') !== -1;
const isHosted = process.argv.indexOf('prod-hosted') !== -1;

esbuild
  .build({
    bundle: true,
    entryPoints: {
      // code
      background: './src/background.js',
      'content-script': './src/content-script.js',
      'nostr-provider': './src/nostr-provider.js',
      types: './src/types.ts',
      common: './src/common.ts',
      popup: './src/popup.jsx',
      prompt: './src/prompt.jsx',
      options: './src/options.jsx',
      // styles
      style: './src/style.scss'
    },
    outdir: './dist',
    loader: {
      ['.png']: 'dataurl',
      ['.svg']: 'text',
      ['.ttf']: 'file',
      ['.json']: 'file'
    },
    plugins: [
      clean({
        patterns: ['./dist/*'],
        cleanOn: 'start'
      }),
      sassPlugin(),
      svgrPlugin(),
      copy({
        assets: [
          {
            from: [
              isHosted ? './src/hosted/manifest.json' : './src/manifest.json'
            ],
            to: ['./']
          },
          {
            from: ['./src/*.html'],
            to: ['./']
          },
          {
            from: ['./src/assets/logo/*'],
            to: ['./assets/logo']
          },
          {
            from: ['./src/assets/icons/*'],
            to: ['./assets/icons']
          }
        ]
      })
    ],
    sourcemap: isProd ? false : 'inline',
    define: {
      global: 'window'
    }
  })
  .then(() =>
    console.log(`Build success. Prod=${isProd} - Hosted=${isHosted}.`)
  )
  .catch(err =>
    console.error(`Build error. Prod=${isProd} - Hosted=${isHosted}.`, err)
  );
