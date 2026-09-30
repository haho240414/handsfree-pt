#!/usr/bin/env bash
# 에뮬레이터 점검: 설치 → 실행 → WebView 안에서 단계별 확인(앱·엔진·AI 모델·카메라) → 스크린샷·로그 저장
# 에뮬레이터가 멈춰도 점검이 끝없이 기다리지 않도록 adb 에 제한 시간을 둔다
set -uo pipefail
APK="$1"; OUT="$2"; PKG=io.github.haho240414.handsfreept
mkdir -p "$OUT"
A() { timeout 90 adb "$@"; }
echo "== 설치"; A install -r "$APK" || exit 1
A shell pm grant "$PKG" android.permission.CAMERA
A logcat -c
echo "== 실행"; A shell am start -n "$PKG/.MainActivity"
sleep 20
A exec-out screencap -p > "$OUT/1_home.png"
PID="$(A shell pidof "$PKG" | tr -d '\r')"
echo "== 앱 프로세스 $PID"
A forward tcp:9222 "localabstract:webview_devtools_remote_${PID}"
node .github/scripts/webview-check.mjs "$OUT"
STATUS=$?
A logcat -d -t 3000 > "$OUT/logcat.txt"
echo "== 점검 종료 코드 $STATUS"
exit $STATUS
