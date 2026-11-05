package com.spiritedworkspace.android

import android.graphics.RenderEffect as AndroidRenderEffect
import android.graphics.Shader
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.material.icons.rounded.AttachFile
import androidx.compose.material.icons.rounded.Collections
import androidx.compose.material.icons.rounded.Download
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.spiritedworkspace.android.data.Semester
import com.spiritedworkspace.android.data.SubjectChannel
import com.spiritedworkspace.android.data.Supabase
import com.spiritedworkspace.android.data.Workspace
import com.spiritedworkspace.android.data.WorkspaceRepository
import com.spiritedworkspace.android.data.ChatMessage
import com.spiritedworkspace.android.data.MemberProfile
import com.spiritedworkspace.android.data.HubFile
import com.spiritedworkspace.android.data.MemoryPhoto
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.handleDeeplinks
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CoroutineScope

private val Ink = Color(0xFF101116)
private val Panel = Color(0xFF191A23)
private val Muted = Color(0xFFA7A5B5)
private val Lavender = Color(0xFFB9A0FF)
private val Rose = Color(0xFFFF8EA9)
private val Gold = Color(0xFFF4D689)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        runCatching { Supabase.client.handleDeeplinks(intent) }
        enableEdgeToEdge()
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        window.navigationBarColor = android.graphics.Color.TRANSPARENT
        window.decorView.setBackgroundColor(android.graphics.Color.rgb(16, 17, 22))
        setContent { SpiritTheme { SpiritRoot() } }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        runCatching { Supabase.client.handleDeeplinks(intent) }
    }
}

private sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState
    data class SignedIn(val email: String?) : SessionState
}

private class SpiritViewModel : ViewModel() {
    private val repo = WorkspaceRepository()
    private val _session = MutableStateFlow<SessionState>(SessionState.Loading)
    val session = _session.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy = _busy.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()
    private val _workspaces = MutableStateFlow<List<Workspace>>(emptyList())
    val workspaces = _workspaces.asStateFlow()
    private val _semesters = MutableStateFlow<List<Semester>>(emptyList())
    val semesters = _semesters.asStateFlow()
    private val _channels = MutableStateFlow<List<SubjectChannel>>(emptyList())
    val channels = _channels.asStateFlow()
    private val _profiles = MutableStateFlow<Map<String, MemberProfile>>(emptyMap())
    val profiles = _profiles.asStateFlow()
    private val _files = MutableStateFlow<List<HubFile>>(emptyList())
    val files = _files.asStateFlow()
    private val _memories = MutableStateFlow<List<MemoryPhoto>>(emptyList())
    val memories = _memories.asStateFlow()
    private var loadedUserId: String? = null

    init {
        viewModelScope.launch {
            try {
                Supabase.client.auth.sessionStatus.collect { status ->
                    when (status) {
                        SessionStatus.Initializing -> _session.value = SessionState.Loading
                        is SessionStatus.Authenticated -> {
                            _session.value = SessionState.SignedIn(status.session.user?.email)
                            val userId = status.session.user?.id
                            if (userId != null && userId != loadedUserId) {
                                loadedUserId = userId
                                loadWorkspaces()
                                loadProfiles()
                            }
                        }
                        is SessionStatus.NotAuthenticated -> _session.value = SessionState.SignedOut
                        is SessionStatus.RefreshFailure -> {
                            if (Supabase.client.auth.currentSessionOrNull() == null) _session.value = SessionState.SignedOut
                        }
                    }
                }
            } catch (error: Throwable) {
                _message.value = error.message?.take(240) ?: "Couldn't restore your sign-in."
                _session.value = SessionState.SignedOut
            }
        }
    }

    fun signIn(email: String, password: String) = authAction {
        Supabase.client.auth.signInWith(Email) { this.email = email.trim(); this.password = password }
        signedIn()
    }

    fun signUp(email: String, password: String) = authAction {
        Supabase.client.auth.signUpWith(Email) { this.email = email.trim(); this.password = password }
        if (Supabase.client.auth.currentSessionOrNull() != null) signedIn()
        else _message.value = "Account created. Check your email to finish signing in."
    }

    fun signInGoogle() = authAction {
        Supabase.client.auth.signInWith(Google)
    }

    private suspend fun signedIn() {
        val email = Supabase.client.auth.currentSessionOrNull()?.user?.email
        _session.value = SessionState.SignedIn(email)
        loadedUserId = Supabase.client.auth.currentSessionOrNull()?.user?.id
        loadWorkspaces()
        loadProfiles()
    }

    private fun authAction(action: suspend () -> Unit) {
        viewModelScope.launch {
            _busy.value = true
            _message.value = null
            try { action() } catch (e: Throwable) {
                _message.value = e.message?.take(240) ?: "Couldn't complete that request. Try again."
            } finally { _busy.value = false }
        }
    }

    fun loadWorkspaces() = viewModelScope.launch {
        _message.value = null
        runCatching { repo.workspaces() }
            .onSuccess { _workspaces.value = it }
            .onFailure { _message.value = it.message?.take(240) ?: "Couldn't load workspaces." }
    }

    fun messages(channelId: String): Flow<List<ChatMessage>> = repo.messages(channelId)

    fun loadFiles(channelId: String) = viewModelScope.launch {
        runCatching { repo.files(channelId) }.onSuccess { _files.value = it.sortedByDescending(HubFile::createdAt) }
            .onFailure { _message.value = it.message?.take(240) ?: "Couldn't load files." }
    }

    fun loadMemories(workspaceId: String) = viewModelScope.launch {
        runCatching { repo.memories(workspaceId) }.onSuccess { _memories.value = it.sortedByDescending(MemoryPhoto::createdAt) }
            .onFailure { _message.value = it.message?.take(240) ?: "Couldn't load memories." }
    }

    fun uploadFile(workspace: Workspace, channel: SubjectChannel, name: String, mime: String, bytes: ByteArray) = viewModelScope.launch {
        _busy.value = true
        runCatching { repo.uploadFile(workspace.id, channel.id, name, mime, bytes) }
            .onSuccess { item -> _files.value = listOf(item) + _files.value; sendMessage(workspace.id, channel.id, "", item.id) }
            .onFailure { _message.value = it.message?.take(240) ?: "Couldn't upload this file." }
            .also { _busy.value = false }
    }

    fun uploadPickedFile(context: Context, uri: Uri, workspace: Workspace, channel: SubjectChannel) = viewModelScope.launch {
        _busy.value = true
        runCatching {
            val picked = withContext(Dispatchers.IO) { readPickedFile(context, uri) }
            repo.uploadFile(workspace.id, channel.id, picked.name, picked.mime, picked.bytes)
        }.onSuccess { item ->
            _files.value = listOf(item) + _files.value
            sendMessage(workspace.id, channel.id, "", item.id)
        }.onFailure { _message.value = it.message?.take(240) ?: "Couldn't upload this file." }
        _busy.value = false
    }

    fun uploadMemory(workspace: Workspace, name: String, mime: String, bytes: ByteArray) = viewModelScope.launch {
        _busy.value = true
        runCatching { repo.uploadMemory(workspace.id, name, mime, bytes) }
            .onSuccess { _memories.value = listOf(it) + _memories.value }
            .onFailure { _message.value = it.message?.take(240) ?: "Couldn't upload this photo." }
            .also { _busy.value = false }
    }

    fun uploadPickedMemory(context: Context, uri: Uri, workspace: Workspace) = viewModelScope.launch {
        _busy.value = true
        runCatching {
            val picked = withContext(Dispatchers.IO) { readPickedFile(context, uri) }
            repo.uploadMemory(workspace.id, picked.name, picked.mime, picked.bytes)
        }.onSuccess { _memories.value = listOf(it) + _memories.value }
            .onFailure { _message.value = it.message?.take(240) ?: "Couldn't upload this photo." }
        _busy.value = false
    }

    suspend fun download(path: String): ByteArray = repo.download(path)

    fun loadProfiles() = viewModelScope.launch {
        runCatching { repo.profiles() }.onSuccess { rows -> _profiles.value = rows.associateBy(MemberProfile::id) }
    }

    fun sendMessage(workspaceId: String, channelId: String, body: String, fileId: String? = null) = viewModelScope.launch {
        val text = body.trim()
        if ((text.isEmpty() && fileId == null) || text.length > 4000) return@launch
        _message.value = null
        runCatching { repo.sendMessage(workspaceId, channelId, text, fileId) }
            .onFailure { _message.value = it.message?.take(240) ?: "Couldn't send the message." }
    }

    fun loadSemesters(workspaceId: String) = viewModelScope.launch {
        _semesters.value = emptyList(); _channels.value = emptyList(); _message.value = null
        runCatching { repo.semesters(workspaceId) }
            .onSuccess { _semesters.value = it.sortedBy(Semester::position) }
            .onFailure { _message.value = it.message?.take(240) ?: "Couldn't load semesters." }
    }

    fun loadChannels(semesterId: String) = viewModelScope.launch {
        _channels.value = emptyList(); _message.value = null
        runCatching { repo.channels(semesterId) }
            .onSuccess { _channels.value = it }
            .onFailure { _message.value = it.message?.take(240) ?: "Couldn't load subjects." }
    }

    fun signOut() = viewModelScope.launch {
        runCatching { Supabase.client.auth.signOut() }
        _session.value = SessionState.SignedOut
        loadedUserId = null
        _workspaces.value = emptyList(); _semesters.value = emptyList(); _channels.value = emptyList()
        _profiles.value = emptyMap()
        _files.value = emptyList(); _memories.value = emptyList()
    }

    fun clearMessage() { _message.value = null }
    fun showError(message: String) { _message.value = message.take(240) }
}

private data class PickedFile(val name: String, val mime: String, val bytes: ByteArray)
private data class PreviewFile(val name: String, val mime: String, val bytes: ByteArray)

private fun readPickedFile(context: Context, uri: Uri): PickedFile {
    val resolver = context.contentResolver
    val mime = resolver.getType(uri) ?: "application/octet-stream"
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    } ?: "upload"
    val bytes = resolver.openInputStream(uri)?.use { stream ->
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        var total = 0
        while (true) {
            val count = stream.read(buffer)
            if (count < 0) break
            total += count
            require(total <= 50 * 1024 * 1024) { "Files must be 50 MB or smaller." }
            out.write(buffer, 0, count)
        }
        out.toByteArray()
    } ?: error("Couldn't read the selected file.")
    return PickedFile(name, mime, bytes)
}

@Composable
private fun SpiritRoot(vm: SpiritViewModel = viewModel()) {
    val session by vm.session.collectAsState()
    var bootVisible by remember { mutableStateOf(true) }
    var bootExiting by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(3000); bootExiting = true; delay(600); bootVisible = false }
    Box(Modifier.fillMaxSize().background(Ink)) {
        when (val current = session) {
            SessionState.Loading -> Unit
            SessionState.SignedOut -> SignInScreen(vm)
            is SessionState.SignedIn -> WorkspaceHome(vm, current.email)
        }
        if (bootVisible) {
            val alpha = androidx.compose.animation.core.animateFloatAsState(
                targetValue = if (bootExiting) 0f else 1f, animationSpec = tween(580, easing = CubicBezierEasing(.2f, .7f, .2f, 1f)), label = "boot-exit"
            ).value
            OriginalBoot(Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha })
        }
    }
}

@Composable
private fun OriginalBoot(modifier: Modifier = Modifier) {
    var imageStarted by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { withFrameNanos { }; imageStarted = true }
    val transition = rememberInfiniteTransition(label = "boot-aura")
    val auraScale = transition.animateFloat(.86f, 1.08f, infiniteRepeatable(tween(1200), RepeatMode.Reverse), label = "aura-scale").value
    val auraAlpha = transition.animateFloat(.55f, 1f, infiniteRepeatable(tween(1200), RepeatMode.Reverse), label = "aura-alpha").value
    val auraBlurPx = with(LocalDensity.current) { 34.dp.toPx() }
    val scale = androidx.compose.animation.core.animateFloatAsState(if (imageStarted) 1f else .96f, keyframes {
        durationMillis = 1350
        .96f at 0
        1.012f at 878 using CubicBezierEasing(.2f, .75f, .3f, 1f)
        1f at 1350
    }, label = "original-image-scale").value
    val alpha = androidx.compose.animation.core.animateFloatAsState(if (imageStarted) 1f else 0f, keyframes {
        durationMillis = 1350
        0f at 0
        1f at 878 using CubicBezierEasing(.2f, .75f, .3f, 1f)
        1f at 1350
    }, label = "original-image-alpha").value
    Box(modifier.background(Brush.radialGradient(listOf(Color(0xFF211A36), Color(0xFF09090D), Color.Black)))) {
        Canvas(Modifier.fillMaxSize().graphicsLayer {
            if (Build.VERSION.SDK_INT >= 31) renderEffect = AndroidRenderEffect.createBlurEffect(auraBlurPx, auraBlurPx, Shader.TileMode.CLAMP).asComposeRenderEffect()
        }) {
            val radius = size.minDimension * .37f * auraScale
            drawCircle(Brush.radialGradient(
                0f to Color(0x30A978FF).copy(alpha = (0x30 / 255f) * auraAlpha),
                .4f to Color(0x1AFF6DA8).copy(alpha = (0x1A / 255f) * auraAlpha),
                1f to Color.Transparent,
                center = center,
                radius = radius,
            ), radius = radius, center = center)
        }
        Image(
            painter = painterResource(R.drawable.boot_artwork),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize().graphicsLayer {
                this.alpha = alpha
                scaleX = scale; scaleY = scale
                blendMode = BlendMode.Screen
                compositingStrategy = CompositingStrategy.Offscreen
                if (Build.VERSION.SDK_INT >= 31) {
                    val blur = (1f - alpha) * 7f
                    renderEffect = if (blur > .05f) AndroidRenderEffect.createBlurEffect(blur, blur, Shader.TileMode.CLAMP).asComposeRenderEffect() else null
                }
            },
        )
    }
}

@Composable
private fun SignInScreen(vm: SpiritViewModel) {
    val busy by vm.busy.collectAsState()
    val message by vm.message.collectAsState()
    var registering by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars.union(WindowInsets.navigationBars)).imePadding().padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(15.dp)).background(Lavender.copy(.14f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.AutoAwesome, null, tint = Lavender)
            }
            Spacer(Modifier.width(12.dp))
            Text("SPIRITED WORKSPACE", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
        }
        Spacer(Modifier.height(30.dp))
        Text(if (registering) "Make space\nfor your people." else "Your study\nspace, together.", color = Color.White, fontSize = 38.sp, lineHeight = 42.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(10.dp))
        Text(if (registering) "Create an account to join your workspace." else "Sign in to pick up where your group left off.", color = Muted, fontSize = 15.sp)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("Email address") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), shape = RoundedCornerShape(16.dp))
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), shape = RoundedCornerShape(16.dp))
        if (message != null) { Spacer(Modifier.height(10.dp)); Text(message.orEmpty(), color = Rose, fontSize = 13.sp) }
        Spacer(Modifier.height(18.dp))
        Button(
            onClick = { if (registering) vm.signUp(email, password) else vm.signIn(email, password) },
            enabled = !busy && email.contains('@') && password.length >= 6,
            modifier = Modifier.fillMaxWidth().height(54.dp),
            shape = RoundedCornerShape(17.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Lavender, contentColor = Ink),
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(21.dp), color = Ink, strokeWidth = 2.dp)
            else Text(if (registering) "Create account" else "Sign in", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = vm::signInGoogle, enabled = !busy, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(17.dp)) {
            Text("Continue with Google", color = Color.White, fontWeight = FontWeight.Medium)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Text(if (registering) "Already have an account?" else "New to Spirited Workspace?", color = Muted, fontSize = 13.sp)
            TextButton(onClick = { registering = !registering; vm.clearMessage() }) { Text(if (registering) "Sign in" else "Create account", color = Lavender) }
        }
    }
}

@Composable
private fun WorkspaceHome(vm: SpiritViewModel, email: String?) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val workspaces by vm.workspaces.collectAsState()
    val semesters by vm.semesters.collectAsState()
    val channels by vm.channels.collectAsState()
    val profiles by vm.profiles.collectAsState()
    val message by vm.message.collectAsState()
    val files by vm.files.collectAsState()
    val memories by vm.memories.collectAsState()
    var selectedWorkspace by remember { mutableStateOf<Workspace?>(null) }
    var selectedSemester by remember { mutableStateOf<Semester?>(null) }
    var selectedChannel by remember { mutableStateOf<SubjectChannel?>(null) }
    var showMemories by remember { mutableStateOf(false) }
    var showFiles by remember { mutableStateOf(false) }
    var previewFile by remember { mutableStateOf<PreviewFile?>(null) }
    var pendingDownload by remember { mutableStateOf<HubFile?>(null) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val saveFilePicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val file = pendingDownload
        pendingDownload = null
        if (uri != null && file != null) scope.launch {
            runCatching {
                val bytes = withContext(Dispatchers.IO) { vm.download(file.path) }
                withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("Couldn't create the download file.") }
            }.onFailure { vm.showError(it.message ?: "Couldn't download this file.") }
        }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val workspace = selectedWorkspace; val channel = selectedChannel
        if (uri != null && workspace != null && channel != null) vm.uploadPickedFile(context, uri, workspace, channel)
    }
    val memoryPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val workspace = selectedWorkspace
        if (uri != null && workspace != null) vm.uploadPickedMemory(context, uri, workspace)
    }
    BackHandler(showMemories || showFiles || selectedWorkspace != null || selectedSemester != null || selectedChannel != null) {
        when {
            showMemories -> showMemories = false
            showFiles -> showFiles = false
            selectedChannel != null -> selectedChannel = null
            selectedSemester != null -> selectedSemester = null
            else -> { selectedWorkspace = null; vm.loadWorkspaces() }
        }
    }
    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars.union(WindowInsets.navigationBars)).imePadding().padding(horizontal = 18.dp)) {
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            if (selectedWorkspace != null) IconButton(onClick = {
                when {
                    showMemories -> showMemories = false
                    showFiles -> showFiles = false
                    selectedChannel != null -> selectedChannel = null
                    selectedSemester != null -> selectedSemester = null
                    else -> { selectedWorkspace = null; vm.loadWorkspaces() }
                }
            }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White) }
            else {
                Box(Modifier.size(42.dp).clip(RoundedCornerShape(14.dp)).background(Lavender.copy(.14f)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.AutoAwesome, null, tint = Lavender)
                }
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(if (showMemories) "Memories" else selectedChannel?.name ?: selectedSemester?.name ?: selectedWorkspace?.name ?: "Good to see you", color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (selectedWorkspace == null) email.orEmpty() else selectedChannel?.courseCode ?: "Workspace", color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (selectedWorkspace == null) IconButton(onClick = vm::signOut) { Icon(Icons.AutoMirrored.Rounded.Logout, "Sign out", tint = Muted) }
            else if (selectedSemester == null && selectedChannel == null && !showMemories) IconButton(onClick = { showMemories = true; vm.loadMemories(selectedWorkspace!!.id) }) {
                Icon(Icons.Rounded.Collections, "Memories", tint = Lavender)
            }
        }
        Spacer(Modifier.height(24.dp))
        when {
            showMemories && selectedWorkspace != null -> MemoriesView(memories, onAdd = {
                memoryPicker.launch(arrayOf("image/png", "image/jpeg", "image/webp", "image/gif"))
            }, onOpen = { photo ->
                scope.launch {
                    runCatching { vm.download(photo.path) }.onSuccess { previewFile = PreviewFile("Memory", photo.mime, it) }
                        .onFailure { vm.showError(it.message ?: "Couldn't open this photo.") }
                }
            }, modifier = Modifier.weight(1f).fillMaxWidth())
            selectedChannel != null && selectedWorkspace != null -> {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { showFiles = false }) { Text("Chat", color = if (!showFiles) Lavender else Muted) }
                    TextButton(onClick = { showFiles = true; vm.loadFiles(selectedChannel!!.id) }) { Text("Files", color = if (showFiles) Lavender else Muted) }
                }
                if (showFiles) FilesView(files, onAdd = {
                    filePicker.launch(arrayOf("application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"))
                }, onOpen = { file ->
                    scope.launch {
                        runCatching { vm.download(file.path) }.onSuccess { previewFile = PreviewFile(file.name, file.mime, it) }
                            .onFailure { vm.showError(it.message ?: "Couldn't open this file.") }
                    }
                }, onDownload = { file ->
                    pendingDownload = file
                    saveFilePicker.launch(file.name)
                }, modifier = Modifier.weight(1f).fillMaxWidth())
                else ChatView(vm, selectedWorkspace!!, selectedChannel!!, profiles, onAttach = {
                    filePicker.launch(arrayOf("application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"))
                }, modifier = Modifier.fillMaxWidth().weight(1f))
            }
            selectedWorkspace == null -> {
                SectionLabel("YOUR WORKSPACES")
                if (workspaces.isEmpty()) EmptyState("Your workspaces will show here", "Join one with an invite link or code from your group.", Icons.Rounded.School)
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) { items(workspaces, key = Workspace::id) { item ->
                    NativeCard(item.name, item.academicYear ?: "Open workspace", Icons.Rounded.School) { selectedWorkspace = item; vm.loadSemesters(item.id) }
                } }
            }
            selectedSemester == null -> {
                SectionLabel("SEMESTERS")
                if (semesters.isEmpty()) EmptyState("No semesters yet", "Workspace admins can add semesters in workspace settings.", Icons.Rounded.School)
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) { items(semesters, key = Semester::id) { item ->
                    NativeCard(item.name, "Subjects and shared files", Icons.Rounded.FolderOpen) { selectedSemester = item; vm.loadChannels(item.id) }
                } }
            }
            else -> {
                SectionLabel("SUBJECTS")
                if (channels.isEmpty()) EmptyState("No subjects yet", "Workspace admins can add subjects to this semester.", Icons.Rounded.ChatBubbleOutline)
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) { items(channels, key = SubjectChannel::id) { item ->
                    NativeCard(item.name, item.courseCode ?: "Subject channel", Icons.Rounded.ChatBubbleOutline) { selectedChannel = item }
                } }
            }
        }
        if (message != null) { Spacer(Modifier.height(10.dp)); Text(message.orEmpty(), color = Rose, fontSize = 13.sp) }
    }
    previewFile?.let { file -> NativeFilePreview(file) { previewFile = null } }
}

@Composable
private fun ChatView(
    vm: SpiritViewModel,
    workspace: Workspace,
    channel: SubjectChannel,
    profiles: Map<String, MemberProfile>,
    onAttach: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val stream = remember(channel.id) { vm.messages(channel.id) }
    val messages by stream.collectAsState(initial = emptyList())
    var draft by remember(channel.id) { mutableStateOf("") }
    val listState = rememberLazyListState()
    val ordered = remember(messages) { messages.sortedByDescending(ChatMessage::createdAt) }

    Column(modifier.fillMaxSize()) {
        if (ordered.isEmpty()) {
            EmptyState("Start the conversation", "Messages in this subject appear here for everyone in your workspace.", Icons.Rounded.ChatBubbleOutline)
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                state = listState,
                reverseLayout = true,
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
            ) {
                items(ordered, key = ChatMessage::id) { item ->
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Panel).padding(horizontal = 14.dp, vertical = 10.dp)) {
                        Text(profiles[item.userId]?.displayName ?: "Classmate", color = Lavender, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                        Spacer(Modifier.height(4.dp))
                        SelectionContainer { Text(item.body, color = Color.White, fontSize = 15.sp, lineHeight = 21.sp) }
                    }
                }
            }
        }
        Surface(color = Panel, shape = RoundedCornerShape(22.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp)) {
            Row(Modifier.padding(start = 16.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onAttach) { Icon(Icons.Rounded.AttachFile, "Attach file", tint = Muted) }
                BasicTextField(
                    value = draft,
                    onValueChange = { if (it.length <= 4000) draft = it },
                    modifier = Modifier.weight(1f).padding(vertical = 13.dp),
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = Color.White),
                    singleLine = false,
                    maxLines = 4,
                    decorationBox = { inner ->
                        Box {
                            if (draft.isEmpty()) Text("Message ${channel.name}…", color = Muted)
                            inner()
                        }
                    },
                )
                IconButton(onClick = { vm.sendMessage(workspace.id, channel.id, draft); draft = "" }, enabled = draft.isNotBlank()) {
                    Icon(Icons.Rounded.Send, "Send message", tint = if (draft.isNotBlank()) Lavender else Muted)
                }
            }
        }
    }
}

@Composable
private fun FilesView(files: List<HubFile>, onAdd: () -> Unit, onOpen: (HubFile) -> Unit, onDownload: (HubFile) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                SectionLabel("SUBJECT FILES")
                Text("PDFs and shared images", color = Muted, fontSize = 12.sp)
            }
            TextButton(onClick = onAdd) { Icon(Icons.Rounded.AttachFile, null); Text("Add") }
        }
        if (files.isEmpty()) EmptyState("No shared files", "Add a PDF or image for this subject.", Icons.Rounded.FolderOpen)
        else LazyColumn(verticalArrangement = Arrangement.spacedBy(9.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
            items(files, key = HubFile::id) { file ->
                Surface(color = Panel, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).padding(vertical = 14.dp).clickable { onOpen(file) }) {
                            Text(file.name, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${file.mime} · ${file.size / 1024} KB", color = Muted, fontSize = 12.sp)
                        }
                        IconButton(onClick = { onDownload(file) }) { Icon(Icons.Rounded.Download, "Download ${file.name}", tint = Lavender) }
                    }
                }
            }
        }
    }
}

@Composable
private fun MemoriesView(memories: List<MemoryPhoto>, onAdd: () -> Unit, onOpen: (MemoryPhoto) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                SectionLabel("WORKSPACE MEMORIES")
                Text("Photos shared with your workspace", color = Muted, fontSize = 12.sp)
            }
            TextButton(onClick = onAdd) { Icon(Icons.Rounded.Collections, null); Text("Add photo") }
        }
        if (memories.isEmpty()) EmptyState("No memories yet", "Add the first photo for this workspace.", Icons.Rounded.Collections)
        else LazyColumn(verticalArrangement = Arrangement.spacedBy(9.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
            items(memories, key = MemoryPhoto::id) { memory ->
                NativeCard(memory.caption.ifBlank { "Workspace photo" }, "${memory.mime} · ${memory.size / 1024} KB", Icons.Rounded.Collections) { onOpen(memory) }
            }
        }
    }
}

private class PdfPageProvider(context: Context, bytes: ByteArray) : AutoCloseable {
    private val file = java.io.File.createTempFile("spirit-preview-", ".pdf", context.cacheDir).apply { writeBytes(bytes) }
    val pageCount: Int = openRenderer().use { it.pageCount }

    private fun openRenderer(): PdfRenderer {
        val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        return PdfRenderer(descriptor)
    }

    fun render(index: Int, maxWidth: Int): Bitmap {
        openRenderer().use { renderer ->
            renderer.openPage(index).use { page ->
                val width = minOf(maxWidth, 1800).coerceAtLeast(480)
                val height = (width * page.height.toFloat() / page.width).toInt().coerceAtLeast(1)
                return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { bitmap ->
                    bitmap.eraseColor(android.graphics.Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                }
            }
        }
    }

    override fun close() { file.delete() }
}

@Composable
private fun NativeFilePreview(file: PreviewFile, onClose: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var pdfProvider by remember(file) { mutableStateOf<PdfPageProvider?>(null) }
    var imageBitmap by remember(file) { mutableStateOf<Bitmap?>(null) }
    var error by remember(file) { mutableStateOf<String?>(null) }
    val density = LocalDensity.current
    val width = with(density) { androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp.dp.roundToPx() }
    LaunchedEffect(file) {
        try {
            withContext(Dispatchers.IO) {
                if (file.mime == "application/pdf") {
                    pdfProvider = PdfPageProvider(context, file.bytes)
                } else {
                    val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    android.graphics.BitmapFactory.decodeByteArray(file.bytes, 0, file.bytes.size, options)
                    var sample = 1
                    while (options.outWidth / (sample * 2) >= width * 2 && options.outHeight / (sample * 2) >= 600) sample *= 2
                    imageBitmap = android.graphics.BitmapFactory.decodeByteArray(file.bytes, 0, file.bytes.size,
                        android.graphics.BitmapFactory.Options().apply { inSampleSize = sample })
                }
            }
        } catch (e: Throwable) { error = e.message ?: "This file couldn't be previewed." }
    }
    DisposableEffect(pdfProvider) { onDispose { pdfProvider?.close() } }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Ink).windowInsetsPadding(WindowInsets.statusBars.union(WindowInsets.navigationBars))) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Close preview", tint = Color.White) }
                Text(file.name, Modifier.weight(1f), color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (file.mime == "application/pdf") "PDF" else "IMAGE", color = Lavender, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
            when {
                error != null -> EmptyState("Preview unavailable", error.orEmpty(), Icons.Rounded.FolderOpen)
                file.mime == "application/pdf" && pdfProvider == null || file.mime != "application/pdf" && imageBitmap == null ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Lavender) }
                file.mime == "application/pdf" -> {
                    val provider = pdfProvider!!
                    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(provider.pageCount, key = { it }) { index -> PdfPageImage(provider, index, width) }
                    }
                }
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    Image(imageBitmap!!.asImageBitmap(), file.name, Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth)
                }
            }
        }
    }
}

@Composable
private fun PdfPageImage(provider: PdfPageProvider, index: Int, width: Int) {
    var pageBitmap by remember(provider, index) { mutableStateOf<Bitmap?>(null) }
    var scale by remember(provider, index) { mutableStateOf(1f) }
    var offsetX by remember(provider, index) { mutableStateOf(0f) }
    var offsetY by remember(provider, index) { mutableStateOf(0f) }
    val transform = rememberTransformableState { zoom, pan, _ ->
        scale = (scale * zoom).coerceIn(1f, 4f)
        if (scale > 1f) { offsetX += pan.x; offsetY += pan.y } else { offsetX = 0f; offsetY = 0f }
    }
    LaunchedEffect(provider, index, width) { pageBitmap = withContext(Dispatchers.IO) { provider.render(index, width * 2) } }
    if (pageBitmap == null) Box(Modifier.fillMaxWidth().height(420.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Lavender) }
    else Image(
        bitmap = pageBitmap!!.asImageBitmap(), contentDescription = "Page ${index + 1}",
        contentScale = ContentScale.FillWidth,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp).graphicsLayer { scaleX = scale; scaleY = scale; translationX = offsetX; translationY = offsetY }
            .transformable(transform, canPan = { scale > 1f }),
    )
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, Modifier.padding(bottom = 12.dp), color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
}

@Composable
private fun NativeCard(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Surface(onClick = onClick, color = Panel, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(Gold.copy(.12f)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = Gold) }
            Spacer(Modifier.width(13.dp))
            Column(Modifier.weight(1f)) {
                Text(title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(3.dp)); Text(subtitle, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
        }
    }
}

@Composable
private fun EmptyState(title: String, body: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Column(Modifier.fillMaxWidth().padding(vertical = 42.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(Lavender.copy(.12f)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = Lavender, modifier = Modifier.size(28.dp)) }
        Spacer(Modifier.height(16.dp)); Text(title, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp)); Text(body, color = Muted, fontSize = 13.sp, lineHeight = 19.sp)
    }
}

@Composable
private fun SpiritTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = darkColorScheme(primary = Lavender, onPrimary = Ink, secondary = Rose, background = Ink, surface = Panel, onSurface = Color.White, onBackground = Color.White), content = content)
}
