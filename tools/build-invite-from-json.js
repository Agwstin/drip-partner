/**
 * build-invite-from-json.js — arma el invite base64 a partir de la identidad
 * extraída del emulador (partnerIdentity en AsyncStorage).
 * Uso: node tools/build-invite-from-json.js
 * Lee la identidad desde el stdin o variable env PARTNER_IDENTITY_JSON.
 */
const babel = require('@babel/core')
const Module = require('module')
const fs = require('fs')
const path = require('path')
const origLoader = Module._extensions['.js']
Module._extensions['.js'] = function (module, filename) {
  if (!filename.includes('node_modules') && (filename.includes(path.sep + 'lib' + path.sep) || filename.includes('/lib/'))) {
    const src = fs.readFileSync(filename, 'utf8')
    const { code } = babel.transformSync(src, {
      filename,
      plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
      babelrc: false,
      configFile: false,
    })
    module._compile(code, filename)
    return
  }
  origLoader(module, filename)
}

const { buildInvite } = require('../lib/partner-pairing')

const identity = JSON.parse(process.env.PARTNER_IDENTITY_JSON || fs.readFileSync(0, 'utf8'))
process.stdout.write(buildInvite(identity, 'jorbis'))
