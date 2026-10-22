package com.universalstream.operator

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketAddress
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/** HTTPS carries encrypted WireGuard datagrams when the carrier blocks UDP. */
internal class WireGuardTransport(private val url:String,private val token:String) {
    private val socket=DatagramSocket(0,InetAddress.getByName("127.0.0.1"))
    private val client=OkHttpClient.Builder().connectTimeout(10,TimeUnit.SECONDS)
        .readTimeout(0,TimeUnit.SECONDS).pingInterval(20,TimeUnit.SECONDS).build()
    private val ready=CompletableDeferred<Unit>()
    @Volatile private var sender:SocketAddress?=null
    @Volatile private var closed=false
    private var webSocket:WebSocket?=null
    val endpoint:String get()="127.0.0.1:${socket.localPort}"
    suspend fun open(){
        webSocket=client.newWebSocket(Request.Builder().url(url).header("Authorization","Bearer $token").build(),object:WebSocketListener(){
            override fun onMessage(ws:WebSocket,text:String){if(text=="ready")ready.complete(Unit)}
            override fun onMessage(ws:WebSocket,bytes:ByteString){
                val target=sender?:return
                if(bytes.size !in 32..2048)return
                try{val data=bytes.toByteArray();socket.send(DatagramPacket(data,data.size,target))}catch(_:Exception){}
            }
            override fun onFailure(ws:WebSocket,t:Throwable,response:Response?){ready.completeExceptionally(java.io.IOException("HTTPS-транспорт VPN недоступен"));close()}
            override fun onClosed(ws:WebSocket,code:Int,reason:String){ready.completeExceptionally(java.io.IOException("HTTPS-транспорт VPN закрыт"));close()}
        })
        withTimeout(12000){ready.await()}
        thread(name="usc-wg-https",isDaemon=true){
            val buffer=ByteArray(2049)
            while(!closed){try{
                val packet=DatagramPacket(buffer,buffer.size);socket.receive(packet)
                if(packet.length !in 32..2048)continue
                sender=packet.socketAddress
                val ws=webSocket?:break
                if(ws.queueSize()>1024*1024||!ws.send(packet.data.toByteString(packet.offset,packet.length))){close();break}
            }catch(_:Exception){if(!closed)close();break}}
        }
    }
    fun close(){
        if(closed)return
        closed=true;socket.close();webSocket?.cancel()
        client.dispatcher.executorService.shutdown();client.connectionPool.evictAll()
    }
}
