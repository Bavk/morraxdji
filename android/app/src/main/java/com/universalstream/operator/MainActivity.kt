package com.universalstream.operator

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.VpnService
import android.os.Bundle
import android.util.Base64
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.LocalVideoTrackOptions
import io.livekit.android.room.track.VideoCaptureParameter
import io.livekit.android.room.track.VideoEncoding
import io.livekit.android.room.participant.VideoTrackPublishDefaults
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import org.json.JSONArray
import kotlinx.coroutines.Job
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

private class SessionHttpException(val status:Int, message:String):IOException(message)

private object StreamState {
    var room: Room? = null
    var vpnEnabled: Boolean = false
    var transport:WireGuardTransport?=null
}

// No raw WireGuard configuration is accepted from an untrusted enrollment code.
// The APK constructs a split tunnel to the Windows host only.
internal data class Enrollment(val operatorKey:String,val ip:String,val privateKey:String,val relayKey:String,val endpoint:String,val transportUrl:String?=null,val transportToken:String?=null) {
    companion object {
        fun parse(code:String):Enrollment {
            require(code.startsWith("USCV1.") && code.length in 80..2500) { "Ожидается код USCV1 из Windows-приложения" }
            val raw=Base64.decode(code.removePrefix("USCV1."),Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
            val json=JSONObject(String(raw,Charsets.UTF_8))
            require(json.getInt("v")==1) { "Неподдерживаемая версия кода" }
            val key=json.getString("key")
            val ip=json.getString("ip")
            val privateKey=json.getString("privateKey")
            val relayKey=json.getString("relayKey")
            val endpoint=json.getString("endpoint")
            require(Regex("STRM_[A-Za-z0-9_-]{32}").matches(key)) { "Неверный ключ оператора" }
            require(Regex("10\\.77\\.0\\.(1\\d\\d|2[0-3]\\d|240)").matches(ip)) { "Недопустимый VPN-адрес" }
            for(k in listOf(privateKey,relayKey)) {
                require(Regex("[A-Za-z0-9+/]{43}=").matches(k) && Base64.decode(k,Base64.DEFAULT).size==32) { "Некорректный ключ WireGuard" }
            }
            require(Regex("[A-Za-z0-9.-]{3,253}:[0-9]{1,5}").matches(endpoint)) { "Неверный адрес ретранслятора" }
            require((endpoint.substringAfter(':').toIntOrNull() ?: 0) in 1..65535) { "Недопустимый VPN-порт" }
            val transport=json.optJSONObject("transport")
            val transportUrl=transport?.getString("url")
            val transportToken=transport?.getString("token")
            if(transport!=null){
                val uri=java.net.URI(transportUrl)
                require(uri.scheme=="wss" && uri.host!=null && uri.userInfo==null && uri.rawQuery==null && uri.fragment==null && Regex("/v1/tunnel/key_[a-f0-9]{20}").matches(uri.path)) { "Неверный HTTPS-транспорт" }
                require(transportToken!=null && Regex("[A-Za-z0-9_-]{43}").matches(transportToken)) { "Неверный ключ HTTPS-транспорта" }
            }
            return Enrollment(key,ip,privateKey,relayKey,endpoint,transportUrl,transportToken)
        }
    }
    fun wgConfig(endpointOverride:String?=null):Config {
        val config="""
            [Interface]
            PrivateKey = $privateKey
            Address = $ip/32
            MTU = 1280

            [Peer]
            PublicKey = $relayKey
            Endpoint = ${endpointOverride?:endpoint}
            AllowedIPs = 10.77.0.1/32
            PersistentKeepalive = 25
        """.trimIndent()
        return Config.parse(ByteArrayInputStream(config.toByteArray(Charsets.UTF_8)))
    }
}

class MainActivity:ComponentActivity() {
    private lateinit var inviteInput:EditText
    private lateinit var address:EditText
    private lateinit var status:TextView
    private lateinit var quality:Spinner
    private lateinit var start:Button
    private lateinit var stop:Button
    private lateinit var store:InviteStore
    private val wg by lazy { GoBackend(applicationContext) }
    private val tunnel=object:Tunnel {
        override fun getName():String="usc-operator"
        override fun onStateChange(newState:Tunnel.State) { }
    }
    private var pending:Enrollment?=null
    private var pendingVpnEpoch=0
    private var stopping=false
    private var currentCode:String?=null
    private var roomEventsJob:Job?=null
    // Invalidate asynchronous API/WebRTC handshakes if the operator stops streaming.
    private var sessionEpoch=0
    private var captureEpoch=-1

    private val inviteFileLauncher=registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if(uri==null)return@registerForActivityResult
        if(!start.isEnabled || StreamState.room!=null){setStatus("Сначала остановите текущий сеанс");return@registerForActivityResult}
        val attempt=sessionEpoch
        lifecycleScope.launch {
            try {
                val code=withContext(Dispatchers.IO) {
                    require(uri.scheme=="content")
                    contentResolver.openInputStream(uri)?.use { InviteFile.read(it) } ?: error("Файл недоступен")
                }
                if(attempt!=sessionEpoch || !start.isEnabled || StreamState.room!=null)return@launch
                inviteInput.setText(code)
                setStatus("Код загружен. Нажмите «Начать трансляцию»")
            }catch(_:Exception){if(attempt==sessionEpoch)setStatus("Не удалось загрузить код. Выберите файл .usc из Windows-приложения")}
        }
    }
    private val vpnLauncher=registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val enrollment=pending;pending=null
        if(pendingVpnEpoch!=sessionEpoch)return@registerForActivityResult
        if(result.resultCode != Activity.RESULT_OK || enrollment==null){
            setStatus("Разрешение Android на VPN отклонено")
            start.isEnabled=true;stop.isEnabled=false
        }else connectVpn(enrollment,pendingVpnEpoch)
    }
    private val captureLauncher=registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        // Ignore a system permission response arriving after Stop or a new connection attempt.
        val attempt=captureEpoch
        captureEpoch=-1
        if(attempt!=sessionEpoch || stopping || StreamState.room==null)return@registerForActivityResult
        if(result.resultCode!=Activity.RESULT_OK||result.data==null){
            setStatus("Захват экрана не разрешён")
            stopSession()
            return@registerForActivityResult
        }
        lifecycleScope.launch {
            try {
                if(attempt!=sessionEpoch || stopping)return@launch
                val room=StreamState.room?:error("Нет соединения с Windows")
                val resultOk=room.localParticipant.setScreenShareEnabled(true,ScreenCaptureParams(result.data!!,notificationId=ScreenShareNotification.ID,notification=ScreenShareNotification.create(this@MainActivity),onStop={
                    runOnUiThread {
                        if(!stopping && StreamState.room!=null) {
                            setStatus("Android остановил захват экрана. Отключение…")
                            stopSession()
                        }
                    }
                }))
                if(attempt!=sessionEpoch || stopping){
                    try{room.localParticipant.setScreenShareEnabled(false)}catch(_:Exception){}
                    return@launch
                }
                if(!resultOk)error("Не удалось начать захват")
                start.isEnabled=false;stop.isEnabled=true
                setStatus("● В ЭФИРЕ — можно открыть приложение пульта")
            }catch(e:Exception){
                if(attempt==sessionEpoch && !stopping){setStatus("Ошибка захвата: ${e.message}");stopSession()}
            }
        }
    }

    override fun onCreate(savedInstanceState:Bundle?){
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        inviteInput=findViewById(R.id.operatorKey)
        address=findViewById(R.id.serverAddress)
        findViewById<View>(R.id.lanDebugContainer).visibility=if(BuildConfig.DEBUG) View.VISIBLE else View.GONE
        status=findViewById(R.id.statusText)
        quality=findViewById(R.id.qualitySpinner)
        quality.setSelection(getSharedPreferences("operator",MODE_PRIVATE).getInt("quality_index",1))
        start=findViewById(R.id.startButton)
        findViewById<Button>(R.id.pasteButton).setOnClickListener {
            val clipboard=getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            val item=clipboard.primaryClip?.takeIf{it.itemCount>0}?.getItemAt(0)
            val value=item?.coerceToText(this)?.toString()?.trim().orEmpty()
            if(value.startsWith("USCV1.") && value.length <= 2500){
                inviteInput.setText(value)
                setStatus("Код вставлен. Нажмите «Начать трансляцию»")
            }else setStatus("Буфер обмена не содержит подходящего кода USCV1")
        }
        findViewById<Button>(R.id.importCodeButton).setOnClickListener {
            if(!start.isEnabled || StreamState.room!=null)setStatus("Сначала остановите текущий сеанс")
            else inviteFileLauncher.launch(arrayOf("*/*"))
        }
        stop=findViewById(R.id.stopButton)
        store=InviteStore(this)
        findViewById<Button>(R.id.forgetCodeButton).setOnClickListener {
            if(!canForgetCode()){setStatus("Сначала остановите текущий сеанс и VPN");return@setOnClickListener}
            AlertDialog.Builder(this)
                .setTitle("Удалить сохранённое подключение?")
                .setMessage("Код на этом пульте будет удалён. Для следующего подключения потребуется ввести его заново. Ключ на Windows останется действующим; для запрета доступа отзовите его на Windows. Файлы .usc и буфер обмена не удаляются.")
                .setNegativeButton("Отмена",null)
                .setPositiveButton("Удалить код") { _,_ ->
                    if(!canForgetCode()){setStatus("Сначала остановите текущий сеанс и VPN");return@setPositiveButton}
                    // Invalidate an import that was still reading a document before removal.
                    sessionEpoch++
                    start.isEnabled=false
                    val button=findViewById<Button>(R.id.forgetCodeButton);button.isEnabled=false
                    lifecycleScope.launch {
                        try {
                            withContext(Dispatchers.IO){store.forget()}
                            currentCode=null;pending=null;inviteInput.text.clear()
                            setStatus("Сохранённый код удалён с этого пульта. Введите новый код для подключения")
                        }catch(_:Exception){setStatus("Не удалось полностью удалить сохранённое подключение. Повторите попытку")}
                        finally{start.isEnabled=true;button.isEnabled=true}
                    }
                }.show()
        }
        inviteInput.setText(store.load().orEmpty())
        address.setText(getSharedPreferences("operator",MODE_PRIVATE).getString("api_url",""))
        if(StreamState.room!=null){start.isEnabled=false;stop.isEnabled=true;setStatus("Сеанс активен")}
        start.setOnClickListener {
            stopping=false
            val attempt=++sessionEpoch
            val code=inviteInput.text.toString().trim()
            getSharedPreferences("operator",MODE_PRIVATE).edit()
                .putInt("quality_index",quality.selectedItemPosition).apply()
            start.isEnabled=false;stop.isEnabled=true
            if(code.startsWith("USCV1.")) {
                try {
                    val enrollment=Enrollment.parse(code)
                    store.save(code)
                    currentCode=code
                    val permission=VpnService.prepare(this)
                    if(permission!=null){pending=enrollment;pendingVpnEpoch=attempt;vpnLauncher.launch(permission)}
                    else connectVpn(enrollment,attempt)
                }catch(e:Exception){start.isEnabled=true;stop.isEnabled=false;setStatus("Ошибка кода: ${e.message}")}
            }else{
                // Legacy LAN test mode is debug-only; remote access must use VPN.
                val api=address.text.toString().trim().trimEnd('/')
                if(!BuildConfig.DEBUG || !api.startsWith("http://")){
                    start.isEnabled=true;stop.isEnabled=false;setStatus("Вставьте код USCV1 из Windows-приложения")
                }else {
                    currentCode=code
                    getSharedPreferences("operator",MODE_PRIVATE).edit().putString("api_url",api).apply()
                    connectStream(api,code,attempt)
                }
            }
        }
        stop.setOnClickListener {stopSession()}
    }
    private fun setStatus(value:String){status.text=value}
    private fun canForgetCode():Boolean=InviteRemoval.allowed(start.isEnabled,StreamState.room!=null,StreamState.vpnEnabled,stopping)
    private fun connectVpn(enrollment:Enrollment,attempt:Int){
        stopping=false
        start.isEnabled=false
        setStatus("Подключение защищённого VPN…")
        lifecycleScope.launch {
            try {
                if(enrollment.transportUrl!=null && enrollment.transportToken!=null){
                    setStatus("Подключение WireGuard через HTTPS…")
                    val transport=WireGuardTransport(enrollment.transportUrl,enrollment.transportToken)
                    StreamState.transport=transport
                    transport.open()
                }
                withContext(Dispatchers.IO){wg.setState(tunnel,Tunnel.State.UP,enrollment.wgConfig(StreamState.transport?.endpoint))}
                // The operator can cancel while VPN negotiation is in progress.
                if(attempt!=sessionEpoch){
                    withContext(Dispatchers.IO){try{wg.setState(tunnel,Tunnel.State.DOWN,null)}catch(_:Exception){}}
                    StreamState.transport?.close();StreamState.transport=null
                    return@launch
                }
                StreamState.vpnEnabled=true
                connectStream("http://10.77.0.1:3100",enrollment.operatorKey,attempt)
            }catch(e:Exception){
                if(attempt!=sessionEpoch)return@launch
                setStatus("VPN не подключён: ${e.message}")
                StreamState.transport?.close();StreamState.transport=null
                withContext(Dispatchers.IO){try{wg.setState(tunnel,Tunnel.State.DOWN,null)}catch(_:Exception){}}
                start.isEnabled=true;stop.isEnabled=false
            }
        }
    }
    private fun connectStream(api:String,operatorKey:String,attempt:Int){
        if(attempt!=sessionEpoch)return
        start.isEnabled=false
        setStatus("Подключение к Windows…")
        lifecycleScope.launch {
            var current:Room?=null
            try {
                val available=withContext(Dispatchers.IO){
                    var last:Exception?=null
                    repeat(5){index->try{return@withContext obtainRooms(api,operatorKey).getJSONArray("rooms")}catch(e:Exception){if(e is SessionHttpException&&e.status in 400..499)throw e;last=e;if(index<4)delay((1000L shl index).coerceAtMost(8000L))}}
                    throw(last?:IOException("Сервер недоступен"))
                }
                if(attempt!=sessionEpoch)return@launch
                if(available.length()==0)error("Нет доступных комнат. Обратитесь к администратору Windows")
                val chosen=if(available.length()==1)available.getJSONObject(0).getString("id") else chooseRoom(available)
                if(chosen==null){stopSession();return@launch}
                if(attempt!=sessionEpoch)return@launch
                val session=withContext(Dispatchers.IO){
                    var last:Exception?=null
                    repeat(5){index->
                        try{return@withContext obtainSession(api,operatorKey,chosen)}catch(e:Exception){
                            // A revoked/malformed key is permanent: do not retry authorization.
                            if(e is SessionHttpException && e.status in 400..499) throw e
                            last=e
                            if(index<4)delay((1000L shl index).coerceAtMost(8000L))
                        }
                    }
                    throw(last?:IOException("Сервер недоступен"))
                }
                if(attempt!=sessionEpoch)return@launch
                current=LiveKit.create(applicationContext)
                // Apply the operator-selected encoding before MediaProjection is created.
                val profile=StreamProfile.fromIndex(
                    getSharedPreferences("operator",MODE_PRIVATE).getInt("quality_index",1))
                current?.screenShareTrackCaptureDefaults=LocalVideoTrackOptions(
                    isScreencast=true,
                    // Do not crop portrait or non-16:9 controller displays to a 16:9 canvas.
                    // Preserve the full visible screen (especially telemetry/status bars).
                    captureParams=VideoCaptureParameter(profile.width,profile.height,profile.fps,
                        adaptOutputToDimensions=false))
                current?.screenShareTrackPublishDefaults=VideoTrackPublishDefaults(
                    videoEncoding=VideoEncoding(profile.maxBitrate,profile.fps),simulcast=false)
                val connectedRoom=current ?: error("Не удалось создать LiveKit Room")
                roomEventsJob?.cancel()
                roomEventsJob=launch {
                    connectedRoom.events.collect { event ->
                        if(StreamState.room===connectedRoom) {
                            when(event) {
                                is RoomEvent.Reconnecting -> setStatus("Переподключение к видеосерверу…")
                                is RoomEvent.Reconnected -> setStatus("● Соединение восстановлено — экран транслируется")
                                is RoomEvent.Disconnected -> if(!stopping) {
                                    setStatus("Соединение потеряно. Трансляция остановлена")
                                    stopSession()
                                }
                                else -> Unit
                            }
                        }
                    }
                }
                connectedRoom.connect(session.getString("wsUrl"),session.getString("token"))
                if(attempt!=sessionEpoch){connectedRoom.disconnect();connectedRoom.release();return@launch}
                StreamState.room=connectedRoom
                currentCode?.let { store.save(it) }
                currentCode=null
                stop.isEnabled=true
                setStatus("Подключён к ${session.getString("roomName")}. Качество: ${profile.width}×${profile.height}, ${profile.fps} FPS. Разрешите захват экрана")
                val projection=getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                captureEpoch=attempt
                captureLauncher.launch(projection.createScreenCaptureIntent())
            }catch(e:Exception){
                if(attempt!=sessionEpoch){current?.disconnect();current?.release();return@launch}
                roomEventsJob?.cancel();roomEventsJob=null
                current?.disconnect();current?.release()
                StreamState.room=null
                StreamState.transport?.close();StreamState.transport=null
                if(StreamState.vpnEnabled){
                    withContext(Dispatchers.IO){try{wg.setState(tunnel,Tunnel.State.DOWN,null)}catch(_:Exception){}}
                    StreamState.vpnEnabled=false
                }
                start.isEnabled=true;stop.isEnabled=false
                setStatus("Нет соединения: ${e.message}")
            }
        }
    }
    private fun stopSession(){
        if(stopping)return
        stopping=true
        sessionEpoch++
        captureEpoch=-1
        pending=null
        currentCode=null
        roomEventsJob?.cancel();roomEventsJob=null
        val current=StreamState.room;StreamState.room=null
        lifecycleScope.launch {
            try{current?.localParticipant?.setScreenShareEnabled(false)}catch(_:Exception){}
            try{current?.disconnect();current?.release()}catch(_:Exception){}
            if(StreamState.vpnEnabled){
                withContext(Dispatchers.IO){try{wg.setState(tunnel,Tunnel.State.DOWN,null)}catch(_:Exception){}}
                StreamState.vpnEnabled=false
            }
            start.isEnabled=true;stop.isEnabled=false;setStatus("Трансляция остановлена")
            StreamState.transport?.close();StreamState.transport=null
            stopping=false
        }
    }
    private suspend fun chooseRoom(rooms:JSONArray):String?=suspendCancellableCoroutine { continuation ->
        val names=Array(rooms.length()){rooms.getJSONObject(it).getString("name")}
        val dialog=AlertDialog.Builder(this).setTitle("Выберите комнату трансляции")
            .setItems(names){_,index->if(continuation.isActive)continuation.resume(rooms.getJSONObject(index).getString("id"))}
            .setNegativeButton("Отмена"){_,_->if(continuation.isActive)continuation.resume(null)}
            .setOnCancelListener{if(continuation.isActive)continuation.resume(null)}.create()
        continuation.invokeOnCancellation{runOnUiThread{dialog.dismiss()}}
        dialog.show()
    }
    private fun obtainRooms(api:String,key:String):JSONObject {
        return try{requestOperator(api,"/api/operator/rooms",JSONObject().put("key",key))}catch(e:SessionHttpException){
            if(e.status!=404)throw e
            JSONObject().put("rooms",JSONArray().put(JSONObject().put("id","").put("name","Комната ключа")))
        }
    }
    private fun obtainSession(api:String,operatorKey:String,roomId:String):JSONObject=requestOperator(api,"/api/operator/session",JSONObject().put("key",operatorKey).apply{if(roomId.isNotEmpty())put("roomId",roomId)})
    private fun requestOperator(api:String,endpoint:String,payload:JSONObject):JSONObject {
        val connection=URL("$api$endpoint").openConnection() as HttpURLConnection
        try {
            connection.requestMethod="POST"
            connection.connectTimeout=3500
            connection.readTimeout=7000
            connection.setRequestProperty("Content-Type","application/json; charset=utf-8")
            connection.doOutput=true
            connection.outputStream.use{it.write(payload.toString().toByteArray(Charsets.UTF_8))}
            val code=connection.responseCode
            val body=(if(code in 200..299)connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use{it.readText()}.orEmpty()
            if(code !in 200..299)throw SessionHttpException(code,"HTTP $code: ${body.take(180)}")
            return JSONObject(body)
        }finally{connection.disconnect()}
    }
}
