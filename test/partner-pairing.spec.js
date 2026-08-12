import {
  generatePairingIdentity,
  buildInvite,
  parseInvite,
  deriveSharedSecret,
  encryptForPartner,
  decryptFromPartner,
} from '../lib/partner-pairing'
import { encodeBase64, decodeBase64, utf8Encode, utf8Decode } from '../lib/partner-codec'

describe('partner-pairing', () => {
  test('genera identidades con claves de largo correcto', () => {
    const id = generatePairingIdentity()
    expect(decodeBase64(id.publicKeyB64).length).toBe(32)
    expect(decodeBase64(id.secretKeyB64).length).toBe(32)
    expect(id.pairingId).toMatch(/^[0-9a-f]{16}$/)
  })

  test('buildInvite/parseInvite roundtrip', () => {
    const id = generatePairingIdentity()
    const invite = buildInvite(id, 'Cami')
    const parsed = parseInvite(invite)
    expect(parsed.name).toBe('Cami')
    expect(parsed.id).toBe(id.pairingId)
    expect(parsed.publicKeyB64).toBe(id.publicKeyB64)
    expect(parsed.publicKey.length).toBe(32)
  })

  test('parseInvite rechaza payloads inválidos', () => {
    expect(() => parseInvite('not-base64!!')).toThrow()
    expect(() => parseInvite(encodeBase64(utf8Encode(JSON.stringify({ v: 99 }))))).toThrow()
    expect(() =>
      parseInvite(encodeBase64(utf8Encode(JSON.stringify({ v: 1, type: 'drip-partner-invite' }))))
    ).toThrow()
  })

  test('parseInvite rechaza invites con id adulterado (no coincide con pub)', () => {
    const id = generatePairingIdentity()
    const invite = buildInvite(id, 'Cami')
    const parsed = parseInvite(invite)
    // alterar el id sin tocar la clave pública -> debe fallar
    const payload = JSON.parse(utf8Decode(decodeBase64(invite)))
    payload.id = 'deadbeefdeadbeef'
    const forged = encodeBase64(utf8Encode(JSON.stringify(payload)))
    expect(() => parseInvite(forged)).toThrow(/no corresponde/)
    expect(parsed.id).toBe(id.pairingId)
  })

  test('deriveSharedSecret produce el mismo secreto en ambos lados', () => {
    const persona = generatePairingIdentity()
    const pareja = generatePairingIdentity()

    const secretPersona = deriveSharedSecret(persona.secretKeyB64, pareja.publicKeyB64)
    const secretPareja = deriveSharedSecret(pareja.secretKeyB64, persona.publicKeyB64)

    expect(secretPersona).toEqual(secretPareja)
  })

  test('cifra y descifra un blob del calendario', () => {
    const persona = generatePairingIdentity()
    const pareja = generatePairingIdentity()
    const secret = deriveSharedSecret(persona.secretKeyB64, pareja.publicKeyB64)

    const calendarBlob = JSON.stringify({
      version: 1,
      generatedAt: '2026-08-11T10:00:00Z',
      cycleDays: [
        { date: '2026-08-01', bleeding: 2, pain: 1 },
        { date: '2026-08-02', mood: 4 },
      ],
      insights: [{ type: 'painPattern', text: 'test' }],
    })

    const encrypted = encryptForPartner(secret, calendarBlob)
    // el ciphertext no contiene el texto plano
    expect(encrypted).not.toContain('2026-08-01')

    const decrypted = decryptFromPartner(secret, encrypted)
    expect(JSON.parse(decrypted)).toEqual(JSON.parse(calendarBlob))
  })

  test('descifrar con el secreto equivocado falla', () => {
    const a = generatePairingIdentity()
    const b = generatePairingIdentity()
    const evil = generatePairingIdentity()
    const secretAB = deriveSharedSecret(a.secretKeyB64, b.publicKeyB64)
    const secretAEvil = deriveSharedSecret(a.secretKeyB64, evil.publicKeyB64)

    const encrypted = encryptForPartner(secretAB, JSON.stringify({ x: 1 }))
    expect(() => decryptFromPartner(secretAEvil, encrypted)).toThrow()
  })

  test('nonces únicos: mismo blob cifrado dos veces da distinto output', () => {
    const a = generatePairingIdentity()
    const b = generatePairingIdentity()
    const secret = deriveSharedSecret(a.secretKeyB64, b.publicKeyB64)
    const blob = JSON.stringify({ x: 1 })
    const c1 = encryptForPartner(secret, blob)
    const c2 = encryptForPartner(secret, blob)
    expect(c1).not.toBe(c2)
  })
})
