package com.yuanio.app.data

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class DiscoveredAgent(
    val host: String,
    val port: Int,
    val name: String
)

/**
 * 通过 NsdManager mDNS 发现局域网内的 Yuanio Agent 服务。
 * 服务类型: _yuanio._tcp
 */
class LocalDiscovery(context: Context) {

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val serviceType = "_yuanio._tcp."

    private val _agents = MutableStateFlow<List<DiscoveredAgent>>(emptyList())
    val agents = _agents.asStateFlow()

    private val _scanning = MutableStateFlow(false)
    val scanning = _scanning.asStateFlow()

    private var listener: NsdManager.DiscoveryListener? = null
    private val resolvingServiceKeys = mutableSetOf<String>()

    fun startScan() {
        if (_scanning.value) return
        _agents.value = emptyList()
        _scanning.value = true

        listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {}

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                resolveFoundService(serviceInfo)
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                removeTrackingForService(serviceKey(serviceInfo))
                _agents.value = _agents.value.filter { it.name != serviceInfo.serviceName }
            }

            override fun onDiscoveryStopped(serviceType: String) {
                _scanning.value = false
                clearServiceResolutionTracking()
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                _scanning.value = false
                clearServiceResolutionTracking()
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                _scanning.value = false
                clearServiceResolutionTracking()
            }
        }

        runCatching {
            nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
        }.onFailure {
            _scanning.value = false
        }
    }

    fun stopScan() {
        listener?.let {
            runCatching { nsdManager.stopServiceDiscovery(it) }
        }
        listener = null
        clearServiceResolutionTracking()
        _scanning.value = false
    }

    fun release() {
        stopScan()
        _agents.value = emptyList()
    }

    private fun resolveFoundService(serviceInfo: NsdServiceInfo) {
        val key = serviceKey(serviceInfo)
        synchronized(resolvingServiceKeys) {
            if (!resolvingServiceKeys.add(key)) return
        }
        val resolveListener = createResolveListener(key)
        runCatching {
            resolveServiceLegacy(serviceInfo, resolveListener)
        }.onFailure {
            synchronized(resolvingServiceKeys) {
                resolvingServiceKeys.remove(key)
            }
        }
    }

    private fun createResolveListener(serviceKey: String) = object : NsdManager.ResolveListener {
        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
            synchronized(resolvingServiceKeys) {
                resolvingServiceKeys.remove(serviceKey)
            }
        }

        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
            synchronized(resolvingServiceKeys) {
                resolvingServiceKeys.remove(serviceKey)
            }
            upsertAgent(serviceInfo)
        }
    }

    private fun upsertAgent(serviceInfo: NsdServiceInfo) {
        val host = resolvedHostAddress(serviceInfo) ?: return
        val port = serviceInfo.port
        val name = serviceInfo.serviceName
        val agent = DiscoveredAgent(host, port, name)
        val current = _agents.value.toMutableList()
        if (current.none { it.host == host && it.port == port }) {
            current.add(agent)
            _agents.value = current
        }
    }

    private fun removeTrackingForService(serviceKey: String) {
        synchronized(resolvingServiceKeys) {
            resolvingServiceKeys.remove(serviceKey)
        }
    }

    private fun clearServiceResolutionTracking() {
        synchronized(resolvingServiceKeys) {
            resolvingServiceKeys.clear()
        }
    }

    private fun resolvedHostAddress(serviceInfo: NsdServiceInfo): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return serviceInfo.hostAddresses.firstOrNull()?.hostAddress
        }
        @Suppress("DEPRECATION")
        return serviceInfo.host?.hostAddress
    }

    private fun serviceKey(serviceInfo: NsdServiceInfo): String {
        return "${serviceInfo.serviceName}|${serviceInfo.serviceType}"
    }

    @Suppress("DEPRECATION")
    private fun resolveServiceLegacy(
        serviceInfo: NsdServiceInfo,
        listener: NsdManager.ResolveListener,
    ) {
        nsdManager.resolveService(serviceInfo, listener)
    }
}
