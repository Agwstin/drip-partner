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

import { generatePairingIdentity, buildInvite, parseInvite, deriveSharedSecret } from '../../../lib/partner-pairing'
import { decryptFromPartner } from '../../../lib/partner-pairing'
import {
  partnerIdentityObservable,
  partnerPeerObservable,
  partnerBlobObservable,
  initPartnerStorage,
  savePartnerIdentity,
  savePartnerPeer,
  savePartnerBlob,
} from '../../../lib/partner-storage'
import { normalizeCycles, phaseProfiles, symptomCorrelations, worstSymptomDays, generateInsights } from '../../../lib/partner-insights'

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
      const cycles = normalizeCycles(
        payload.cycleDays.map((d) => ({
          ...d,
          mood: d.mood !== undefined ? { value: d.mood } : undefined,
          pain: d.pain !== undefined ? { value: d.pain } : undefined,
          desire: d.desire !== undefined ? { value: d.desire } : undefined,
          bleeding: d.bleeding !== undefined ? { value: d.bleeding } : undefined,
        })),
        payload.cycleStarts
      )
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
          Alert.alert(t('error'), 'Primero generá tu invite (paso 1)')
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
      const cycles = normalizeCycles(
        payload.cycleDays.map((d) => ({
          ...d,
          mood: d.mood !== undefined ? { value: d.mood } : undefined,
          pain: d.pain !== undefined ? { value: d.pain } : undefined,
          desire: d.desire !== undefined ? { value: d.desire } : undefined,
          bleeding: d.bleeding !== undefined ? { value: d.bleeding } : undefined,
        })),
        payload.cycleStarts
      )
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
      </Segment>

      {/* 3. Recibir blob cifrado */}
      <Segment>
        <AppText style={styles.sectionTitle}>{t('receiveTitle')}</AppText>
        <AppText>{t('receiveHint')}</AppText>
        <Button isCTA onPress={handleLoadDemoBlob} style={styles.button}>
          Demo E2E: cargar + descifrar blob de prueba
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

      {/* 4. Insights */}
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
    borderRadius: 5,
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
})

export default Partner
