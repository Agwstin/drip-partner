/**
 * partner-codec.js
 *
 * Base64 (y utilidades binarias) compatibles con React Native.
 * RN no expone btoa/atob de forma confiable; esta implementación
 * es pura JS y funciona en Hermes y en Node (tests).
 */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function encodeBase64(bytes) {
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    result += B64_CHARS[b0 >> 2]
    result += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)]
    if (i + 1 < bytes.length) {
      result += B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)]
    } else {
      result += '='
    }
    if (i + 2 < bytes.length) {
      result += B64_CHARS[b2 & 63]
    } else {
      result += '='
    }
  }
  return result
}

export function decodeBase64(b64) {
  const clean = b64.replace(/=+$/, '').replace(/[^A-Za-z0-9+/]/g, '')
  const bytes = []
  let buffer = 0
  let bits = 0
  for (const ch of clean) {
    const val = B64_CHARS.indexOf(ch)
    if (val === -1) continue
    buffer = (buffer << 6) | val
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

/** Hex de un Uint8Array (para logs / ids cortos) */
export function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** UTF-8 encode/decode sin depender de TextEncoder (Hermes lo tiene, Node viejo no) */
export function utf8Encode(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str)
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      // surrogate pair -> 4 bytes
      i++
      const cp = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff))
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      )
    }
  }
  return new Uint8Array(bytes)
}

export function utf8Decode(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes)
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i++
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      i += 2
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
      i += 3
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
      out += String.fromCodePoint(cp)
      i += 4
    }
  }
  return out
}
