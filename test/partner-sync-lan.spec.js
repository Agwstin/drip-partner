import { createLanTransport } from '../lib/partner-sync-lan'

describe('partner-sync-lan', () => {
  test('el transporte se inicia y publica beacons del pairing propio', (done) => {
    const statuses = []
    const lan = createLanTransport({
      getIdentity: () => ({ pairingId: 'aabbccddeeff0011', name: 'Jorbis' }),
      getPeer: () => ({ pairingId: '1122334455667788' }),
      getBlob: () => 'blob-cifrado',
      onBlobReceived: async () => {},
      onStatus: (s) => statuses.push(s),
    })
    lan.start()
    setTimeout(() => {
      lan.stop()
      expect(statuses.some((s) => s.type === 'lan-udp-ready')).toBe(true)
      expect(statuses.some((s) => s.type === 'lan-tcp-ready')).toBe(true)
      done()
    }, 100)
  })

  test('sendToPeer sin peer visible reporta peer-not-visible', async () => {
    const lan = createLanTransport({
      getIdentity: () => ({ pairingId: 'aabbccddeeff0011' }),
      getPeer: () => ({ pairingId: '1122334455667788' }),
      getBlob: () => 'blob',
      onBlobReceived: async () => {},
    })
    const res = await lan.sendToPeer('blob')
    expect(res.sent).toBe(false)
    expect(res.reason).toBe('peer-not-visible')
    lan.stop()
  })
})
