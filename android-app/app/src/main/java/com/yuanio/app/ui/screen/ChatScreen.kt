package com.yuanio.app.ui.screen

import android.Manifest
import android.content.Intent
import android.content.res.Configuration
import android.content.ClipboardManager
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.text.format.DateFormat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.yuanio.app.ui.model.ToolCallStatus
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yuanio.app.R
import com.yuanio.app.data.ComposerDraftStore
import com.yuanio.app.data.ComposerStyle
import com.yuanio.app.data.ComposerStylePrefs
import com.yuanio.app.data.ConnectionMode
import com.yuanio.app.data.FeaturePrefs
import com.yuanio.app.data.MessageExporter
import com.yuanio.app.data.OnDeviceTranslationEngine
import com.yuanio.app.data.PromptDetector
import com.yuanio.app.data.TemplateStore
import com.yuanio.app.data.TranslateDirection
import com.yuanio.app.data.UriFileUtils
import com.yuanio.app.data.VoiceInputPrefs
import com.yuanio.app.ui.chat.AgentStatusBar
import com.yuanio.app.ui.chat.ChatDialogs
import com.yuanio.app.ui.chat.ChatInputBar
import com.yuanio.app.ui.chat.InputBarState
import com.yuanio.app.ui.chat.ChatMessageList
import com.yuanio.app.ui.chat.ChatTopBar
import com.yuanio.app.ui.chat.ConnectionBanner
import com.yuanio.app.ui.chat.MessageListCallbacks
import com.yuanio.app.ui.chat.QuickReplyRow
import com.yuanio.app.ui.chat.TemplateChipRow
import com.yuanio.app.ui.component.ApprovalCard
import com.yuanio.app.ui.component.DiffPanel
import com.yuanio.app.ui.component.SplitPaneLayout
import com.yuanio.app.ui.component.DiffPanelItem
import com.yuanio.app.ui.component.TerminalView
import com.yuanio.app.ui.common.resolve
import com.yuanio.app.ui.model.ChatItem
import java.io.File
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    onNavigateSessions: () -> Unit = {},
    onNavigateFiles: () -> Unit = {},
    onNavigateTerminal: () -> Unit = {},
    onNewSession: () -> Unit = {},
    requestedSessionId: String? = null,
    vm: ChatViewModel = viewModel()
) {
    val fileVm: FileManagerViewModel = viewModel()
    val uiState by vm.uiState.collectAsStateWithLifecycle()
    val chatItems by vm.items.collectAsStateWithLifecycle()
    val filteredItems by vm.filteredItems.collectAsStateWithLifecycle(initialValue = emptyList())
    val urgentApproval by vm.urgentApproval.collectAsStateWithLifecycle()
    val vibingMessage by vm.vibingMessage.collectAsStateWithLifecycle()
    val toastMsg by vm.toast.collectAsStateWithLifecycle()
    val pendingDraftCount by vm.pendingDraftCount.collectAsStateWithLifecycle()
    val safeApprovalCount by vm.safeApprovalCount.collectAsStateWithLifecycle()
    val pendingApprovalQueue by vm.pendingApprovalQueue.collectAsStateWithLifecycle()
    val turnState by vm.turnState.collectAsStateWithLifecycle()
    val replayState by vm.replayState.collectAsStateWithLifecycle()
    val foregroundProbe by vm.foregroundProbe.collectAsStateWithLifecycle()
    val sessionControl by vm.sessionControl.collectAsStateWithLifecycle()
    val approvalUndoState by vm.approvalUndoState.collectAsStateWithLifecycle()
    val preferredConnectionMode by vm.preferredConnectionMode.collectAsStateWithLifecycle()
    val recoveryIssues by vm.recoveryIssues.collectAsStateWithLifecycle()
    val recentCommands by vm.recentCommands.collectAsStateWithLifecycle()
    val handoffRequest by vm.handoffRequest.collectAsStateWithLifecycle()
    val viewSessionId by vm.viewSessionId.collectAsStateWithLifecycle()
    val quickUploadState by fileVm.uploadState.collectAsStateWithLifecycle()
    val quickUploadError by fileVm.error.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val haptic = LocalHapticFeedback.current
    val focusRequester = remember { FocusRequester() }
    val snackbarHost = remember { SnackbarHostState() }
    val approvalActionApprove = stringResource(R.string.notifier_action_approve)
    val approvalActionReject = stringResource(R.string.notifier_action_reject)
    val commonUndoLabel = stringResource(R.string.common_undo)
    val approvalQueuedTemplate = stringResource(R.string.chat_approval_queued)
    val quickTitleScenario = stringResource(R.string.chat_quick_title_scenario)
    val quickTitleProject = stringResource(R.string.chat_quick_title_project)
    val quickTitleRecentCommands = stringResource(R.string.chat_quick_title_recent_commands)
    val quickTitleSmartReplies = stringResource(R.string.chat_quick_title_smart_replies)
    val quickProjectStatus = stringResource(R.string.chat_quick_project_status)
    val quickRunTasks = stringResource(R.string.chat_quick_run_tasks)
    val quickApprovalList = stringResource(R.string.chat_quick_approval_list)
    val quickRecentTasks = stringResource(R.string.chat_quick_recent_tasks)
    val quickSwitchProjectRoot = stringResource(R.string.chat_quick_switch_project_root)
    val quickProbe = stringResource(R.string.chat_quick_probe)
    val quickViewStatus = stringResource(R.string.chat_quick_view_status)
    val quickApprovalQueue = stringResource(R.string.chat_quick_approval_queue)
    val quickApproveLatest = stringResource(R.string.chat_quick_approve_latest)
    val quickRejectLatest = stringResource(R.string.chat_quick_reject_latest)
    val quickRecentHistory = stringResource(R.string.chat_quick_recent_history)
    val quickTaskOutput = stringResource(R.string.chat_quick_task_output)
    val quickCommandHelp = stringResource(R.string.chat_quick_command_help)
    val quickContext = stringResource(R.string.chat_quick_context)
    val composerDraftStore = remember(context) { ComposerDraftStore(context) }
    val clipboardManager = remember(context) {
        context.getSystemService(ClipboardManager::class.java)
    }
    val urlPreviewClient = remember {
        OkHttpClient.Builder()
            .callTimeout(3, TimeUnit.SECONDS)
            .build()
    }

    var input by rememberSaveable { mutableStateOf("") }
    var templates by remember { mutableStateOf(TemplateStore.getAll()) }
    var showTemplateDialog by remember { mutableStateOf(false) }
    var showAutoPilotDialog by remember { mutableStateOf(false) }
    var showApprovalQueue by rememberSaveable { mutableStateOf(false) }
    var showTimeline by rememberSaveable { mutableStateOf(false) }
    var diffPanelExpanded by rememberSaveable { mutableStateOf(true) }
    var jumpToIndex by rememberSaveable { mutableStateOf<Int?>(null) }
    var editingMessageId by rememberSaveable { mutableStateOf<String?>(null) }
    var markdownPreview by rememberSaveable { mutableStateOf(false) }
    var runtimeDetailsExpanded by rememberSaveable { mutableStateOf(false) }
    var selectedQuickReplyGroup by rememberSaveable { mutableStateOf(QUICK_GROUP_SCENARIO) }
    var voiceDraftText by rememberSaveable { mutableStateOf<String?>(null) }
    var draftReadySessionId by remember { mutableStateOf<String?>(null) }
    val slashSuggestions by remember(input) {
        derivedStateOf { vm.slashCommandSuggestions(input) }
    }
    val quickReplies by remember {
        derivedStateOf {
            val last = chatItems.lastOrNull()
            if (last is ChatItem.Text && last.role == "ai") PromptDetector.detect(last.content) else emptyList()
        }
    }
    val recentCommandReplies by remember(recentCommands) {
        derivedStateOf {
            recentCommands.take(6).map { command ->
                PromptDetector.QuickReply(command, command)
            }
        }
    }
    val projectShortcuts by remember(uiState.agentState.projectPath) {
        derivedStateOf {
            val path = uiState.agentState.projectPath?.takeIf { it.isNotBlank() }
            val items = mutableListOf(
                PromptDetector.QuickReply(quickProjectStatus, "/status"),
                PromptDetector.QuickReply(quickRunTasks, "/tasks"),
                PromptDetector.QuickReply(quickApprovalList, "/approvals"),
                PromptDetector.QuickReply(quickRecentTasks, "/history 10"),
            )
            if (path != null) {
                items.add(0, PromptDetector.QuickReply(quickSwitchProjectRoot, "/cwd $path"))
            }
            items
        }
    }
    val scenarioReplies by remember(
        turnState.phase,
        turnState.pendingApprovals,
        turnState.runningTasks,
        uiState.connState,
        uiState.agentState.status,
        vm.shellMode,
    ) {
        derivedStateOf {
            buildScenarioQuickReplies(
                turnState = turnState,
                connState = uiState.connState,
                shellMode = vm.shellMode,
                quickProbe = quickProbe,
                quickViewStatus = quickViewStatus,
                quickApprovalList = quickApprovalList,
                quickApprovalQueue = quickApprovalQueue,
                quickApproveLatest = quickApproveLatest,
                quickRejectLatest = quickRejectLatest,
                quickRunTasks = quickRunTasks,
                quickRecentHistory = quickRecentHistory,
                quickTaskOutput = quickTaskOutput,
                quickCommandHelp = quickCommandHelp,
                quickContext = quickContext,
                quickRecentTasks = quickRecentTasks,
            )
        }
    }
    val quickReplyGroups by remember(
        scenarioReplies,
        projectShortcuts,
        recentCommandReplies,
        quickReplies,
    ) {
        derivedStateOf {
            listOf(
                QuickReplyGroup(QUICK_GROUP_SCENARIO, quickTitleScenario, scenarioReplies),
                QuickReplyGroup(QUICK_GROUP_PROJECT, quickTitleProject, projectShortcuts),
                QuickReplyGroup(QUICK_GROUP_RECENT, quickTitleRecentCommands, recentCommandReplies),
                QuickReplyGroup(QUICK_GROUP_SMART, quickTitleSmartReplies, quickReplies),
            ).filter { it.replies.isNotEmpty() }
        }
    }
    LaunchedEffect(quickReplyGroups.map { it.key }) {
        if (quickReplyGroups.none { it.key == selectedQuickReplyGroup }) {
            selectedQuickReplyGroup = quickReplyGroups.firstOrNull()?.key ?: QUICK_GROUP_SCENARIO
        }
    }
    val activeQuickReplyGroup = quickReplyGroups.firstOrNull { it.key == selectedQuickReplyGroup }
        ?: quickReplyGroups.firstOrNull()
    val diffPanelItems by remember(chatItems) {
        derivedStateOf {
            chatItems
                .filterIsInstance<ChatItem.FileDiff>()
                .asReversed()
                .distinctBy { it.path }
                .take(6)
                .map { DiffPanelItem(path = it.path, diff = it.diff, action = it.action) }
        }
    }
    val timelineEntries by remember(chatItems) {
        derivedStateOf { buildTimelineEntries(chatItems) }
    }

    val voiceUnavailableMessage = stringResource(R.string.chat_voice_unavailable)
    val voicePermissionDeniedMessage = stringResource(R.string.chat_voice_permission_denied)
    val voiceStartFailedMessage = stringResource(R.string.chat_voice_start_failed)
    val voiceNoMatchMessage = stringResource(R.string.chat_voice_no_match)
    val voiceNetworkErrorMessage = stringResource(R.string.chat_voice_network_error)
    val voiceAudioErrorMessage = stringResource(R.string.chat_voice_audio_error)
    val voiceGenericErrorMessage = stringResource(R.string.chat_voice_generic_error)
    val chatUploadCameraCaptureFailedMessage = stringResource(R.string.chat_upload_camera_capture_failed)
    val chatUploadCameraPrepareFailedMessage = stringResource(R.string.chat_upload_camera_prepare_failed)
    val chatUploadInProgressMessage = stringResource(R.string.chat_upload_in_progress)
    val chatUploadDoneMessage = stringResource(R.string.chat_upload_done)
    val chatUploadAppendedTemplate = stringResource(R.string.chat_upload_reference_appended)
    val chatTranslateFailedMessage = stringResource(R.string.chat_translate_failed)
    val chatTranslateCommandEmptyMessage = stringResource(R.string.chat_translate_command_empty)
    val chatSmartPasteEmptyMessage = stringResource(R.string.chat_input_smart_paste_empty)
    val chatSmartPasteTooLongMessage = stringResource(R.string.chat_input_smart_paste_too_long)
    val chatSmartPasteLinkTemplate = stringResource(R.string.chat_input_smart_paste_link_template)
    val chatSmartPasteCodeWrappedMessage = stringResource(R.string.chat_input_smart_paste_code_wrapped)
    val chatEditStartedTemplate = stringResource(R.string.chat_input_editing_message_template)
    val chatEditSavedMessage = stringResource(R.string.chat_input_edit_saved)
    val chatEditNotAllowedMessage = stringResource(R.string.chat_input_edit_not_allowed)

    var voiceListening by remember { mutableStateOf(false) }
    var chatSplitPaneEnabled by remember { mutableStateOf(FeaturePrefs.chatSplitPaneEnabled) }
    var voicePartialText by remember { mutableStateOf<String?>(null) }
    var composerStyle by rememberSaveable { mutableStateOf(ComposerStylePrefs.style) }
    var voiceLanguageTag by rememberSaveable { mutableStateOf(VoiceInputPrefs.languageTag) }
    var voiceAutoSubmitDraft by rememberSaveable { mutableStateOf(VoiceInputPrefs.autoSubmitDraft) }
    var holdToTalkActive by remember { mutableStateOf(false) }
    var pendingVoiceStart by remember { mutableStateOf(false) }
    var pendingVoiceStartRequiresHold by remember { mutableStateOf(false) }
    var ignoreClientErrorOnce by remember { mutableStateOf(false) }
    var voiceTransientMessage by remember { mutableStateOf<String?>(null) }
    var uploadTransientMessage by remember { mutableStateOf<String?>(null) }
    var translationTransientMessage by remember { mutableStateOf<String?>(null) }
    var translatingInput by remember { mutableStateOf(false) }
    var pendingCameraUri by remember { mutableStateOf<Uri?>(null) }
    val coroutineScope = rememberCoroutineScope()
    var hasMicPermission by remember(context) {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    val speechRecognizerAvailable = remember(context) {
        SpeechRecognizer.isRecognitionAvailable(context)
    }
    val speechRecognizerHolder = remember { mutableStateOf<SpeechRecognizer?>(null) }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                chatSplitPaneEnabled = FeaturePrefs.chatSplitPaneEnabled
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    val speechIntent = remember {
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }
    }
    val applySpeechLanguagePreference = {
        if (voiceLanguageTag == "auto") {
            speechIntent.removeExtra(RecognizerIntent.EXTRA_LANGUAGE)
        } else {
            speechIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, voiceLanguageTag)
        }
    }
    val startVoiceListeningInternal = {
        applySpeechLanguagePreference()
        runCatching {
            voicePartialText = null
            ignoreClientErrorOnce = false
            speechRecognizerHolder.value?.startListening(speechIntent)
            voiceListening = true
        }.onFailure {
            voiceListening = false
            voicePartialText = null
            voiceTransientMessage = voiceStartFailedMessage
        }
    }
    val stopVoiceListeningInternal = {
        pendingVoiceStart = false
        pendingVoiceStartRequiresHold = false
        ignoreClientErrorOnce = true
        voiceListening = false
        voicePartialText = null
        runCatching { speechRecognizerHolder.value?.stopListening() }
    }

    val micPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasMicPermission = granted
        if (!granted) {
            pendingVoiceStart = false
            pendingVoiceStartRequiresHold = false
            voiceTransientMessage = voicePermissionDeniedMessage
            return@rememberLauncherForActivityResult
        }
        if (!pendingVoiceStart) {
            pendingVoiceStartRequiresHold = false
            return@rememberLauncherForActivityResult
        }
        val requiresHold = pendingVoiceStartRequiresHold
        pendingVoiceStart = false
        pendingVoiceStartRequiresHold = false
        if (requiresHold && !holdToTalkActive) {
            voicePartialText = null
            return@rememberLauncherForActivityResult
        }
        startVoiceListeningInternal()
    }
    val handleUploadCommit: (UploadCommitResult?) -> Unit = { commit ->
        val ref = commit?.promptRef ?: commit?.atPath ?: commit?.path
        if (!ref.isNullOrBlank()) {
            input = if (input.isBlank()) ref else "$input $ref"
            uploadTransientMessage = String.format(
                Locale.getDefault(),
                chatUploadAppendedTemplate,
                ref,
            )
        } else {
            uploadTransientMessage = chatUploadDoneMessage
        }
    }
    val uploadSelectedUri: (Uri, Boolean) -> Unit = { uri, persistReadPermission ->
        if (persistReadPermission) {
            runCatching {
                context.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            }
        }
        fileVm.uploadUri(uri, onDone = handleUploadCommit)
    }
    val quickUploadLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        uploadSelectedUri(uri, true)
    }
    val quickImageUploadLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        uploadSelectedUri(uri, false)
    }
    val quickCameraCaptureLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture()
    ) { success ->
        val uri = pendingCameraUri
        pendingCameraUri = null
        if (!success) return@rememberLauncherForActivityResult
        if (uri == null) {
            uploadTransientMessage = chatUploadCameraCaptureFailedMessage
            return@rememberLauncherForActivityResult
        }
        fileVm.uploadUri(uri, onDone = handleUploadCommit)
    }
    val createCameraCaptureUri: () -> Uri? = {
        runCatching {
            val dir = File(context.cacheDir, "shared-files")
            if (!dir.exists()) dir.mkdirs()
            val imageFile = File(dir, "capture_${System.currentTimeMillis()}.jpg")
            if (!imageFile.exists()) imageFile.createNewFile()
            UriFileUtils.toShareUri(context, imageFile)
        }.getOrNull()
    }

    androidx.compose.runtime.DisposableEffect(context, speechRecognizerAvailable) {
        if (!speechRecognizerAvailable) {
            voiceListening = false
            voicePartialText = null
            pendingVoiceStart = false
            pendingVoiceStartRequiresHold = false
            holdToTalkActive = false
            speechRecognizerHolder.value?.destroy()
            speechRecognizerHolder.value = null
            onDispose { }
        } else {
            val recognizer = SpeechRecognizer.createSpeechRecognizer(context)
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() {
                    voicePartialText = null
                }
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() {
                    voiceListening = false
                }

                override fun onError(error: Int) {
                    voiceListening = false
                    voicePartialText = null
                    if (ignoreClientErrorOnce && error == SpeechRecognizer.ERROR_CLIENT) {
                        ignoreClientErrorOnce = false
                        return
                    }
                    ignoreClientErrorOnce = false
                    voiceTransientMessage = when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH -> voiceNoMatchMessage
                        SpeechRecognizer.ERROR_NETWORK,
                        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> voiceNetworkErrorMessage
                        SpeechRecognizer.ERROR_AUDIO -> voiceAudioErrorMessage
                        else -> voiceGenericErrorMessage
                    }
                }

                override fun onResults(results: Bundle?) {
                    voiceListening = false
                    ignoreClientErrorOnce = false
                    voicePartialText = null
                    val text = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        ?.trim()
                    if (!text.isNullOrBlank()) {
                        if (voiceAutoSubmitDraft) {
                            vm.send(text)
                        } else {
                            voiceDraftText = text
                        }
                    }
                }

                override fun onPartialResults(partialResults: Bundle?) {
                    voicePartialText = partialResults
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        ?.trim()
                        ?.takeIf { it.isNotBlank() }
                }
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            speechRecognizerHolder.value = recognizer
            onDispose {
                voiceListening = false
                voicePartialText = null
                pendingVoiceStart = false
                pendingVoiceStartRequiresHold = false
                holdToTalkActive = false
                ignoreClientErrorOnce = false
                speechRecognizerHolder.value?.destroy()
                speechRecognizerHolder.value = null
            }
        }
    }

    LaunchedEffect(Unit) {
        vm.connect()
        if (requestedSessionId == null) vm.refreshViewSession()
        focusRequester.requestFocus()
    }
    LaunchedEffect(requestedSessionId) {
        when {
            requestedSessionId == null -> Unit
            requestedSessionId == "__new__" -> vm.requestRemoteSessionSwitch(null)
            requestedSessionId.startsWith("__resume__:") -> vm.resumeSession(
                requestedSessionId.removePrefix("__resume__:")
            )
            else -> vm.requestRemoteSessionSwitch(requestedSessionId)
        }
    }
    LaunchedEffect(viewSessionId) {
        val sid = viewSessionId ?: return@LaunchedEffect
        val restored = composerDraftStore.loadDraft(sid)
        input = restored
        draftReadySessionId = sid
        editingMessageId = null
        markdownPreview = false
        voiceDraftText = null
    }
    LaunchedEffect(viewSessionId, input) {
        val sid = viewSessionId ?: return@LaunchedEffect
        if (draftReadySessionId != sid) return@LaunchedEffect
        delay(500)
        composerDraftStore.saveDraft(sid, input)
    }
    LaunchedEffect(toastMsg) {
        toastMsg?.let {
            snackbarHost.showSnackbar(it.resolve(context), duration = SnackbarDuration.Short)
            vm.clearToast()
        }
    }
    LaunchedEffect(voiceTransientMessage) {
        voiceTransientMessage?.let {
            snackbarHost.showSnackbar(it, duration = SnackbarDuration.Short)
            voiceTransientMessage = null
        }
    }
    LaunchedEffect(uploadTransientMessage) {
        uploadTransientMessage?.let {
            snackbarHost.showSnackbar(it, duration = SnackbarDuration.Short)
            uploadTransientMessage = null
        }
    }
    LaunchedEffect(translationTransientMessage) {
        translationTransientMessage?.let {
            snackbarHost.showSnackbar(it, duration = SnackbarDuration.Short)
            translationTransientMessage = null
        }
    }
    LaunchedEffect(quickUploadError) {
        quickUploadError?.let {
            snackbarHost.showSnackbar(it, duration = SnackbarDuration.Short)
            fileVm.clearError()
        }
    }
    LaunchedEffect(approvalUndoState?.approvalId, approvalUndoState?.expiresAtMs) {
        val state = approvalUndoState ?: return@LaunchedEffect
        val remainingSec = ((state.expiresAtMs - System.currentTimeMillis()).coerceAtLeast(0L) + 999) / 1000
        val label = if (state.approved) {
            approvalActionApprove
        } else {
            approvalActionReject
        }
        val message = String.format(
            Locale.getDefault(),
            approvalQueuedTemplate,
            label,
            state.approvalId,
            remainingSec
        )
        val result = snackbarHost.showSnackbar(
            message = message,
            actionLabel = commonUndoLabel,
            duration = SnackbarDuration.Short,
        )
        if (result == SnackbarResult.ActionPerformed) {
            vm.undoApprovalResponse(state.approvalId)
        }
    }

    val startVoiceInput: (Boolean) -> Unit = { fromHold ->
        if (!speechRecognizerAvailable) {
            voicePartialText = null
            voiceTransientMessage = voiceUnavailableMessage
        } else {
            voiceDraftText = null
            val permissionGranted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
            if (permissionGranted != hasMicPermission) {
                hasMicPermission = permissionGranted
            }
            if (!permissionGranted) {
                pendingVoiceStart = true
                pendingVoiceStartRequiresHold = fromHold
                micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            } else {
                pendingVoiceStart = false
                pendingVoiceStartRequiresHold = false
                startVoiceListeningInternal()
            }
        }
    }
    val stopVoiceInput = {
        stopVoiceListeningInternal()
    }
    val detectTranslateDirection: (String) -> TranslateDirection = { source ->
        val zhCount = source.count { ch ->
            val code = ch.code
            code in 0x4E00..0x9FFF
        }
        val latinCount = source.count { ch ->
            (ch in 'a'..'z') || (ch in 'A'..'Z')
        }
        if (zhCount >= latinCount) TranslateDirection.ZH_TO_EN else TranslateDirection.EN_TO_ZH
    }
    val translateInput: (TranslateDirection) -> Unit = { direction ->
        val source = input.trim()
        if (source.isNotBlank() && !translatingInput) {
            translatingInput = true
            coroutineScope.launch {
                runCatching {
                    OnDeviceTranslationEngine.translate(source, direction).trim()
                }.onSuccess { translated ->
                    if (translated.isNotBlank()) input = translated
                }.onFailure {
                    translationTransientMessage = chatTranslateFailedMessage
                }
                translatingInput = false
            }
        }
    }
    val parseTranslateSlashCommand: (String) -> Pair<TranslateDirection, String>? = { source ->
        val trimmed = source.trim()
        val parts = trimmed.split(Regex("\\s+"), limit = 2)
        if (parts.isEmpty()) {
            null
        } else {
            when (parts.first().lowercase(Locale.ROOT)) {
                "/z2e" -> TranslateDirection.ZH_TO_EN to parts.getOrNull(1).orEmpty().trim()
                "/e2z" -> TranslateDirection.EN_TO_ZH to parts.getOrNull(1).orEmpty().trim()
                else -> null
            }
        }
    }
    val appendInputText: (String) -> Unit = appendInputText@{ text ->
        val segment = text.trim()
        if (segment.isBlank()) return@appendInputText
        input = if (input.isBlank()) segment else "$input\n$segment"
    }
    val wrapInputWithMarkdown: (String, String) -> Unit = { prefix, suffix ->
        val base = input.trimEnd()
        input = if (base.isBlank()) {
            "$prefix$suffix"
        } else {
            "$base$prefix$suffix"
        }
    }
    val insertMarkdownCodeBlock = {
        val base = input.trimEnd()
        input = if (base.isBlank()) {
            "```\n\n```"
        } else {
            "$base\n```\n\n```"
        }
    }
    val looksLikeCode: (String) -> Boolean = { text ->
        val lines = text.lines()
        val codeHint = Regex("""\b(fun|class|const|val|var|import|return|if|for|while|SELECT|INSERT|UPDATE|DELETE)\b""")
        lines.size >= 2 && (codeHint.containsMatchIn(text) || text.contains("{") || text.contains(";"))
    }
    val fetchUrlTitle: suspend (String) -> String? = { url ->
        withContext(Dispatchers.IO) {
            runCatching {
                val req = Request.Builder().url(url).get().build()
                val body = urlPreviewClient.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) return@runCatching null
                    resp.body?.string().orEmpty()
                }
                val title = Regex("""<title[^>]*>(.*?)</title>""", RegexOption.IGNORE_CASE)
                    .find(body)
                    ?.groupValues
                    ?.getOrNull(1)
                    ?.trim()
                title?.takeIf { it.isNotBlank() }
            }.getOrNull()
        }
    }
    val smartPaste: () -> Unit = smartPaste@{
        if (quickUploadState.active) {
            uploadTransientMessage = chatUploadInProgressMessage
            return@smartPaste
        }
        val clip = clipboardManager?.primaryClip
        if (clip == null || clip.itemCount == 0) {
            uploadTransientMessage = chatSmartPasteEmptyMessage
            return@smartPaste
        }
        val firstItem = clip.getItemAt(0)
        val firstUri = firstItem.uri
        if (firstUri != null) {
            uploadSelectedUri(firstUri, firstUri.scheme == "content")
            return@smartPaste
        }
        val plainText = firstItem.coerceToText(context)?.toString()?.trim().orEmpty()
        if (plainText.isBlank()) {
            uploadTransientMessage = chatSmartPasteEmptyMessage
            return@smartPaste
        }
        if (plainText.length > 5000) {
            uploadTransientMessage = chatSmartPasteTooLongMessage
            return@smartPaste
        }
        val url = Regex("""https?://\S+""").find(plainText)?.value
        if (!url.isNullOrBlank() && plainText == url) {
            coroutineScope.launch {
                val title = fetchUrlTitle(url) ?: Uri.parse(url).host.orEmpty().ifBlank { url }
                appendInputText(
                    String.format(
                        Locale.getDefault(),
                        chatSmartPasteLinkTemplate,
                        title,
                        url,
                    )
                )
            }
            return@smartPaste
        }
        if (looksLikeCode(plainText) && !plainText.startsWith("```")) {
            appendInputText("```\n$plainText\n```")
            uploadTransientMessage = chatSmartPasteCodeWrappedMessage
            return@smartPaste
        }
        appendInputText(plainText)
    }

    val displayItems = if (uiState.searchActive && uiState.appliedSearchQuery.isNotBlank()) {
        filteredItems
    } else {
        chatItems
    }
    val showSplitPane = chatSplitPaneEnabled && configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val miniTimelinePreview = remember(timelineEntries) {
        timelineEntries.take(6).map { entry -> "${entry.typeLabel}: ${entry.summary}" }
    }
    val miniTerminalPreview = remember(uiState.terminalLines) { uiState.terminalLines.takeLast(8) }
    val miniDiffPaths = remember(diffPanelItems) { diffPanelItems.map { it.path } }

    val messageCallbacks = remember(vm, chatEditStartedTemplate, chatEditNotAllowedMessage) {
        MessageListCallbacks(
            onSuggestionClick = vm::send,
            onRetry = vm::retry,
            onFork = vm::forkAt,
            onEdit = { msg ->
                if (!vm.canEditUserMessage(msg)) {
                    translationTransientMessage = chatEditNotAllowedMessage
                } else {
                    editingMessageId = msg.id
                    input = msg.content
                    markdownPreview = false
                    translationTransientMessage = String.format(
                        Locale.getDefault(),
                        chatEditStartedTemplate,
                        msg.editedCount + 1,
                    )
                }
            },
            onUndoSend = { msg ->
                if (!vm.undoUserMessage(msg.id)) {
                    translationTransientMessage = chatEditNotAllowedMessage
                }
            },
            canEdit = vm::canEditUserMessage,
            canUndoSend = vm::canUndoUserMessage,
            onSpeak = vm::speak,
            onStopSpeaking = vm::stopSpeaking,
            onTaskClick = vm::viewTask,
            onApprove = { id -> vm.respondApproval(id, true) },
            onReject = { id -> vm.respondApproval(id, false) }
        )
    }

    Scaffold(
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbarHost) },
        topBar = {
            ChatTopBar(
                agentState = uiState.agentState,
                connState = uiState.connState,
                devices = uiState.devices,
                shellMode = vm.shellMode,
                contextPercentage = sessionControl.contextUsedPercentage,
                searchActive = uiState.searchActive,
                searchQuery = uiState.searchQuery,
                onSearchQueryChange = vm::setSearchQuery,
                onToggleSearch = vm::toggleSearch,
                onNewSession = onNewSession,
                onExport = { MessageExporter.share(context, vm.exportMarkdown()) },
                onNavigateSessions = onNavigateSessions,
                onNavigateFiles = onNavigateFiles,
                onNavigateTerminal = onNavigateTerminal,
                onOpenTimeline = { showTimeline = true },
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            ConnectionBanner(connState = uiState.connState, onRetry = vm::reconnectNow)
            ConnectionRecoveryActions(
                connState = uiState.connState,
                preferredMode = preferredConnectionMode,
                onRetry = vm::reconnectNow,
                onProbe = { vm.probeForeground("recover_actions") },
                onToggleMode = vm::switchPreferredConnectionMode,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
            )
            RecoveryIssueActions(
                issues = recoveryIssues,
                onRecover = vm::recoverIssue,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp),
            )
            AgentStatusBar(agentState = uiState.agentState, vibingMessage = vibingMessage)
            CompactRuntimeOverviewCard(
                turnState = turnState,
                state = sessionControl,
                probeState = foregroundProbe,
                expanded = runtimeDetailsExpanded,
                onProbe = { vm.probeForeground() },
                onToggleExpanded = { runtimeDetailsExpanded = !runtimeDetailsExpanded },
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
            )

            val forceShowActionBar = turnState.pendingApprovals > 0 || turnState.runningTasks > 0
            if (runtimeDetailsExpanded || forceShowActionBar) {
                ContextualActionsBar(
                    actions = turnState.availableActions,
                    onAction = { action ->
                        val approvalId = when (action) {
                            "approve", "reject" -> turnState.activeApprovalId
                                ?: pendingApprovalQueue.lastOrNull()?.id
                            else -> null
                        }
                        val rollbackPath = if (action == "rollback") {
                            diffPanelItems.firstOrNull()?.path
                        } else {
                            null
                        }
                        vm.performInteractionAction(
                            action = action,
                            approvalId = approvalId,
                            path = rollbackPath,
                        )
                    },
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                )
            }
            if (runtimeDetailsExpanded) {
                RuntimeStateCard(
                    turnState = turnState,
                    replayState = replayState,
                    probeState = foregroundProbe,
                    onProbe = { vm.probeForeground() },
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                )
                SessionControlCard(
                    state = sessionControl,
                    onRefresh = vm::refreshSessionControl,
                    onCompact = { vm.compactContext() },
                    onToggleMemory = vm::toggleMemory,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                )
                if (uiState.agentState.runningTasks.isNotEmpty()) {
                    RunningTasksCard(
                        tasks = uiState.agentState.runningTasks,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                    )
                }
            }

            if (pendingApprovalQueue.isNotEmpty()) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = stringResource(R.string.chat_pending_approvals_count, pendingApprovalQueue.size),
                            style = MaterialTheme.typography.bodySmall
                        )
                        TextButton(onClick = { showApprovalQueue = true }) {
                            Text(stringResource(R.string.chat_open_queue))
                        }
                    }
                }
            }

            if (diffPanelItems.isNotEmpty()) {
                DiffPanel(
                    items = diffPanelItems,
                    expanded = diffPanelExpanded,
                    onToggleExpanded = { diffPanelExpanded = !diffPanelExpanded },
                    onAccept = { path -> vm.applyDiffAction(path, "accept") },
                    onRollback = { path -> vm.applyDiffAction(path, "rollback") },
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                )
            }

            if (!uiState.viewingActiveSession) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(stringResource(R.string.chat_history_read_only), style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = vm::switchToActiveSession) {
                            Text(stringResource(R.string.chat_back_to_current))
                        }
                    }
                }
            }

            if (showSplitPane) {
                SplitPaneLayout(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    primary = {
                        ChatMessageList(
                            items = displayItems,
                            streaming = uiState.streaming,
                            waiting = uiState.waiting,
                            callbacks = messageCallbacks,
                            speakingIndex = uiState.speakingIndex,
                            searchActive = uiState.searchActive,
                            searchQuery = uiState.appliedSearchQuery,
                            scrollToIndex = jumpToIndex,
                            onScrollToIndexHandled = { jumpToIndex = null },
                            modifier = Modifier.fillMaxSize()
                        )
                    },
                    secondary = {
                        MiniChatPane(
                            uiState = uiState,
                            turnState = turnState,
                            sessionControl = sessionControl,
                            foregroundProbe = foregroundProbe,
                            pendingApprovalCount = pendingApprovalQueue.size,
                            safeApprovalCount = safeApprovalCount,
                            diffPaths = miniDiffPaths,
                            timelinePreview = miniTimelinePreview,
                            terminalPreview = miniTerminalPreview,
                            onOpenQueue = { showApprovalQueue = true },
                            onOpenTimeline = { showTimeline = true },
                            onNavigateTerminal = onNavigateTerminal,
                            onNavigateFiles = onNavigateFiles,
                            onProbe = { vm.probeForeground() },
                            onCompact = { vm.compactContext() },
                            onToggleMemory = vm::toggleMemory,
                        )
                    }
                )
            } else {
                ChatMessageList(
                    items = displayItems,
                    streaming = uiState.streaming,
                    waiting = uiState.waiting,
                    callbacks = messageCallbacks,
                    speakingIndex = uiState.speakingIndex,
                    searchActive = uiState.searchActive,
                    searchQuery = uiState.appliedSearchQuery,
                    scrollToIndex = jumpToIndex,
                    onScrollToIndexHandled = { jumpToIndex = null },
                    modifier = Modifier.weight(1f)
                )

                if (uiState.terminalLines.isNotEmpty()) {
                    TerminalView(uiState.terminalLines)
                }
            }

            // 快捷操作区域：默认收起，点击展开
            if (quickReplyGroups.isNotEmpty() || templates.isNotEmpty()) {
                var showQuickSection by rememberSaveable { mutableStateOf(false) }
                Column(modifier = Modifier.padding(horizontal = 8.dp)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TextButton(onClick = { showQuickSection = !showQuickSection }) {
                            Text(
                                text = if (showQuickSection) {
                                    stringResource(R.string.common_collapse)
                                } else {
                                    stringResource(R.string.chat_quick_actions_expand)
                                },
                                style = MaterialTheme.typography.labelSmall
                            )
                        }
                    }
                    AnimatedVisibility(visible = showQuickSection) {
                        Column {
                            TemplateChipRow(
                                templates = templates,
                                onTemplateClick = { template -> input = template.prompt },
                                onAddTemplateClick = { showTemplateDialog = true }
                            )

                            if (quickReplyGroups.size > 1) {
                                QuickReplyCategoryRow(
                                    groups = quickReplyGroups,
                                    selectedKey = activeQuickReplyGroup?.key,
                                    onSelect = { key -> selectedQuickReplyGroup = key }
                                )
                            }
                            QuickReplyRow(
                                title = activeQuickReplyGroup?.title,
                                replies = activeQuickReplyGroup?.replies.orEmpty(),
                                onReplyClick = { reply ->
                                    if (activeQuickReplyGroup?.key == QUICK_GROUP_SMART) {
                                        PromptDetector.markTriggered()
                                    }
                                    vm.send(reply.value)
                                    input = ""
                                    showQuickSection = false
                                }
                            )
                        }
                    }
                }
            }

            voiceDraftText?.let { draft ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.chat_voice_draft_title),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary
                        )
                        Text(
                            text = draft,
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = {
                                appendInputText(draft)
                                voiceDraftText = null
                            }) {
                                Text(stringResource(R.string.chat_voice_draft_insert))
                            }
                            TextButton(onClick = {
                                vm.send(draft)
                                voiceDraftText = null
                            }) {
                                Text(stringResource(R.string.chat_voice_draft_send))
                            }
                            TextButton(onClick = {
                                voiceDraftText = null
                                startVoiceInput(false)
                            }) {
                                Text(stringResource(R.string.chat_voice_draft_retry))
                            }
                            TextButton(onClick = { voiceDraftText = null }) {
                                Text(stringResource(R.string.common_clear))
                            }
                        }
                    }
                }
            }

            val inputBarState = InputBarState(
                input = input,
                agentState = uiState.agentState,
                connState = uiState.connState,
                composerStyle = composerStyle,
                streaming = uiState.streaming,
                autoPilot = uiState.autoPilot,
                viewingActiveSession = uiState.viewingActiveSession,
                shellMode = vm.shellMode,
                voiceListening = voiceListening,
                voiceEnabled = speechRecognizerAvailable,
                voicePartialText = voicePartialText,
                voiceLanguageTag = voiceLanguageTag,
                pendingDraftCount = pendingDraftCount,
                safeApprovalCount = safeApprovalCount,
                translatingInput = translatingInput,
                markdownPreview = markdownPreview,
                isEditingMessage = !editingMessageId.isNullOrBlank(),
                editingMessageLabel = editingMessageId?.let {
                    stringResource(R.string.chat_input_editing_message_id, it.takeLast(4))
                },
                voiceAutoSubmit = voiceAutoSubmitDraft,
                commandSuggestions = slashSuggestions,
            )

            ChatInputBar(
                state = inputBarState,
                onInputChange = { input = it },
                onSend = {
                    val text = input.trim()
                    if (text.isBlank()) return@ChatInputBar
                    val editingId = editingMessageId
                    if (!editingId.isNullOrBlank()) {
                        val edited = vm.editUserMessage(editingId, text)
                        if (edited) {
                            editingMessageId = null
                            input = ""
                            translationTransientMessage = chatEditSavedMessage
                        } else {
                            translationTransientMessage = chatEditNotAllowedMessage
                        }
                        return@ChatInputBar
                    }
                    val slashTranslate = parseTranslateSlashCommand(text)
                    if (slashTranslate != null) {
                        val (direction, payload) = slashTranslate
                        if (payload.isBlank()) {
                            translationTransientMessage = chatTranslateCommandEmptyMessage
                            return@ChatInputBar
                        }
                        if (translatingInput) return@ChatInputBar
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        translatingInput = true
                        coroutineScope.launch {
                            runCatching {
                                OnDeviceTranslationEngine.translate(payload, direction).trim()
                            }.onSuccess { translated ->
                                if (translated.isNotBlank()) {
                                    vm.send(translated)
                                    input = ""
                                }
                            }.onFailure {
                                translationTransientMessage = chatTranslateFailedMessage
                            }
                            translatingInput = false
                        }
                        return@ChatInputBar
                    }
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    vm.send(text)
                    input = ""
                },
                onCancel = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    vm.cancel()
                },
                onSwitchAgent = vm::switchAgent,
                onSetPermission = vm::setPermissionMode,
                onSetModel = vm::setModelMode,
                onAutoPilotToggle = {
                    if (uiState.autoPilot.enabled) vm.stopAutoPilot() else showAutoPilotDialog = true
                },
                onVoiceInputToggle = {
                    if (voiceListening) {
                        stopVoiceInput()
                    } else {
                        startVoiceInput(false)
                    }
                },
                onVoicePressStart = {
                    holdToTalkActive = true
                    if (!voiceListening) {
                        startVoiceInput(true)
                    }
                },
                onVoicePressEnd = {
                    holdToTalkActive = false
                    if (voiceListening) {
                        stopVoiceInput()
                    }
                },
                onSetVoiceLanguage = { tag ->
                    voiceLanguageTag = tag
                    VoiceInputPrefs.languageTag = tag
                },
                onSetComposerStyle = { style ->
                    composerStyle = style
                    ComposerStylePrefs.style = style
                },
                onBroadcastLatestTts = vm::broadcastLatestReplyViaTts,
                onTranslateAuto = { translateInput(detectTranslateDirection(input)) },
                onOpenFiles = {
                    if (quickUploadState.active) {
                        uploadTransientMessage = chatUploadInProgressMessage
                    } else {
                        quickUploadLauncher.launch(arrayOf("*/*"))
                    }
                },
                onPickImage = {
                    if (quickUploadState.active) {
                        uploadTransientMessage = chatUploadInProgressMessage
                    } else {
                        quickImageUploadLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                        )
                    }
                },
                onTakePhoto = {
                    if (quickUploadState.active) {
                        uploadTransientMessage = chatUploadInProgressMessage
                    } else {
                        val captureUri = createCameraCaptureUri()
                        if (captureUri == null) {
                            uploadTransientMessage = chatUploadCameraPrepareFailedMessage
                        } else {
                            pendingCameraUri = captureUri
                            quickCameraCaptureLauncher.launch(captureUri)
                        }
                    }
                },
                onOpenQuickPrompt = { showTemplateDialog = true },
                onSendPendingDrafts = vm::resendPendingDrafts,
                onApproveAllSafe = vm::approveAllSafe,
                onSmartPaste = smartPaste,
                onToggleMarkdownPreview = { markdownPreview = !markdownPreview },
                onInsertBold = { wrapInputWithMarkdown("**", "**") },
                onInsertCodeBlock = insertMarkdownCodeBlock,
                onInsertQuote = { appendInputText("> ") },
                onInsertBulletList = { appendInputText("- ") },
                onInsertNumberedList = { appendInputText("1. ") },
                onInsertLink = { appendInputText("[title](https://)") },
                onCancelEdit = {
                    editingMessageId = null
                    input = ""
                },
                onToggleVoiceAutoSubmit = {
                    voiceAutoSubmitDraft = !voiceAutoSubmitDraft
                    VoiceInputPrefs.autoSubmitDraft = voiceAutoSubmitDraft
                },
                onCommandSuggestionClick = { suggestion ->
                    input = suggestion.insertText
                },
                focusRequester = focusRequester,
                modifier = Modifier,
            )
        }
    }

    ChatDialogs(
        showTemplateDialog = showTemplateDialog,
        showAutoPilotDialog = showAutoPilotDialog,
        onDismissTemplateDialog = { showTemplateDialog = false },
        onDismissAutoPilotDialog = { showAutoPilotDialog = false },
        onSaveTemplate = { label, prompt ->
            TemplateStore.addCustom(label, prompt)
            templates = TemplateStore.getAll()
            showTemplateDialog = false
        },
        onStartAutoPilot = { prompt, max ->
            vm.startAutoPilot(prompt, max)
            showAutoPilotDialog = false
        }
    )

    val currentApproval = urgentApproval
    if (currentApproval != null) {
        ModalBottomSheet(onDismissRequest = vm::clearUrgentApproval) {
            LaunchedEffect(currentApproval.id) {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            }
            ApprovalCard(
                approval = currentApproval,
                onApprove = {
                    vm.respondApproval(currentApproval.id, true)
                    vm.clearUrgentApproval()
                },
                onReject = {
                    vm.respondApproval(currentApproval.id, false)
                    vm.clearUrgentApproval()
                }
            )
            if (safeApprovalCount > 0) {
                TextButton(
                    onClick = {
                        vm.approveAllSafe()
                        vm.clearUrgentApproval()
                    },
                    modifier = Modifier.padding(horizontal = 16.dp)
                ) {
                    Text(stringResource(R.string.chat_bulk_approve_low_risk, safeApprovalCount))
                }
            }
            if (pendingApprovalQueue.size > 1) {
                TextButton(
                    onClick = {
                        showApprovalQueue = true
                        vm.clearUrgentApproval()
                    },
                    modifier = Modifier.padding(horizontal = 16.dp)
                ) {
                    Text(stringResource(R.string.chat_view_all_pending, pendingApprovalQueue.size))
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (showApprovalQueue) {
        ModalBottomSheet(onDismissRequest = { showApprovalQueue = false }) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = stringResource(R.string.chat_approval_queue_title),
                    style = MaterialTheme.typography.titleMedium
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (safeApprovalCount > 0) {
                        OutlinedButton(onClick = vm::approveAllSafe) {
                            Text(stringResource(R.string.chat_approval_safe_count, safeApprovalCount))
                        }
                    }
                    Button(onClick = vm::approveAllPending) {
                        Text(stringResource(R.string.chat_approval_all_approve))
                    }
                    OutlinedButton(onClick = vm::rejectAllPending) {
                        Text(stringResource(R.string.chat_approval_all_reject))
                    }
                }
                pendingApprovalQueue.forEach { approval ->
                    ApprovalCard(
                        approval = approval,
                        onApprove = { vm.respondApproval(approval.id, true) },
                        onReject = { vm.respondApproval(approval.id, false) }
                    )
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }

    if (showTimeline) {
        ModalBottomSheet(onDismissRequest = { showTimeline = false }) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(stringResource(R.string.chat_timeline_title), style = MaterialTheme.typography.titleMedium)
                if (timelineEntries.isEmpty()) {
                    Text(
                        text = stringResource(R.string.chat_timeline_empty),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                } else {
                    timelineEntries.forEach { entry ->
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth(),
                            shape = MaterialTheme.shapes.small,
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.36f)
                        ) {
                            Column(
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(3.dp)
                            ) {
                                Text(
                                    text = "${entry.typeLabel} · ${DateFormat.format("HH:mm:ss", entry.ts)}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = entry.summary,
                                    style = MaterialTheme.typography.bodySmall,
                                    maxLines = 2
                                )
                                TextButton(
                                    onClick = {
                                        jumpToIndex = entry.messageIndex
                                        showTimeline = false
                                    }
                                ) {
                                    Text(stringResource(R.string.chat_timeline_jump))
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }

    if (handoffRequest != null) {
        val req = handoffRequest!!
        ModalBottomSheet(onDismissRequest = vm::rejectHandoffRequest) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(stringResource(R.string.chat_handoff_detected), style = MaterialTheme.typography.titleMedium)
                Text(
                    text = stringResource(R.string.chat_handoff_session, req.sessionId),
                    style = MaterialTheme.typography.bodySmall
                )
                if (!req.sourceDeviceId.isNullOrBlank()) {
                    Text(
                        text = stringResource(R.string.chat_handoff_source_device, req.sourceDeviceId),
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                if (!req.reason.isNullOrBlank()) {
                    Text(
                        text = stringResource(R.string.chat_handoff_reason, req.reason),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = vm::confirmHandoffRequest) { Text(stringResource(R.string.chat_handoff_confirm)) }
                    OutlinedButton(onClick = vm::rejectHandoffRequest) { Text(stringResource(R.string.notifier_action_reject)) }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun ConnectionRecoveryActions(
    connState: com.yuanio.app.data.ConnectionState,
    preferredMode: ConnectionMode,
    onRetry: () -> Unit,
    onProbe: () -> Unit,
    onToggleMode: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (connState == com.yuanio.app.data.ConnectionState.CONNECTED) return
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.28f)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(onClick = onRetry) { Text(stringResource(R.string.chat_action_reconnect)) }
            TextButton(onClick = onProbe) { Text(stringResource(R.string.chat_action_probe)) }
            TextButton(onClick = onToggleMode) {
                Text(
                    when (preferredMode) {
                        ConnectionMode.LOCAL -> stringResource(R.string.chat_switch_to_relay)
                        ConnectionMode.RELAY -> stringResource(R.string.chat_switch_to_local)
                        ConnectionMode.AUTO -> stringResource(R.string.chat_switch_auto_to_local)
                    }
                )
            }
        }
    }
}

@Composable
private fun RecoveryIssueActions(
    issues: List<ChatViewModel.RecoveryIssue>,
    onRecover: (ChatViewModel.RecoveryIssueType) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (issues.isEmpty()) return
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.42f)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            issues.forEach { issue ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        Text(
                            text = issue.title,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                        Text(
                            text = issue.summary,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.85f)
                        )
                    }
                    TextButton(onClick = { onRecover(issue.type) }) {
                        Text(issue.actionLabel)
                    }
                }
            }
        }
    }
}

@Composable
private fun ContextualActionsBar(
    actions: List<String>,
    onAction: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (actions.isEmpty()) return
    val order = listOf("continue", "stop", "approve", "reject", "retry", "rollback")
    val normalized = actions.map { it.trim().lowercase() }
    val visible = order.filter { normalized.contains(it) }
    if (visible.isEmpty()) return

    val label = mapOf(
        "continue" to stringResource(R.string.chat_action_continue),
        "stop" to stringResource(R.string.chat_action_stop),
        "approve" to stringResource(R.string.notifier_action_approve),
        "reject" to stringResource(R.string.notifier_action_reject),
        "retry" to stringResource(R.string.common_retry),
        "rollback" to stringResource(R.string.chat_action_rollback),
    )

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.36f)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                text = stringResource(R.string.chat_context_actions_title),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                visible.take(3).forEach { action ->
                    OutlinedButton(onClick = { onAction(action) }) {
                        Text(label[action] ?: action)
                    }
                }
            }
            if (visible.size > 3) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    visible.drop(3).forEach { action ->
                        OutlinedButton(onClick = { onAction(action) }) {
                            Text(label[action] ?: action)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CompactRuntimeOverviewCard(
    turnState: ChatViewModel.TurnState,
    state: ChatViewModel.SessionControlState,
    probeState: ChatViewModel.ForegroundProbeState,
    expanded: Boolean,
    onProbe: () -> Unit,
    onToggleExpanded: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.32f)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = stringResource(
                    R.string.chat_runtime_turn,
                    turnState.phase,
                    turnState.version,
                    turnState.reason
                ),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            val ctxWindow = if (state.contextWindowSize > 0) state.contextWindowSize else 0
            val ctxText = if (ctxWindow > 0) {
                "${state.contextUsedPercentage}% (${state.contextTokens}/$ctxWindow)"
            } else {
                "${state.contextUsedPercentage}% (${state.contextTokens})"
            }
            val memoryState = if (state.memoryEnabled) {
                stringResource(R.string.chat_memory_enable)
            } else {
                stringResource(R.string.chat_memory_disable)
            }
            Text(
                text = "Context $ctxText · queue ${state.queueTasks} · $memoryState",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                val latencyText = probeState.latencyMs?.let { "${it}ms" } ?: "--"
                Text(
                    text = stringResource(R.string.chat_probe_status, probeState.status, latencyText),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = onProbe) {
                        Text(stringResource(R.string.chat_action_probe))
                    }
                    TextButton(onClick = onToggleExpanded) {
                        Text(
                            if (expanded) {
                                stringResource(R.string.common_collapse)
                            } else {
                                stringResource(R.string.common_expand)
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun QuickReplyCategoryRow(
    groups: List<QuickReplyGroup>,
    selectedKey: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (groups.isEmpty()) return
    LazyRow(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items(groups, key = { it.key }) { group ->
            val selected = group.key == selectedKey
            AssistChip(
                onClick = { onSelect(group.key) },
                label = { Text(group.title) },
                border = if (selected) BorderStroke(1.dp, MaterialTheme.colorScheme.primary) else null,
                colors = AssistChipDefaults.assistChipColors(
                    containerColor = if (selected) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)
                    },
                    labelColor = if (selected) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
            )
        }
    }
}

private fun buildScenarioQuickReplies(
    turnState: ChatViewModel.TurnState,
    connState: com.yuanio.app.data.ConnectionState,
    shellMode: Boolean,
    quickProbe: String,
    quickViewStatus: String,
    quickApprovalList: String,
    quickApprovalQueue: String,
    quickApproveLatest: String,
    quickRejectLatest: String,
    quickRunTasks: String,
    quickRecentHistory: String,
    quickTaskOutput: String,
    quickCommandHelp: String,
    quickContext: String,
    quickRecentTasks: String,
): List<PromptDetector.QuickReply> {
    if (connState != com.yuanio.app.data.ConnectionState.CONNECTED) {
        return listOf(
            PromptDetector.QuickReply(quickProbe, "/probe"),
            PromptDetector.QuickReply(quickViewStatus, "/status"),
            PromptDetector.QuickReply(quickApprovalList, "/approvals"),
        )
    }
    if (turnState.pendingApprovals > 0) {
        return listOf(
            PromptDetector.QuickReply(quickApprovalQueue, "/approvals"),
            PromptDetector.QuickReply(quickApproveLatest, "/approve"),
            PromptDetector.QuickReply(quickRejectLatest, "/reject"),
        )
    }
    if (turnState.runningTasks > 0 || turnState.phase == "running") {
        return listOf(
            PromptDetector.QuickReply(quickRunTasks, "/tasks"),
            PromptDetector.QuickReply(quickRecentHistory, "/history 12"),
            PromptDetector.QuickReply(quickTaskOutput, "/task "),
        )
    }
    if (shellMode) {
        return listOf(
            PromptDetector.QuickReply(quickCommandHelp, "/help"),
            PromptDetector.QuickReply(quickProbe, "/probe"),
            PromptDetector.QuickReply(quickContext, "/context"),
        )
    }
    return listOf(
        PromptDetector.QuickReply(quickRecentTasks, "/history 10"),
        PromptDetector.QuickReply(quickApprovalList, "/approvals"),
        PromptDetector.QuickReply(quickContext, "/context"),
    )
}

private const val QUICK_GROUP_SCENARIO = "scenario"
private const val QUICK_GROUP_PROJECT = "project"
private const val QUICK_GROUP_RECENT = "recent"
private const val QUICK_GROUP_SMART = "smart"

private data class QuickReplyGroup(
    val key: String,
    val title: String,
    val replies: List<PromptDetector.QuickReply>,
)

@Composable
private fun RuntimeStateCard(
    turnState: ChatViewModel.TurnState,
    replayState: ChatViewModel.ReplayState?,
    probeState: ChatViewModel.ForegroundProbeState,
    onProbe: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = stringResource(
                    R.string.chat_runtime_turn,
                    turnState.phase,
                    turnState.version,
                    turnState.reason
                ),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = stringResource(
                    R.string.chat_runtime_tasks_approvals,
                    turnState.runningTasks,
                    turnState.pendingApprovals
                ),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            val replayText = replayState?.let {
                stringResource(R.string.chat_runtime_replay_progress, it.replayed, it.reason)
            } ?: stringResource(R.string.chat_runtime_replay_waiting)
            Text(
                text = replayText,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                val latencyText = probeState.latencyMs?.let { "${it}ms" } ?: "--"
                Text(
                    text = stringResource(R.string.chat_probe_status, probeState.status, latencyText),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                TextButton(onClick = onProbe) {
                    Text(stringResource(R.string.chat_action_probe))
                }
            }
        }
    }
}

@Composable
private fun SessionControlCard(
    state: ChatViewModel.SessionControlState,
    onRefresh: () -> Unit,
    onCompact: () -> Unit,
    onToggleMemory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.32f)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            val ctxWindow = if (state.contextWindowSize > 0) state.contextWindowSize else 0
            val ctxText = if (ctxWindow > 0) {
                "${state.contextUsedPercentage}% (${state.contextTokens}/$ctxWindow)"
            } else {
                "${state.contextUsedPercentage}% (${state.contextTokens})"
            }
            Text(
                text = "Context $ctxText · tasks ${state.runningTasks} · queue ${state.queueTasks}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "Style ${state.outputStyleId} · Memory ${if (state.memoryEnabled) "ON" else "OFF"}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (state.statusline.isNotBlank()) {
                Text(
                    text = state.statusline.lines().firstOrNull().orEmpty(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(onClick = onRefresh) { Text(stringResource(R.string.common_refresh)) }
                OutlinedButton(onClick = onCompact) { Text(stringResource(R.string.chat_action_compact)) }
                OutlinedButton(onClick = onToggleMemory) {
                    Text(
                        if (state.memoryEnabled) {
                            stringResource(R.string.chat_memory_disable)
                        } else {
                            stringResource(R.string.chat_memory_enable)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun RunningTasksCard(
    tasks: List<ChatViewModel.RunningTask>,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = stringResource(R.string.chat_parallel_tasks_panel_title, tasks.size),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            tasks.take(8).forEach { task ->
                Text(
                    text = "• ${task.taskId} · ${task.agent}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (tasks.size > 8) {
                Text(
                    text = stringResource(R.string.chat_parallel_tasks_panel_more, tasks.size - 8),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
        }
    }
}

private data class TimelineEntry(
    val messageIndex: Int,
    val typeLabel: String,
    val summary: String,
    val ts: Long,
)

private fun buildTimelineEntries(items: List<ChatItem>): List<TimelineEntry> {
    val out = mutableListOf<TimelineEntry>()
    items.forEachIndexed { index, item ->
        when (item) {
            is ChatItem.ToolCall -> {
                val label = if (item.status == ToolCallStatus.ERROR) "error" else "tool_call"
                val summary = buildString {
                    append(item.tool)
                    append(" · ")
                    append(item.status.protocolValue)
                    item.summary?.takeIf { it.isNotBlank() }?.let { append(" · ${it.take(42)}") }
                }
                out += TimelineEntry(index, label, summary, System.currentTimeMillis())
            }
            is ChatItem.FileDiff -> {
                out += TimelineEntry(
                    messageIndex = index,
                    typeLabel = "file_diff",
                    summary = "${item.action} ${item.path}",
                    ts = System.currentTimeMillis(),
                )
            }
            is ChatItem.Approval -> {
                out += TimelineEntry(
                    messageIndex = index,
                    typeLabel = "approval",
                    summary = "${item.tool} · ${item.riskLevel} · ${item.desc}",
                    ts = System.currentTimeMillis(),
                )
            }
            is ChatItem.Text -> {
                if (item.failed || item.content.contains("error", ignoreCase = true) || item.content.contains("失败")) {
                    out += TimelineEntry(
                        messageIndex = index,
                        typeLabel = "error",
                        summary = item.content.take(56),
                        ts = item.ts,
                    )
                }
            }
            else -> Unit
        }
    }
    return out.asReversed().take(120)
}
