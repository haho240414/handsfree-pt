package io.github.haho240414.handsfreept

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSegment
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Energy
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * 운동 기록을 헬스 커넥트(삼성 헬스·구글 피트니스 등이 함께 쓰는 안드로이드 건강 저장소)에 쓴다.
 * 쓰기만 한다: 운동 세션(종류·시간·세트별 종류와 횟수) + 그 시간의 칼로리 어림값. 건강 데이터는 읽지 않는다.
 * 같은 운동을 다시 보내면 clientRecordId 가 같아서 새로 생기지 않고 고쳐진다(세트를 고친 뒤 다시 저장).
 * 삼성 헬스는 '운동 세션' = ExerciseSessionRecord, '운동 칼로리' = TotalCaloriesBurnedRecord 로 주고받는다.
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val contract = PermissionController.createRequestPermissionResultContract()
    private val permissions = setOf(
        HealthPermission.getWritePermission(ExerciseSessionRecord::class),
        HealthPermission.getWritePermission(TotalCaloriesBurnedRecord::class),
    )

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        scope.cancel()
    }

    /** 헬스 커넥트 호출은 비동기라 코루틴에서: 어떤 오류든 약속을 거절로 끝내 앱 쪽이 멈추지 않게 한다 */
    private fun launchCall(call: PluginCall, block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Log.e(TAG, "헬스 커넥트 호출 실패", e)
                call.reject(e.message ?: e.javaClass.simpleName, null, e as? Exception ?: Exception(e))
            }
        }
    }

    private fun sdkStatus() = HealthConnectClient.getSdkStatus(context)

    private suspend fun currentStatus(): JSObject {
        val sdk = sdkStatus()
        val available = sdk == HealthConnectClient.SDK_AVAILABLE
        val granted = available &&
            HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions().containsAll(permissions)
        val o = JSObject()
        o.put("available", available)
        o.put("needsUpdate", sdk == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED)
        o.put("granted", granted)
        o.put("android", Build.VERSION.SDK_INT)
        return o
    }

    /** { available, needsUpdate, granted, android } */
    @PluginMethod
    fun status(call: PluginCall) {
        launchCall(call) { call.resolve(currentStatus()) }
    }

    /** 권한 창(헬스 커넥트가 띄움)을 열고, 닫힌 뒤의 상태를 돌려준다. 이미 허용됐거나 쓸 수 없으면 바로 상태만 */
    @PluginMethod
    fun requestPermission(call: PluginCall) {
        launchCall(call) {
            val st = currentStatus()
            if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE || st.optBoolean("granted")) {
                call.resolve(st)
                return@launchCall
            }
            startActivityForResult(call, contract.createIntent(context, permissions), "onPermissionResult")
        }
    }

    @ActivityCallback
    private fun onPermissionResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        launchCall(call) { call.resolve(currentStatus()) }
    }

    /**
     * 운동 1회를 쓴다. { id, start, end(ms), version, exerciseType, title, notes, kcal, segments:[{start,end,type,reps}] }
     * 세트(segment) 종류 번호는 앱(health.js)이 헬스 커넥트 상수표대로 정해 보낸다.
     */
    @PluginMethod
    fun writeWorkout(call: PluginCall) {
        val d = call.data
        val id = d.optString("id")
        val start = d.optLong("start", -1)
        val end = d.optLong("end", -1)
        if (id.isEmpty() || start <= 0 || end <= start) {
            call.reject("운동 기록이 올바르지 않아요(id·시작·끝)")
            return
        }
        val type = d.optInt("exerciseType", ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING)
        val version = d.optLong("version", System.currentTimeMillis())
        val title = d.optString("title").ifEmpty { null }
        val notes = d.optString("notes").ifEmpty { null }
        val kcal = d.optDouble("kcal", 0.0)
        val segs = d.optJSONArray("segments")
        launchCall(call) {
            if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
                call.reject("이 폰에선 헬스 커넥트를 쓸 수 없어요")
                return@launchCall
            }
            val client = HealthConnectClient.getOrCreate(context)
            val t0 = Instant.ofEpochMilli(start)
            val t1 = Instant.ofEpochMilli(end)
            val rules = ZoneId.systemDefault().rules
            val z0 = rules.getOffset(t0)
            val z1 = rules.getOffset(t1)
            val device = Device(Device.TYPE_PHONE, Build.MANUFACTURER, Build.MODEL)
            // 세트 구간: 운동 시간 안, 서로 겹치지 않게, 1초 이상인 것만 (헬스 커넥트 규칙)
            val segments = mutableListOf<ExerciseSegment>()
            var last = start
            for (i in 0 until (segs?.length() ?: 0)) {
                val o = segs?.optJSONObject(i) ?: continue
                val a = maxOf(o.optLong("start"), last)
                val b = minOf(o.optLong("end"), end)
                if (b - a < 1000) continue
                try {
                    segments += ExerciseSegment(
                        Instant.ofEpochMilli(a), Instant.ofEpochMilli(b),
                        o.optInt("type", ExerciseSegment.EXERCISE_SEGMENT_TYPE_OTHER_WORKOUT),
                        o.optInt("reps", 0).coerceAtLeast(0),
                    )
                    last = b
                } catch (e: IllegalArgumentException) {
                    Log.w(TAG, "세트 구간 건너뜀", e)
                }
            }
            fun session(exerciseType: Int, list: List<ExerciseSegment>) = ExerciseSessionRecord(
                t0, z0, t1, z1,
                Metadata.activelyRecorded(device, "hfpt-session-$id", version),
                exerciseType, title, notes, list,
            )
            // 운동 종류와 안 맞는 세트 종류가 섞이면 라이브러리가 거절한다 → '기타 운동'(모든 세트 종류 허용) → 세트 없이
            val record = try {
                session(type, segments)
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "운동 종류 $type 와 세트 종류가 맞지 않아 기타 운동으로", e)
                try {
                    session(ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT, segments)
                } catch (e2: IllegalArgumentException) {
                    session(type, emptyList())
                }
            }
            val records = mutableListOf<Record>(record)
            if (kcal > 0) {
                records += TotalCaloriesBurnedRecord(
                    t0, z0, t1, z1, Energy.kilocalories(kcal),
                    Metadata.activelyRecorded(device, "hfpt-kcal-$id", version),
                )
            }
            val res = client.insertRecords(records)
            val ids = JSArray()
            res.recordIdsList.forEach { ids.put(it) }
            val o = JSObject()
            o.put("ids", ids)
            o.put("segments", record.segments.size)
            o.put("exerciseType", record.exerciseType)
            call.resolve(o)
        }
    }

    /** 앱에서 운동 기록을 지우면 헬스 커넥트에 썼던 것도 지운다 { id } */
    @PluginMethod
    fun deleteWorkout(call: PluginCall) {
        val id = call.data.optString("id")
        if (id.isEmpty()) {
            call.reject("id 가 필요해요")
            return
        }
        launchCall(call) {
            if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
                call.reject("이 폰에선 헬스 커넥트를 쓸 수 없어요")
                return@launchCall
            }
            val client = HealthConnectClient.getOrCreate(context)
            client.deleteRecords(ExerciseSessionRecord::class, emptyList(), listOf("hfpt-session-$id"))
            client.deleteRecords(TotalCaloriesBurnedRecord::class, emptyList(), listOf("hfpt-kcal-$id"))
            call.resolve()
        }
    }

    /** 헬스 커넥트의 데이터 관리 화면(이 앱이 쓴 기록 보기·지우기·권한) */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        val tries = listOf(
            { HealthConnectClient.getHealthConnectManageDataIntent(context) },
            { Intent("androidx.health.ACTION_HEALTH_CONNECT_SETTINGS") },
        )
        for (make in tries) {
            try {
                context.startActivity(make().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                call.resolve()
                return
            } catch (e: Exception) {
                Log.w(TAG, "헬스 커넥트 화면 열기 실패", e)
            }
        }
        call.reject("헬스 커넥트 화면을 열지 못했어요")
    }

    /** 안드로이드 13 이하: 헬스 커넥트 앱 설치·업데이트(플레이 스토어) */
    @PluginMethod
    fun install(call: PluginCall) {
        val pkg = "com.google.android.apps.healthdata"
        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg&url=healthconnect%3A%2F%2Fonboarding"))
                    .setPackage("com.android.vending").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (e: Exception) {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
        call.resolve()
    }

    companion object {
        private const val TAG = "HfptHealth"
    }
}
