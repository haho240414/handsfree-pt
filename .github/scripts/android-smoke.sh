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
# 에뮬레이터가 막 부팅된 직후엔 실행 명령이 묻히기도 한다(실측: 20초 뒤 홈 화면, 프로세스 없음) → 프로세스가 뜰 때까지 최대 3번
PID=""
for TRY in 1 2 3; do
  echo "== 실행 ($TRY)"; A shell am start -W -n "$PKG/.MainActivity"
  for _ in $(seq 1 15); do
    sleep 2
    PID="$(A shell pidof "$PKG" | tr -d '\r')"
    [ -n "$PID" ] && break
  done
  [ -n "$PID" ] && break
  A logcat -d > "$OUT/logcat_try$TRY.txt"
done
sleep 12 # WebView 가 화면을 그릴 시간
A exec-out screencap -p > "$OUT/1_home.png"
PID2="$(A shell pidof "$PKG" | tr -d '\r')"
echo "== 앱 프로세스 $PID (12초 뒤 $PID2)"
[ -n "$PID2" ] && PID="$PID2"
A forward tcp:9222 "localabstract:webview_devtools_remote_${PID}"
node .github/scripts/webview-check.mjs "$OUT"
STATUS=$?
A logcat -d > "$OUT/logcat.txt"
echo "== 점검 종료 코드 $STATUS"
exit $STATUS
