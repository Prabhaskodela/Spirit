package com.spiritedworkspace.android.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.spiritedworkspace.android.SpiritApplication
import io.github.jan.supabase.auth.SessionManager
import io.github.jan.supabase.auth.exception.NoSessionFoundException
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Stores only AES-GCM ciphertext in app preferences; the AES key never leaves Android Keystore. */
class KeystoreSessionManager(private val app: SpiritApplication) : SessionManager {
    private val prefs = app.getSharedPreferences("native_auth_session", 0)
    private val json = Json { encodeDefaults = true; ignoreUnknownKeys = true }

    override suspend fun saveSession(session: UserSession) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.iv + cipher.doFinal(json.encodeToString(session).toByteArray(StandardCharsets.UTF_8))
        check(prefs.edit().putString(SESSION_KEY, Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) {
            "Couldn't save the sign-in session securely."
        }
    }

    override suspend fun loadSession(): UserSession {
        val encoded = prefs.getString(SESSION_KEY, null) ?: throw NoSessionFoundException()
        val packed = try { Base64.decode(encoded, Base64.NO_WRAP) } catch (_: IllegalArgumentException) {
            throw NoSessionFoundException()
        }
        if (packed.size <= IV_BYTES) throw NoSessionFoundException()
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, packed.copyOfRange(0, IV_BYTES)))
            json.decodeFromString(String(cipher.doFinal(packed.copyOfRange(IV_BYTES, packed.size)), StandardCharsets.UTF_8))
        } catch (error: Exception) {
            deleteSession()
            throw NoSessionFoundException()
        }
    }

    override suspend fun deleteSession() {
        prefs.edit().remove(SESSION_KEY).commit()
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build())
        return generator.generateKey()
    }

    private companion object {
        const val KEY_ALIAS = "spirithub.supabase.session.v1"
        const val SESSION_KEY = "encrypted_session"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}
