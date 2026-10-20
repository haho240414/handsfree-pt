package io.github.haho240414.handsfreept

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 배터리 최적화(절전) 상태: 하루 목표 알림은 시스템 알람으로 거는데, 절전 대상이면 늦게 오거나
 * (삼성 '잠자는 앱'처럼) 아예 안 올 수 있다. 상태를 알려 주고 '제한 없음'으로 바꾸는 화면을 연다.
 */
@CapacitorPlugin(name = "HfptSystem")
class SystemPlugin : Plugin() {
    /** { ignoring: 배터리 최적화에서 빠졌는지, manufacturer, sdk } */
    @PluginMethod
    fun batteryStatus(call: PluginCall) {
        val pm = context.getSystemService(PowerManager::class.java)
        val o = JSObject()
        o.put("ignoring", pm?.isIgnoringBatteryOptimizations(context.packageName) == true)
        o.put("manufacturer", Build.MANUFACTURER ?: "")
        o.put("sdk", Build.VERSION.SDK_INT)
        call.resolve(o)
    }

    /**
     * '항상 백그라운드에서 실행' 허용 창(시스템이 띄움) → 안 되면 앱 정보(배터리 → 제한 없음) → 최적화 목록.
     * 직접 받은 APK 앱이라 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 를 써도 된다(플레이 스토어 정책 대상 아님)
     */
    @SuppressLint("BatteryLife")
    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        val pkg = context.packageName
        val tries = listOf(
            { Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$pkg")) },
            { Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")) },
            { Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS) },
        )
        for ((i, make) in tries.withIndex()) {
            try {
                context.startActivity(make().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                call.resolve(JSObject().put("opened", listOf("request", "appDetails", "list")[i]))
                return
            } catch (_: Exception) { /* 다음 방법 */ }
        }
        call.reject("설정 화면을 열지 못했어요")
    }
}
