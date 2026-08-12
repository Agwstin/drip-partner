// Test E2E del backend goteo-cloud
//
// SEGURO POR DEFECTO: apunta a un endpoint LOCAL/STAGING. Para probar
// producción hay que setear explicitamente GOTEO_API_URL.
// No deja datos persistentes: hace cleanup de las cuentas creadas.

import { configureCloud, cloudRegister, cloudLogin, cloudGetCalendar, cloudPutCalendar, cloudCreateInvite, cloudRedeemInvite, cloudGetPair, cloudMe, cloudLogout, cloudUnpair } from '../lib/cloud-api.js'

const API = process.env.GOTEO_API_URL || 'http://127.0.0.1:8787' // wrangler dev
const IS_PROD = API.includes('workers.dev')

if (IS_PROD && process.env.GOTEO_ALLOW_PROD !== '1') {
  console.error('BLOQUEO: GOTEO_API_URL apunta a producción. Seteá GOTEO_ALLOW_PROD=1 para confirmar.')
  process.exit(2)
}

let failures = 0
function assert(cond, label) {
  if (cond) {
    console.log('  ✓', label)
  } else {
    failures++
    console.error('  ✗ FALLA:', label)
  }
}

async function main() {
  console.log(`API: ${API}${IS_PROD ? ' (PRODUCCIÓN)' : ''}`)

  // apuntar el cliente a la URL objetivo (por defecto local)
  configureCloud({ url: API })

  const stamp = Date.now()
  const email = `test${stamp}@goteo.test`
  const email2 = `test2${stamp}@goteo.test`
  const createdIds = []

  // health
  const health = await (await fetch(API + '/health')).json()
  assert(health.ok === true, 'health responde ok')

  // register persona
  const reg = await cloudRegister(email, 'testpass123', 'dev1')
  assert(reg.token?.length > 40, `register da token (len ${reg.token.length})`)
  createdIds.push(reg.user.id)

  // email inválido → 400
  try {
    await cloudRegister('no-es-email', 'testpass123')
    assert(false, 'register con email inválido da error')
  } catch (e) {
    assert(e.status === 400, `register email inválido → 400 (got ${e.status})`)
  }

  // password corto → 400
  try {
    await cloudRegister(`short${stamp}@goteo.test`, 'short')
    assert(false, 'register con password corto da error')
  } catch (e) {
    assert(e.status === 400, `register password corto → 400 (got ${e.status})`)
  }

  // login incorrecto → 401
  try {
    await cloudLogin(email, 'wrongpass')
    assert(false, 'login con password malo da error')
  } catch (e) {
    assert(e.status === 401, `login password malo → 401 (got ${e.status})`)
  }

  // login correcto
  const login = await cloudLogin(email, 'testpass123', 'dev1')
  assert(login.token?.length > 40, 'login correcto da token')

  // calendar PUT → GET roundtrip
  const put = await cloudPutCalendar('BLOB-CIFRADO-V1', 1)
  assert(put.ok === true && put.version === 1, 'PUT calendar v1 (creación)')
  const get = await cloudGetCalendar()
  assert(get.blob === 'BLOB-CIFRADO-V1' && get.version === 1, 'GET calendar roundtrip')

  // update legítimo: cliente con la versión actual (1) sube v2
  const put2 = await cloudPutCalendar('BLOB-CIFRADO-V2', 1)
  assert(put2.version === 2, 'PUT con versión actual avanza a v2')

  // conflicto real: mandar versión vieja (1) cuando la actual es 2 → 409
  try {
    await cloudPutCalendar('BLOB-STALE', 1)
    assert(false, 'PUT con versión vieja da conflicto')
  } catch (e) {
    assert(e.status === 409, `PUT versión vieja → 409 (got ${e.status})`)
  }

  // versión inválida → 400
  try {
    await cloudPutCalendar('BLOB-X', 'abc')
    assert(false, 'PUT con versión string da error')
  } catch (e) {
    assert(e.status === 400, `PUT versión inválida → 400 (got ${e.status})`)
  }

  // blob gigante → 413
  try {
    await cloudPutCalendar('X'.repeat(600 * 1024), 2)
    assert(false, 'PUT blob gigante da error')
  } catch (e) {
    assert(e.status === 413, `PUT blob > 512KB → 413 (got ${e.status})`)
  }

  // pairing: persona crea invite, pareja lo redime
  const inv = await cloudCreateInvite()
  assert(inv.code?.length === 32, `invite con 128 bits (32 hex, len ${inv.code?.length})`)

  const reg2 = await cloudRegister(email2, 'testpass123', 'dev2')
  createdIds.push(reg2.user.id)
  const red = await cloudRedeemInvite(inv.code)
  assert(red.ok === true, 'redeem del invite OK')
  assert(red.partner.email === email, 'pareja ve el email de la persona')

  // invite reutilizado → 410
  try {
    await cloudRedeemInvite(inv.code)
    assert(false, 'invite reutilizado da error')
  } catch (e) {
    assert(e.status === 410, `invite reutilizado → 410 (got ${e.status})`)
  }

  // pareja ve el blob de la persona (solo lectura)
  const pair = await cloudGetPair()
  assert(pair.partner.email === email, 'GET pair muestra pareja')
  assert(pair.partnerBlob?.blob === 'BLOB-CIFRADO-V2', 'pareja ve el blob actualizado')

  // unpair revoca
  const unpair = await cloudUnpair()
  assert(unpair.ok === true, 'DELETE pair revoca vínculo')
  const pairAfter = await cloudGetPair()
  assert(pairAfter.partner === null, 'GET pair tras revocar → null')

  // me tras logout → 401
  await cloudLogout()
  try {
    await cloudMe()
    assert(false, 'me tras logout da error')
  } catch (e) {
    assert(e.status === 401, `me tras logout → 401 (got ${e.status})`)
  }

  // sin token → 401
  configureCloud({ token: null })
  try {
    await cloudGetCalendar()
    assert(false, 'GET calendar sin token da error')
  } catch (e) {
    assert(e.status === 401, `GET calendar sin token → 401 (got ${e.status})`)
  }

  console.log(failures === 0 ? '\n--- TODO OK ---' : `\n--- ${failures} FALLOS ---`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
