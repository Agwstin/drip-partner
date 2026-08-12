/**
 * gen-invite.js — genera un invite de prueba desde Node (mismo código que la app).
 * Uso: node tools/gen-invite.js
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

const { generatePairingIdentity, buildInvite } = require('../lib/partner-pairing')
const id = generatePairingIdentity()
process.stdout.write(buildInvite(id, 'test-device'))
