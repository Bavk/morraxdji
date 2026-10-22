package com.universalstream.operator

/** Quality is fixed before publishing a MediaProjection session, not adjusted mid-broadcast.
 * Conservative 15 fps keeps fine telemetry legible without saturating mobile connections.
 */
internal enum class StreamProfile(val width: Int, val height: Int, val fps: Int, val maxBitrate: Int) {
    ECONOMY(640, 360, 15, 400_000),
    STANDARD(1280, 720, 15, 1_200_000),
    DETAIL(1920, 1080, 15, 2_500_000);

    companion object {
        fun fromIndex(index: Int): StreamProfile = entries.getOrElse(index) { STANDARD }
        fun fromPolicy(policy:String,localIndex:Int):StreamProfile=when(policy){
            "economy"->ECONOMY
            "standard"->STANDARD
            "detail"->DETAIL
            else->fromIndex(localIndex)
        }
    }
}
