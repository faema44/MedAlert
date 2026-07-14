package com.alertamedico.app

import android.util.Base64
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Cifra dos avisos enviados ao cuidador.
 *
 * O aviso viaja como push pelos servidores do Expo e do Google (FCM). O corpo VISÍVEL da push é
 * genérico ("Novo aviso sobre a Maria") — o que é dado de saúde ("não tomou Enalapril 10mg às
 * 15:12") vai só aqui dentro, cifrado com a chave que idoso e cuidador trocaram no pareamento.
 * Nem o Expo nem o Google conseguem ler.
 *
 * Fica em Kotlin, e não em JS, por um motivo que não é estético: o aviso de "sem resposta" tem
 * que sair com o app MORTO (é a definição de sem resposta — ninguém tocou em nada). Quem envia é
 * um receiver de alarme nativo, sem runtime de JS por perto. Como a cifra precisa existir aqui de
 * qualquer jeito, o lado JS chama estas mesmas funções via MedNotificationModule — o que também
 * evita ter que adicionar uma biblioteca de cripto ao package.json.
 *
 * AES-256-GCM. O IV (12 bytes, aleatório a cada mensagem) vai na frente do texto cifrado.
 */
object CaregiverCrypto {
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128

    fun newKeyB64(): String {
        val key = ByteArray(32)
        SecureRandom().nextBytes(key)
        return Base64.encodeToString(key, Base64.NO_WRAP)
    }

    fun encrypt(plaintext: String, keyB64: String): String {
        val key = SecretKeySpec(Base64.decode(keyB64, Base64.NO_WRAP), "AES")
        val iv = ByteArray(IV_BYTES)
        SecureRandom().nextBytes(iv)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        val sealed = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        return Base64.encodeToString(iv + sealed, Base64.NO_WRAP)
    }

    fun decrypt(payloadB64: String, keyB64: String): String {
        val raw = Base64.decode(payloadB64, Base64.NO_WRAP)
        require(raw.size > IV_BYTES) { "payload cifrado truncado" }

        val key = SecretKeySpec(Base64.decode(keyB64, Base64.NO_WRAP), "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, raw.copyOfRange(0, IV_BYTES)))

        return String(cipher.doFinal(raw.copyOfRange(IV_BYTES, raw.size)), Charsets.UTF_8)
    }
}
