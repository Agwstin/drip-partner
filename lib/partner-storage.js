/**
 * partner-storage.js
 *
 * Persistencia del estado de pairing en AsyncStorage:
 *  - identidad propia (claves E2E)
 *  - identidad de la pareja (clave pública)
 *  - último blob recibido (cifrado)
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import Observable from 'obv'

export const partnerIdentityObservable = Observable()
export const partnerPeerObservable = Observable()
export const partnerBlobObservable = Observable()

function setObvWithInitValue(key, observable, initial) {
  AsyncStorage.getItem(key)
    .then((value) => {
      try {
        observable.set(value ? JSON.parse(value) : initial)
      } catch (e) {
        observable.set(initial)
      }
    })
    .catch(() => observable.set(initial))
}

// Inicialización lazy: los observables arrancan en null hasta que
// AsyncStorage responde
export function initPartnerStorage() {
  setObvWithInitValue('partnerIdentity', partnerIdentityObservable, null)
  setObvWithInitValue('partnerPeer', partnerPeerObservable, null)
  setObvWithInitValue('partnerBlob', partnerBlobObservable, null)
}

export async function savePartnerIdentity(identity) {
  await AsyncStorage.setItem('partnerIdentity', JSON.stringify(identity))
  partnerIdentityObservable.set(identity)
}

export async function savePartnerPeer(peer) {
  await AsyncStorage.setItem('partnerPeer', JSON.stringify(peer))
  partnerPeerObservable.set(peer)
}

export async function savePartnerBlob(blob) {
  await AsyncStorage.setItem('partnerBlob', JSON.stringify(blob))
  partnerBlobObservable.set(blob)
}

export async function clearPartnerPairing() {
  await AsyncStorage.multiRemove(['partnerIdentity', 'partnerPeer', 'partnerBlob'])
  partnerIdentityObservable.set(null)
  partnerPeerObservable.set(null)
  partnerBlobObservable.set(null)
}
