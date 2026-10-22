package com.universalstream.operator

import org.junit.Assert.*
import org.junit.Test

class InviteRemovalTest {
    @Test fun refusesEveryActiveOrTransitionState() {
        assertTrue(InviteRemoval.allowed(true,false,false,false))
        assertFalse(InviteRemoval.allowed(false,false,false,false))
        assertFalse(InviteRemoval.allowed(true,true,false,false))
        assertFalse(InviteRemoval.allowed(true,false,true,false))
        assertFalse(InviteRemoval.allowed(true,false,false,true))
    }
    @Test fun onlyIdleStateAllowsDeletion() {
        for(start in listOf(false,true))for(room in listOf(false,true))for(vpn in listOf(false,true))for(stopping in listOf(false,true)) {
            assertEquals(start && !room && !vpn && !stopping, InviteRemoval.allowed(start,room,vpn,stopping))
        }
    }
}
