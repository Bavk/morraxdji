package com.universalstream.operator

fun main() {
    check(StreamProfile.entries.size == 3)
    check(StreamProfile.fromIndex(0).maxBitrate == 400_000)
    check(StreamProfile.fromIndex(1) == StreamProfile.STANDARD)
    check(StreamProfile.fromIndex(2).width == 1920)
    check(StreamProfile.fromIndex(-1) == StreamProfile.STANDARD)
    check(StreamProfile.fromIndex(999) == StreamProfile.STANDARD)
    check(StreamProfile.entries.all { it.width > 0 && it.height > 0 && it.fps in 1..30 && it.maxBitrate <= 3_000_000 })
    println("StreamProfile: 7 checks passed")
}
