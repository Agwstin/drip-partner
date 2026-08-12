// Test E2E del backend goteo-cloud en producción
const API = 'https://goteo-cloud.drip-cloud.workers.dev'

async function main() {
  const log = (label, data) => console.log(label, JSON.stringify(data))

  // health
  log('HEALTH:', await (await fetch(API + '/health')).json())

  // register persona (email único por corrida)
  const stamp = Date.now()
  const r1 = await (await fetch(API + '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `persona${stamp}@test.com`, password: 'testpass123', deviceId: 'dev1' }),
  })).json()
  if (!r1.token) { log('REGISTER FAIL:', r1); return }
  log('REGISTER persona:', { ...r1.user, tokenLen: r1.token.length })
  const t1 = r1.token

  // register pareja
  const r2 = await (await fetch(API + '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `pareja${stamp}@test.com`, password: 'testpass123', deviceId: 'dev2' }),
  })).json()
  log('REGISTER pareja:', { ...r2.user, tokenLen: r2.token.length })
  const t2 = r2.token

  // login incorrecto (debe dar 401)
  const bad = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `persona${stamp}@test.com`, password: 'wrongpass' }),
  })
  log('LOGIN malo (401 esperado):', bad.status)

  // login correcto
  const l1 = await (await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `persona${stamp}@test.com`, password: 'testpass123', deviceId: 'dev1' }),
  })).json()
  log('LOGIN ok:', { tokenLen: l1.token.length })

  // PUT calendar
  const put = await (await fetch(API + '/calendar', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + t1, 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: 'BLOB-CIFRADO-PERSONA-V1', version: 1 }),
  })).json()
  log('PUT calendar:', put)

  // GET calendar
  const get = await (await fetch(API + '/calendar', {
    headers: { 'Authorization': 'Bearer ' + t1 },
  })).json()
  log('GET calendar:', get)

  // conflicto de version (debe dar 409)
  const conflict = await fetch(API + '/calendar', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + t1, 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: 'STALE', version: 1 }),
  })
  log('PUT version vieja (409 esperado):', conflict.status)

  // invite + redeem
  const inv = await (await fetch(API + '/pair/invite', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + t1 },
  })).json()
  log('INVITE:', inv)

  const red = await (await fetch(API + '/pair/redeem', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + t2, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: inv.code }),
  })).json()
  log('REDEEM:', red)

  // la pareja ve el blob de la persona (solo lectura)
  const pair = await (await fetch(API + '/pair', {
    headers: { 'Authorization': 'Bearer ' + t2 },
  })).json()
  log('GET pair (pareja):', pair)

  // auth/me
  const me = await (await fetch(API + '/auth/me', {
    headers: { 'Authorization': 'Bearer ' + t2 },
  })).json()
  log('ME:', me)

  // sin token (401)
  const noAuth = await fetch(API + '/calendar')
  log('GET calendar sin token (401 esperado):', noAuth.status)

  console.log('--- TODO OK ---')
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
