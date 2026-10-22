package com.universalstream.operator

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream

class InviteFileTest {
    private val synthetic="USCV1."+"a".repeat(100)
    @Test fun acceptsBomAndTrailingWhitespaceAndCallsValidator() {
        var validated=false
        val result=InviteFile.read(ByteArrayInputStream(("\uFEFF"+synthetic+"\r\n").toByteArray())) { assertEquals(synthetic,it);validated=true }
        assertTrue(validated);assertEquals(synthetic,result)
    }
    @Test fun rejectsWrongFormatsAndPropagatesValidationFailure() {
        for(text in listOf("", "commands", "USCV1.short", synthetic+"\ncommands", "USCV1."+"a".repeat(2500))) {
            try { InviteFile.read(ByteArrayInputStream(text.toByteArray())) { fail("Validator must not run") };fail("Invalid input accepted") } catch(_:IllegalArgumentException) { }
        }
        try { InviteFile.read(ByteArrayInputStream(synthetic.toByteArray())) { throw IllegalArgumentException("invalid enrollment") };fail("Validation bypassed") } catch(_:IllegalArgumentException) { }
    }
    @Test fun neverReadsAnUnboundedFile() {
        var count=0
        val stream=object:InputStream(){override fun read():Int {count++;return 65}}
        try { InviteFile.read(stream) { fail("Oversized file validated") };fail("Oversized file accepted") } catch(_:IllegalArgumentException) { }
        assertEquals(4097,count)
    }
}
