package com.spiritedworkspace.android.data

import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.realtime.selectAsFlow
import io.github.jan.supabase.storage.storage
import io.github.jan.supabase.annotations.SupabaseExperimental
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.time.Duration.Companion.minutes

@Serializable
data class Workspace(val id: String, val name: String, @SerialName("academic_year") val academicYear: String? = null)

@Serializable
data class Semester(val id: String, @SerialName("workspace_id") val workspaceId: String, val name: String, val position: Int? = null)

@Serializable
data class SubjectChannel(val id: String, @SerialName("semester_id") val semesterId: String, val name: String, @SerialName("course_code") val courseCode: String? = null)

@Serializable
data class MemberProfile(val id: String, @SerialName("display_name") val displayName: String)

@Serializable
data class ChatMessage(
    val id: String,
    @SerialName("workspace_id") val workspaceId: String,
    @SerialName("channel_id") val channelId: String,
    @SerialName("user_id") val userId: String,
    val body: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("reply_to_id") val replyToId: String? = null,
    @SerialName("file_id") val fileId: String? = null,
    val kind: String = "text",
)

@Serializable
data class ChatMessageInsert(
    @SerialName("workspace_id") val workspaceId: String,
    @SerialName("channel_id") val channelId: String,
    val body: String,
    @SerialName("file_id") val fileId: String? = null,
)

@Serializable
data class HubFile(
    val id: String,
    @SerialName("workspace_id") val workspaceId: String,
    @SerialName("channel_id") val channelId: String,
    val name: String,
    val path: String,
    val mime: String,
    val size: Long,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class HubFileInsert(
    @SerialName("workspace_id") val workspaceId: String,
    @SerialName("channel_id") val channelId: String,
    val name: String,
    val path: String,
    val mime: String,
    val size: Long,
)

@Serializable
data class MemoryPhoto(
    val id: String,
    @SerialName("workspace_id") val workspaceId: String,
    val path: String,
    val mime: String,
    val size: Long,
    val caption: String = "",
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class MemoryInsert(
    @SerialName("workspace_id") val workspaceId: String,
    val path: String,
    val mime: String,
    val size: Long,
)

class WorkspaceRepository {
    suspend fun profiles(): List<MemberProfile> = Supabase.client.from("hub_profiles").select().decodeList()

    suspend fun workspaces(): List<Workspace> = Supabase.client.from("hub_workspaces").select().decodeList()

    suspend fun semesters(workspaceId: String): List<Semester> = Supabase.client.from("hub_semesters").select {
        filter { eq("workspace_id", workspaceId) }
    }.decodeList()

    suspend fun channels(semesterId: String): List<SubjectChannel> = Supabase.client.from("hub_channels").select {
        filter { eq("semester_id", semesterId) }
    }.decodeList()

    suspend fun files(channelId: String): List<HubFile> = Supabase.client.from("hub_files").select {
        filter { eq("channel_id", channelId) }
    }.decodeList()

    suspend fun memories(workspaceId: String): List<MemoryPhoto> = Supabase.client.from("hub_memories").select {
        filter { eq("workspace_id", workspaceId) }
    }.decodeList()

    suspend fun uploadFile(workspaceId: String, channelId: String, name: String, mime: String, bytes: ByteArray): HubFile {
        require(bytes.isNotEmpty() && bytes.size <= 50 * 1024 * 1024) { "Files must be between 1 byte and 50 MB." }
        require(mime in setOf("application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif")) { "This file type isn't supported." }
        val safe = name.replace(Regex("[^\\w.-]+"), "-").takeLast(80).ifBlank { "upload" }
        val path = "$workspaceId/$channelId/${java.util.UUID.randomUUID()}-$safe"
        Supabase.client.storage.from("hub-files").upload(path, bytes) { upsert = false }
        return try {
            Supabase.client.from("hub_files").insert(
                HubFileInsert(workspaceId, channelId, name.take(200), path, mime, bytes.size.toLong())
            ) { select() }.decodeSingle<HubFile>()
        } catch (error: Throwable) {
            runCatching { Supabase.client.storage.from("hub-files").delete(path) }
            throw error
        }
    }

    suspend fun uploadMemory(workspaceId: String, name: String, mime: String, bytes: ByteArray): MemoryPhoto {
        require(bytes.isNotEmpty() && bytes.size <= 50 * 1024 * 1024) { "Photos must be between 1 byte and 50 MB." }
        require(mime in setOf("image/png", "image/jpeg", "image/webp", "image/gif")) { "Choose a PNG, JPEG, WebP or GIF image." }
        val safe = name.replace(Regex("[^\\w.-]+"), "-").takeLast(80).ifBlank { "photo" }
        val path = "$workspaceId/memories/${java.util.UUID.randomUUID()}-$safe"
        Supabase.client.storage.from("hub-files").upload(path, bytes) { upsert = false }
        return try {
            Supabase.client.from("hub_memories").insert(MemoryInsert(workspaceId, path, mime, bytes.size.toLong())) {
                select()
            }.decodeSingle<MemoryPhoto>()
        } catch (error: Throwable) {
            runCatching { Supabase.client.storage.from("hub-files").delete(path) }
            throw error
        }
    }

    suspend fun download(path: String): ByteArray = Supabase.client.storage.from("hub-files").downloadAuthenticated(path)

    suspend fun signedUrl(path: String): String = Supabase.client.storage.from("hub-files").createSignedUrl(path, 30.minutes)

    @OptIn(SupabaseExperimental::class)
    fun messages(channelId: String): Flow<List<ChatMessage>> = Supabase.client.from("hub_messages").selectAsFlow(
        primaryKey = ChatMessage::id,
        filter = { eq("channel_id", channelId) },
    )

    suspend fun sendMessage(workspaceId: String, channelId: String, body: String, fileId: String? = null) {
        Supabase.client.from("hub_messages").insert(ChatMessageInsert(workspaceId, channelId, body.trim(), fileId))
    }
}
