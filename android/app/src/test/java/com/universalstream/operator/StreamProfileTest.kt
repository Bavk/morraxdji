package com.universalstream.operator
import org.junit.Assert.assertEquals
import org.junit.Test
class StreamProfileTest {
 @Test fun adminProfileOverridesLocalPreference(){
  assertEquals(StreamProfile.ECONOMY,StreamProfile.fromPolicy("economy",2))
  assertEquals(StreamProfile.STANDARD,StreamProfile.fromPolicy("standard",0))
  assertEquals(StreamProfile.DETAIL,StreamProfile.fromPolicy("detail",0))
 }
 @Test fun automaticAndOldServerUseSavedLocalPreference(){
  assertEquals(StreamProfile.DETAIL,StreamProfile.fromPolicy("auto",2))
  assertEquals(StreamProfile.ECONOMY,StreamProfile.fromPolicy("",0))
  assertEquals(StreamProfile.STANDARD,StreamProfile.fromPolicy("auto",-1))
 }
}
