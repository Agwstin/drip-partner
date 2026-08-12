import React, { useEffect, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import PropTypes from 'prop-types'

import AppPage from '../../common/app-page'
import AppText from '../../common/app-text'
import AppTextInput from '../../common/app-text-input'
import Button from '../../common/button'
import Segment from '../../common/segment'

import { Colors, Spacing } from '../../../styles'
import { useTranslation } from 'react-i18next'

import { generatePairingIdentity, buildInvite, parseInvite, deriveSharedSecret, encryptForPartner } from '../../../lib/partner-pairing'
import { decryptFromPartner } from '../../../lib/partner-pairing'
import {
  partnerIdentityObservable,
  partnerPeerObservable,
  partnerBlobObservable,
  partnerRelayObservable,
  initPartnerStorage,
  savePartnerIdentity,
  savePartnerPeer,
  savePartnerBlob,
  savePartnerRelay,
} from '../../../lib/partner-storage'
import { normalizeCycles, phaseProfiles, symptomCorrelations, worstSymptomDays, generateInsights } from '../../../lib/partner-insights'
import { buildSharePayload } from '../../../lib/partner-share'
import { createPartnerSync } from '../../../lib/partner-sync'
import { getCycleDaysSortedByDate, getCycleStartsSortedByDate, mapRealmObjToJsObj } from '../../../db'

/**
 * Partner view: pairing + calendario compartido de la pareja.
 * Flujo:
 *  1. Generar mi invite (clave pública) -> se lo paso a mi pareja
 *  2. Pegar el invite de mi pareja -> quedamos vinculados (secreto compartido)
 *  3. Pegar el blob cifrado que me manda -> lo descifro y veo el calendario
 *     + insights generados por el motor de inferencia local
 */
const Partner = () => {
  const { t } = useTranslation(null, { keyPrefix: 'sideMenu.settings.partner' })
  const [identity, setIdentity] = useState(null)
  const [peer, setPeer] = useState(null)

  const [myInvite, setMyInvite] = useState('')
  const [peerInviteInput, setPeerInviteInput] = useState('')
  const [blobInput, setBlobInput] = useState('')
  const [insights, setInsights] = useState([])
  const [sharedSecret, setSharedSecret] = useState(null)
  const [decryptedPayload, setDecryptedPayload] = useState(null)
  const [myEncryptedBlob, setMyEncryptedBlob] = useState('')
  const [relayUrl, setRelayUrl] = useState('')
  const [syncStatus, setSyncStatus] = useState('')
  const syncRef = React.useRef(null)

  useEffect(() => {
    initPartnerStorage()
    partnerIdentityObservable((id) => {
      setIdentity(id)
      if (id) setMyInvite(buildInvite(id, 'yo'))
    })
    partnerPeerObservable(setPeer)
    partnerBlobObservable((blob) => {
      if (blob) setBlobInput(blob.encrypted)
    })
    partnerRelayObservable(setRelayUrl)
  }, [])

  const handleGenerateIdentity = async () => {
    const id = generatePairingIdentity()
    await savePartnerIdentity(id)
    setMyInvite(buildInvite(id, 'yo'))
  }

  const handlePair = async () => {
    try {
      const parsed = parseInvite(peerInviteInput.trim())
      await savePartnerPeer({ pairingId: parsed.id, name: parsed.name, publicKeyB64: parsed.publicKeyB64 })
      const secret = deriveSharedSecret(identity.secretKeyB64, parsed.publicKeyB64)
      setSharedSecret(secret)
      setPeer(parsed)
    } catch (e) {
      Alert.alert(t('error'), e.message)
    }
  }

  const handleDecryptBlob = async () => {
    try {
      const secret =
        sharedSecret ||
        (identity && peer && deriveSharedSecret(identity.secretKeyB64, peer.publicKeyB64))
      if (!secret) {
        Alert.alert(t('error'), t('noSecret'))
        return
      }
      const plaintext = decryptFromPartner(secret, blobInput.trim())
      const payload = JSON.parse(plaintext)
      await savePartnerBlob({ encrypted: blobInput.trim(), receivedAt: new Date().toISOString() })
      setDecryptedPayload(payload)

      // correr el motor de inferencia sobre los datos recibidos
      const cycles = normalizeCycles(payload.cycleDays, payload.cycleStarts)
      const found = generateInsights(
        phaseProfiles(cycles),
        symptomCorrelations(cycles),
        worstSymptomDays(cycles)
      )
      setInsights(found)
    } catch (e) {
      Alert.alert(t('error'), e.message)
    }
  }

  const handleLoadDemoBlob = async () => {
    try {
      const RNFS = require('react-native-fs').default || require('react-native-fs')
      const file = `${RNFS.DocumentDirectoryPath}/blob.txt`
      const exists = await RNFS.exists(file)
      if (!exists) {
        Alert.alert(t('error'), 'No hay blob.txt en el directorio de la app')
        return
      }
      const content = await RNFS.readFile(file)
      setBlobInput(content.trim())

      // 1) Asegurar el peer: si no hay pareja vinculada, cargar peer.txt (demo)
      let secret = sharedSecret
      let effectivePeer = peer
      if (!secret) {
        if (!identity) {
          Alert.alert(t('error'), t('peerFromFile'))
          return
        }
        const peerFile = `${RNFS.DocumentDirectoryPath}/peer.txt`
        if (effectivePeer || (await RNFS.exists(peerFile))) {
          if (!effectivePeer) {
            const peerInvite = (await RNFS.readFile(peerFile)).trim()
            const parsed = parseInvite(peerInvite)
            await savePartnerPeer({ pairingId: parsed.id, name: parsed.name, publicKeyB64: parsed.publicKeyB64 })
            effectivePeer = parsed
          }
          secret = deriveSharedSecret(identity.secretKeyB64, effectivePeer.publicKeyB64)
          setSharedSecret(secret)
        }
      }
      if (!secret) {
        Alert.alert(t('error'), t('noSecret'))
        return
      }

      // 2) Descifrar + analizar
      const plaintext = decryptFromPartner(secret, content.trim())
      const payload = JSON.parse(plaintext)
      await savePartnerBlob({ encrypted: content.trim(), receivedAt: new Date().toISOString() })
      setDecryptedPayload(payload)
      // normalizeCycles acepta la forma REAL de Realm: booleans por síntoma
      const cycles = normalizeCycles(payload.cycleDays, payload.cycleStarts)
      const found = generateInsights(
        phaseProfiles(cycles),
        symptomCorrelations(cycles),
        worstSymptomDays(cycles)
      )
      setInsights(found)
      Alert.alert('E2E OK', `Blob descifrado: ${payload.cycleDays.length} días, ${found.length} insights`)
    } catch (e) {
      Alert.alert(t('error'), e.message)
    }
  }

  /**
   * MITAD EMISORA: arma el payload con los datos REALES de la DB de drip,
   * lo cifra para la pareja y lo muestra para compartir.
   */
  const handleShareMyCalendar = async () => {
    try {
      if (!identity) {
        Alert.alert(t('error'), t('peerFromFile'))
        return
      }
      let secret = sharedSecret
      const effectivePeer = peer
      if (!secret && effectivePeer) {
        secret = deriveSharedSecret(identity.secretKeyB64, effectivePeer.publicKeyB64)
        setSharedSecret(secret)
      }
      if (!secret) {
        Alert.alert(t('error'), t('noSecret'))
        return
      }
      const rawDays = getCycleDaysSortedByDate().map(mapRealmObjToJsObj)
      const rawStarts = getCycleStartsSortedByDate().map(mapRealmObjToJsObj)
      const cycleStarts = rawStarts.map((d) => d.date)
      if (rawDays.length === 0) {
        Alert.alert(t('error'), t('noDataYet'))
        return
      }
      const payload = buildSharePayload({
        cycleDays: rawDays,
        cycleStarts,
        partnerName: effectivePeer ? effectivePeer.name : 'mi pareja',
        options: { includeBleeding: true },
      })
      const blob = encryptForPartner(secret, JSON.stringify(payload))
      setMyEncryptedBlob(blob)
      Alert.alert('OK', t('encryptedReady', { n: payload.cycleDays.length }))
    } catch (e) {
      Alert.alert(t('error'), e.message)
    }
  }

  /** Arma/regenera insights desde un payload recibido (shared con el demo) */
  const computeInsights = (payload) => {
    const cycles = normalizeCycles(payload.cycleDays, payload.cycleStarts)
    return generateInsights(
      phaseProfiles(cycles),
      symptomCorrelations(cycles),
      worstSymptomDays(cycles)
    )
  }

  const applyReceivedBlob = async (blob) => {
    const secret =
      sharedSecret ||
      (identity && peer && deriveSharedSecret(identity.secretKeyB64, peer.publicKeyB64))
    if (!secret) throw new Error(t('noSecret'))
    const plaintext = decryptFromPartner(secret, blob)
    const payload = JSON.parse(plaintext)
    await savePartnerBlob({ encrypted: blob, receivedAt: new Date().toISOString() })
    setDecryptedPayload(payload)
    setInsights(computeInsights(payload))
  }

  /** Activa el sync automático por relay (y LAN si se agrega) */
  const handleStartSync = async () => {
    try {
      if (!identity || !peer) {
        Alert.alert(t('error'), t('noSecret'))
        return
      }
      const base = relayUrl.trim()
      if (!base) {
        Alert.alert(t('error'), t('relayUrlFirst'))
        return
      }
      if (syncRef.current) syncRef.current.stop()

      const motor = createPartnerSync({
        getIdentity: () => identity,
        getPeer: () => peer,
        getCycleDays: () => getCycleDaysSortedByDate().map(mapRealmObjToJsObj),
        getCycleStarts: () =>
          getCycleStartsSortedByDate()
            .map(mapRealmObjToJsObj)
            .map((d) => d.date),
        getRelayBaseUrl: () => base,
        onReceivedBlob: async (blob) => {
          try {
            await applyReceivedBlob(blob)
            setSyncStatus(t('blobReceived') + ' ✓')
          } catch (e) {
            setSyncStatus(`Error al descifrar: ${e.message}`)
          }
        },
        onStatus: (s) => {
          if (s.type === 'pushed') setSyncStatus(`Push OK ${new Date().toLocaleTimeString()}`)
          if (s.type === 'pull-error' || s.type === 'push-error') setSyncStatus(`Sync error: ${s.error}`)
        },
        intervalMs: 30000,
      })
      syncRef.current = motor
      motor.start()
      setSyncStatus(t('syncActive'))
    } catch (e) {
      Alert.alert(t('error'), e.message)
    }
  }

  const handleStopSync = () => {
    if (syncRef.current) {
      syncRef.current.stop()
      syncRef.current = null
      setSyncStatus(t('syncStopped'))
    }
  }

  return (
    <AppPage title={t('title')}>
      <AppText>{t('intro')}</AppText>

      {/* 1. Mi identidad / invite */}
      <Segment>
        <AppText style={styles.sectionTitle}>{t('myIdentity')}</AppText>
        {identity ? (
          <>
            <AppText>{t('identityReady')}</AppText>
            <AppTextInput
              editable={false}
              multiline
              selectTextOnFocus
              style={styles.mono}
              testID="my-invite"
              value={myInvite}
            />
          </>
        ) : (
          <Button onPress={handleGenerateIdentity}>{t('generateIdentity')}</Button>
        )}
      </Segment>

      {/* 2. Vincular con mi pareja */}
      <Segment>
        <AppText style={styles.sectionTitle}>{t('pairTitle')}</AppText>
        {peer ? (
          <AppText>
            {t('pairedWith')} {peer.name}
          </AppText>
        ) : (
          <>
            <AppText>{t('pairHint')}</AppText>
            <AppTextInput
              multiline
              onChangeText={setPeerInviteInput}
              placeholder={t('peerInvitePlaceholder')}
              style={styles.input}
              value={peerInviteInput}
            />
            <Button isCTA onPress={handlePair} style={styles.button}>
              {t('pairButton')}
            </Button>
          </>
        )}
        {peer && (
          <>
            <Button isCTA onPress={handleShareMyCalendar} style={styles.button}>
              {t('shareMyCalendar')}
            </Button>
            {!!myEncryptedBlob && (
              <AppText style={styles.mono}>{myEncryptedBlob}</AppText>
            )}
          </>
        )}
      </Segment>

      {/* 3. Recibir blob cifrado */}
      <Segment>
        <AppText style={styles.sectionTitle}>{t('receiveTitle')}</AppText>
        <AppText>{t('receiveHint')}</AppText>
        <Button isCTA onPress={handleLoadDemoBlob} style={styles.button}>
          {t('demoE2E')}
        </Button>
        <AppTextInput
          multiline
          onChangeText={setBlobInput}
          placeholder={t('blobPlaceholder')}
          style={styles.input}
          value={blobInput}
        />
        <Button onPress={handleDecryptBlob} style={styles.button}>
          {t('decryptButton')}
        </Button>
      </Segment>

      {/* 4. Sync automático */}
      {peer && (
        <Segment>
          <AppText style={styles.sectionTitle}>{t('syncTitle')}</AppText>
          <AppText>
            {t('syncIntro')}
          </AppText>
          <AppTextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(text) => {
              setRelayUrl(text)
              savePartnerRelay(text)
            }}
            placeholder="https://relay.midominio.com"
            style={styles.input}
            value={relayUrl}
          />
          <Button isCTA onPress={handleStartSync} style={styles.button}>
            {t('syncStart')}
          </Button>
          <Button onPress={handleStopSync} style={styles.button}>
            {t('syncStop')}
          </Button>
          {!!syncStatus && <AppText style={styles.syncStatus}>{syncStatus}</AppText>}
        </Segment>
      )}

      {/* 5. Insights */}
      {decryptedPayload && (
        <Segment>
          <AppText style={styles.sectionTitle}>
            {t('insightsTitle')} ({decryptedPayload.cycleDays.length} {t('daysTracked')})
          </AppText>
          {insights.length === 0 && <AppText>{t('noInsights')}</AppText>}
          {insights.map((insight, i) => (
            <View key={i} style={styles.insight}>
              <AppText style={styles.insightText}>{insight.text}</AppText>
            </View>
          ))}
        </Segment>
      )}
    </AppPage>
  )
}

Partner.propTypes = {
  navigate: PropTypes.func,
}

const styles = StyleSheet.create({
  button: {
    marginTop: Spacing.base,
  },
  input: {
    minHeight: 80,
    maxHeight: 140,
  },
  insight: {
    backgroundColor: 'white',
    borderRadius: 12,
    marginTop: Spacing.tiny,
    padding: Spacing.base,
  },
  insightText: {
    color: Colors.greyDark,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 10,
    marginTop: Spacing.base,
  },
  sectionTitle: {
    fontWeight: 'bold',
    marginBottom: Spacing.tiny,
  },
  syncStatus: {
    color: Colors.turquoiseDark,
    marginTop: Spacing.tiny,
  },
})

export default Partner
