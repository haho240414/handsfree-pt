#!/usr/bin/env bash
# 에뮬레이터 점검: 설치 → 실행 → WebView 안에서 앱 상태 확인 → 카메라로 운동 화면 20초 → 스크린샷·로그 저장
set -euo pipefail
APK="$1"; OUT="$2"; PKG=io.github.haho240414.handsfreept
mkdir -p "$OUT"
adb install -r "$APK"
adb shell pm grant "$PKG" android.permission.CAMERA
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity"
sleep 15
adb exec-out screencap -p > "$OUT/1_home.png"
PID="$(adb shell pidof "$PKG" | tr -d '\r')"
adb forward tcp:9222 "localabstract:webview_devtools_remote_${PID}"
set +e
node .github/scripts/webview-check.mjs "$OUT"
STATUS=$?
set -e
adb logcat -d > "$OUT/logcat.txt" || true
exit $STATUS
