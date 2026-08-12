/**
 * partner-pairing.js
 *
 * Pairing E2EE entre dos dispositivos (persona + pareja).
 *
 * Modelo:
 *  1. La persona genera su par de claves (nacl.box: X25519 + XSalsa20-Poly1305)
 *  2. Comparte su clave pública via QR (invite)
 *  3. La pareja escanea, genera su propio par, y comparte su clave pública
 *  4. Ambos derivan un secreto compartido (box.before) -> cifran/descifran
 *     blobs del calendario sin que ningún intermediario pueda leerlos
 *
 * Todo on-device. El transporte (QR, archivo, relay futuro) es intercambiable:
 * este módulo solo produce/consume payloads cifrados.
 */

import nacl from 'tweetnacl'
import { encodeBase64, decodeBase64, utf8Encode, utf8Decode } from './partner-codec'

export const PROTOCOL_VERSION = 1

/**
 * Crea una identidad de pairing nueva.
 * @returns {{publicKeyB64: string, secretKeyB64: string, pairingId: string}}
 *   pairingId = hash corto de la clave pública (identificador del par)
 */
export function generatePairingIdentity() {
  const { publicKey, secretKey } = nacl.box.keyPair()
  const pairingId = nacl
    .hash(publicKey)
    .slice(0, 8)
    .reduce((acc, b) => acc + b.toString(16).padStart(2, '0'), '')
  return {
    publicKeyB64: encodeBase64(publicKey),
    secretKeyB64: encodeBase64(secretKey),
    pairingId,
  }
}

/**
 * Payload de invite (lo que viaja en el QR / mensaje de pairing).
 */
export function buildInvite(identity, displayName) {
  const payload = {
    v: PROTOCOL_VERSION,
    type: 'drip-partner-invite',
    id: identity.pairingId,
    name: displayName || 'Pareja',
    pub: identity.publicKeyB64,
  }
  return encodeBase64(utf8Encode(JSON.stringify(payload)))
}

/**
 * Parsea un invite y valida su estructura.
 * @returns {{pairingId, name, publicKeyB64, publicKey: Uint8Array}}
 */
export function parseInvite(inviteB64) {
  let payload
  try {
    payload = JSON.parse(utf8Decode(decodeBase64(inviteB64)))
  } catch (e) {
    throw new Error('Invite inválido: no es JSON base64 válido')
  }
  if (payload.v !== PROTOCOL_VERSION || payload.type !== 'drip-partner-invite') {
    throw new Error(`Invite inválido: versión o tipo incorrecto (v=${payload.v})`)
  }
  if (!payload.pub || !payload.id) {
    throw new Error('Invite inválido: faltan campos (pub/id)')
  }
  const publicKey = decodeBase64(payload.pub)
  if (publicKey.length !== nacl.box.publicKeyLength) {
    throw new Error('Invite inválido: clave pública de largo incorrecto')
  }
  // el id debe ser el hash de la clave pública: evita invites adulterados
  const expectedId = nacl
    .hash(publicKey)
    .slice(0, 8)
    .reduce((acc, b) => acc + b.toString(16).padStart(2, '0'), '')
  if (payload.id !== expectedId) {
    throw new Error('Invite inválido: el id no corresponde a la clave pública')
  }
  return { ...payload, publicKeyB64: payload.pub, publicKey }
}

/**
 * Deriva el secreto compartido persona<->pareja.
 * El lado "receptor" (partner) usa su secretKey + la pub de la persona.
 */
export function deriveSharedSecret(mySecretKeyB64, partnerPublicKeyB64) {
  const secretKey = decodeBase64(mySecretKeyB64)
  const partnerPublicKey = decodeBase64(partnerPublicKeyB64)
  if (secretKey.length !== nacl.box.secretKeyLength) {
    throw new Error('Secret key inválida')
  }
  if (partnerPublicKey.length !== nacl.box.publicKeyLength) {
    throw new Error('Partner public key inválida')
  }
  return nacl.box.before(partnerPublicKey, secretKey)
}

/**
 * Cifra un blob (JSON del calendario) para la pareja.
 * @returns {string} payload base64: nonce(24) + ciphertext
 */
export function encryptForPartner(sharedSecret, jsonBlob) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const data = utf8Encode(jsonBlob)
  const ciphertext = nacl.secretbox(data, nonce, sharedSecret)
  const payload = new Uint8Array(nonce.length + ciphertext.length)
  payload.set(nonce, 0)
  payload.set(ciphertext, nonce.length)
  return encodeBase64(payload)
}

/**
 * Descifra un blob recibido de la pareja.
 * @returns {string} JSON original
 */
export function decryptFromPartner(sharedSecret, payloadB64) {
  const payload = decodeBase64(payloadB64)
  if (payload.length < nacl.box.nonceLength + nacl.secretbox.overheadLength) {
    throw new Error('Payload cifrado demasiado corto')
  }
  const nonce = payload.slice(0, nacl.box.nonceLength)
  const ciphertext = payload.slice(nacl.box.nonceLength)
  const plaintext = nacl.secretbox.open(ciphertext, nonce, sharedSecret)
  if (!plaintext) {
    throw new Error('No se pudo descifrar: clave incorrecta o payload corrupto')
  }
  return utf8Decode(plaintext)
}
