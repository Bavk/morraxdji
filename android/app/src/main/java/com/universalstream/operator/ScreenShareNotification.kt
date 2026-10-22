package com.universalstream.operator

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

object ScreenShareNotification {
    const val ID = 2345
    private const val CHANNEL = "usc_screen_capture"
    fun create(context: Context): Notification {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Трансляция экрана", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_screen_share)
            .setContentTitle("Universal Stream — трансляция экрана")
            .setContentText("Экран передаётся на Windows. Нажмите, чтобы остановить трансляцию в приложении.")
            .setContentIntent(open)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }
}
