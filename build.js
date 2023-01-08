#!/usr/bin/env node

const esbuild = require('esbuild')
const {sassPlugin} = require('esbuild-sass-plugin')

const prod = process.argv.indexOf('prod') !== -1

esbuild
  .build({
    bundle: true,
    entryPoints: {
      'popup.build': './extension/popup.jsx',
      'prompt.build': './extension/prompt.jsx',
      'options.build': './extension/options.jsx',
      'background.build': './extension/background.js',
      'content-script.build': './extension/content-script.js',
      // styles
      'style.build': './extension/style.scss'
    },
    outdir: './extension',
    loader: {
      ['.png']: 'dataurl',
      ['.svg']: 'text',
      ['.ttf']: 'file'
    },
    plugins: [sassPlugin()],
    sourcemap: prod ? false : 'inline',
    define: {
      global: 'window'
    }
  })
  .then(() => console.log('build success.'))
