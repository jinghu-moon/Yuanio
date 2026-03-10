package sy.yuanio.app.ui.screen

import android.app.Application
import sy.yuanio.app.YuanioApp
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class ChatViewModelSessionGatewayTest {

    @Test
    fun resolveSessionGateway应返回应用级共享实例() {
        val app = YuanioApp()

        val resolved = resolveSessionGateway(app)

        assertSame(app.sessionGateway, resolved)
    }

    @Test
    fun resolveSessionGateway遇到非YuanioApp应快速失败() {
        val app = Application()

        assertThrows(IllegalArgumentException::class.java) {
            resolveSessionGateway(app)
        }
    }
}

