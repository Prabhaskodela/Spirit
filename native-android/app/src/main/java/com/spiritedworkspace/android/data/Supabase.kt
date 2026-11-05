package com.spiritedworkspace.android.data

import com.spiritedworkspace.android.BuildConfig
import com.spiritedworkspace.android.SpiritApplication
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.FlowType
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.serializer.KotlinXSerializer
import io.github.jan.supabase.storage.Storage
import kotlinx.serialization.json.Json

object Supabase {
    val client by lazy {
        require(BuildConfig.SUPABASE_URL.startsWith("https://") && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()) {
            "Supabase is not configured. Check the existing repository config.js."
        }
        createSupabaseClient(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY) {
            defaultSerializer = KotlinXSerializer(Json {
                ignoreUnknownKeys = true
                encodeDefaults = true
                explicitNulls = false
            })
            install(Auth) {
                scheme = "spirithubnative"
                host = "auth"
                flowType = FlowType.PKCE
                alwaysAutoRefresh = true
                sessionManager = KeystoreSessionManager(SpiritApplication.instance)
            }
            install(Postgrest)
            install(Realtime)
            install(Storage)
            install(Functions)
        }
    }
}
