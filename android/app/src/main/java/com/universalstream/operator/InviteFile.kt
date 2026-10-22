package com.universalstream.operator

import java.io.InputStream

internal object InviteFile {
    fun read(input:InputStream,validate:(String)->Unit={ Enrollment.parse(it); Unit }):String {
        val bytes=ByteArray(4097)
        var size=0
        while(size<bytes.size) {
            val count=input.read(bytes,size,bytes.size-size)
            if(count<=0)break
            size+=count
        }
        require(size in 1..4096) { "Недопустимый размер файла" }
        val code=String(bytes,0,size,Charsets.UTF_8).removePrefix("\uFEFF").trim()
        require(code.length in 80..2500 && Regex("USCV1\\.[A-Za-z0-9_-]+").matches(code)) { "Неверный формат файла" }
        validate(code)
        return code
    }
}
