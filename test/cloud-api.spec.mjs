// Verifica lib/cloud-api.js contra el backend real
import { configureCloud, cloudRegister, cloudLogin, cloudGetCalendar, cloudPutCalendar, cloudCreateInvite, cloudRedeemInvite, cloudGetPair, cloudMe, cloudLogout } from '../lib/cloud-api.js'

async function main() {
  const stamp = Date.now()
  const email = `cliente${stamp}@test.com`
  const email2 = `cliente2${stamp}@test.com`

  // register + sesión en memoria
  const reg = await cloudRegister(email, 'testpass123', 'dev1')
  console.log('register:', reg.user?.email, '| token len:', reg.token.length)

  // PUT + GET calendar
  await cloudPutCalendar('BLOB-CIFRADO-VIA-CLIENTE', 1)
  const cal = await cloudGetCalendar()
  console.log('calendar:', cal.blob, 'v' + cal.version)

  // pairing con segunda cuenta
  const inv = await cloudCreateInvite()
  console.log('invite:', inv.code)

  configureCloud({ token: null })
  const reg2 = await cloudRegister(email2, 'testpass123', 'dev2')
  const red = await cloudRedeemInvite(inv.code)
  console.log('redeem:', red.ok, '| partner:', red.partner.email)

  const pair = await cloudGetPair()
  console.log('pair:', pair.partner.email, '| blob pareja:', pair.partnerBlob?.blob)

  // logout + me (debe fallar)
  await cloudLogout()
  try {
    await cloudMe()
    console.log('ERROR: me debería fallar tras logout')
  } catch (e) {
    console.log('me tras logout (401 esperado):', e.status)
  }

  console.log('--- CLIENTE OK ---')
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
