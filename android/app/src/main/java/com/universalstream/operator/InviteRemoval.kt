package com.universalstream.operator

internal object InviteRemoval {
    fun allowed(startEnabled:Boolean,roomActive:Boolean,vpnActive:Boolean,stopping:Boolean):Boolean =
        startEnabled && !roomActive && !vpnActive && !stopping

}
