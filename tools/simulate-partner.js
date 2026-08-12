/**
 * simulate-partner.js — simula el lado de la PAREJA en Node para el E2E.
 *
 * Uso (con el invite real generado en el emulador):
 *   node tools/simulate-partner.js "<inviteB64>"
 *
 * Flujo:
 *  1. Recibe el invite de la persona (desde el emulador)
 *  2. Genera su propia identidad de pareja
 *  3. Deriva el secreto compartido
 *  4. Arma un payload de calendario de ejemplo, lo cifra y lo imprime
 *     -> ese blob se pega en la vista Partner del emulador para descifrarlo
 *
 * Nota: corre con el mismo código (lib/partner-*.js) que la app.
 */
// require hook: transpila los imports ES de lib/ con @babel/core
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

const {
  generatePairingIdentity,
  parseInvite,
  deriveSharedSecret,
  encryptForPartner,
  buildInvite,
} = require('../lib/partner-pairing')
const { buildSharePayload } = require('../lib/partner-share')

const personInviteB64 = process.argv[2]
if (!personInviteB64) {
  console.error('Uso: node tools/simulate-partner.js "<inviteDeLaPersona>"')
  process.exit(1)
}

async function main() {
  // 1. Parsear el invite de la persona
  const person = parseInvite(personInviteB64)
  console.log('Persona detectada:', person.name, '| pairingId:', person.id)

  // 2. Identidad de la pareja
  const partner = generatePairingIdentity()
  const partnerInvite = buildInvite(partner, 'pareja-simulada')
  console.log('Invite de la pareja (para pegar en la app si hiciera falta):')
  console.log(partnerInvite)
  console.log()

  // 3. Secreto compartido (mismo que deriva la app)
  const shared = deriveSharedSecret(partner.secretKeyB64, person.publicKeyB64)
  console.log('Secreto compartido derivado OK')

  // 4. Payload de ejemplo: 3 ciclos con patrón de dolor día 1-2 y ánimo bajo post-ovu
  const cycleDays = []
  const starts = ['2025-01-01', '2025-01-29', '2025-02-26']
  for (let c = 0; c < starts.length; c++) {
    const start = new Date(starts[c])
    for (let d = 0; d < 28; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + d)
      const iso = date.toISOString().slice(0, 10)
      const dayOfCycle = d + 1
      const day = { date: iso }
      if (dayOfCycle <= 5) {
        day.bleeding = { value: dayOfCycle <= 2 ? 3 : 2 }
        day.pain = { value: dayOfCycle <= 2 ? 3 : 1 }
        day.mood = { value: dayOfCycle <= 2 ? 2 : 3 }
      } else if (dayOfCycle >= 20) {
        day.mood = { value: 2 }
        day.pain = { value: 1 }
      } else {
        day.mood = { value: 4 }
      }
      if (dayOfCycle % 3 === 0) day.desire = { value: 2 }
      cycleDays.push(day)
    }
  }

  const payload = buildSharePayload({
    cycleDays,
    cycleStarts: starts,
    partnerName: 'Cami',
    options: { includeBleeding: true },
  })

  const blob = encryptForPartner(shared, JSON.stringify(payload))
  console.log()
  console.log('=== BLOB CIFRADO (pegar en la vista Partner del emulador) ===')
  console.log(blob)
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
