package io.github.haho240414.handsfreept

import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 카메라마다 시야각: 웹(WebView)은 카메라 목록만 알고 시야각은 모른다.
 * 렌즈 초점거리·센서 크기(실제로 쓰는 active array 만큼)로 계산한다. 카메라를 열지 않아서 바로 끝난다.
 * WebView 카메라 이름 'camera2 N, facing back' 의 N 이 여기 목록의 순서(index)다.
 * (핏락 FitLockPlugin.listCameras 에서 가져옴 — WebView 줌은 화면을 잘라 내는 방식이라 1배 아래로 못 가서,
 *  넓게 보려면 폰이 따로 보여 주는 광각 카메라를 직접 골라야 한다)
 */
@CapacitorPlugin(name = "CameraInfo")
class CameraInfoPlugin : Plugin() {
    @PluginMethod
    fun listCameras(call: PluginCall) {
        val out = JSArray()
        try {
            val cm = context.getSystemService(CameraManager::class.java)
            val ids = cm?.cameraIdList ?: emptyArray()
            ids.forEachIndexed { index, id ->
                val o = JSObject()
                o.put("index", index)
                o.put("id", id)
                try {
                    val c = cm!!.getCameraCharacteristics(id)
                    o.put("facing", when (c.get(CameraCharacteristics.LENS_FACING)) {
                        CameraCharacteristics.LENS_FACING_FRONT -> "front"
                        CameraCharacteristics.LENS_FACING_BACK -> "back"
                        else -> "external"
                    })
                    val focals = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
                    val phys = c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
                    val pixel = c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
                    val active = c.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
                    val f = focals?.minOrNull()
                    if (f != null && f > 0f && phys != null) {
                        var w = phys.width.toDouble()
                        var h = phys.height.toDouble()
                        if (pixel != null && active != null && pixel.width > 0 && pixel.height > 0) {
                            w = w * active.width() / pixel.width
                            h = h * active.height() / pixel.height
                        }
                        val deg = { size: Double -> Math.toDegrees(2 * Math.atan(size / (2.0 * f))) }
                        o.put("focal", f.toDouble())
                        o.put("fovLong", deg(maxOf(w, h)))   // 폰을 세로로 세우면 위아래 시야
                        o.put("fovShort", deg(minOf(w, h)))  // 세로로 세우면 좌우 시야
                        o.put("fovDiag", deg(Math.hypot(w, h)))
                    }
                    if (Build.VERSION.SDK_INT >= 30) {
                        c.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)?.let {
                            o.put("zoomMin", it.lower.toDouble())
                            o.put("zoomMax", it.upper.toDouble())
                        }
                    }
                    if (Build.VERSION.SDK_INT >= 28) {
                        val caps = c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
                        o.put("logical", caps?.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA) == true)
                        o.put("physicalCount", c.physicalCameraIds.size)
                    }
                } catch (e: Exception) {
                    o.put("error", e.message ?: "characteristics")
                }
                out.put(o)
            }
        } catch (e: Exception) {
            call.reject("카메라 목록을 못 읽었어요: ${e.message}")
            return
        }
        call.resolve(JSObject().put("cameras", out))
    }
}
