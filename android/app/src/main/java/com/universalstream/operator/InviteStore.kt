package com.universalstream.operator

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Enrollment codes include a WireGuard private key: store encrypted by Android Keystore.
internal class InviteStore(context: Context) {
    private val preferences = context.getSharedPreferences("enrollment", Context.MODE_PRIVATE)
    private val alias = "universal-stream-enrollment-v1"
    private fun secret(): SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        val previous=store.getKey(alias,null) as? SecretKey
        if(previous!=null)return previous
        val generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
        return generator.generateKey()
    }
    fun save(value: String) {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE,secret())
        val encoded=cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        preferences.edit().putString("key",Base64.encodeToString(encoded,Base64.NO_WRAP)).apply()
    }
    fun load(): String? {
        val stored=preferences.getString("key",null) ?: return null
        return try {
            val bytes=Base64.decode(stored,Base64.NO_WRAP)
            if(bytes.size < 29) null else {
                val cipher=Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE,secret(),GCMParameterSpec(128,bytes.copyOfRange(0,12)))
                String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)),Charsets.UTF_8)
            }
        }catch (_:Exception){null}
    }
}
