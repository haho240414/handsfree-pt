#!/bin/bash
# app/ 폴더만 GitHub Pages 로 공개 배포 → 폰에서 https 주소로 접속해 '홈 화면에 추가'해서 쓴다.
# (카메라는 https 에서만 켜지므로 폰에서 쓰려면 이 배포가 필요)  사용: tools/deploy-pages.sh [저장소이름]
set -euo pipefail
cd "$(dirname "$0")/.."
GH="${GH:-$(command -v gh || echo "$HOME/bin/gh")}"
REPO="${1:-handsfree-pt}"
OWNER="$("$GH" api user -q .login)"
TMP="$(mktemp -d)"
cp -R app/. "$TMP/"
touch "$TMP/.nojekyll"
cd "$TMP"
git init -q -b main
git add -A
git commit -qm "핸즈프리 PT 배포 $(date +%Y-%m-%d)"
if ! "$GH" repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  "$GH" repo create "$OWNER/$REPO" --public --description "핸즈프리 PT — 카메라가 운동을 알아보고 세고 자세를 교정하는 웹앱(PWA)"
fi
"$GH" auth setup-git >/dev/null
git remote add origin "https://github.com/$OWNER/$REPO.git"
git push -qf origin main
"$GH" api -X POST "repos/$OWNER/$REPO/pages" -f 'source[branch]=main' -f 'source[path]=/' >/dev/null 2>&1 || true
echo "배포 완료(반영까지 1~2분): https://$OWNER.github.io/$REPO/"
