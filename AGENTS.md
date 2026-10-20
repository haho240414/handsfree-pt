# 작업 규칙 (Codex · Claude Code 공용)

이 저장소는 사람 1명과 Codex, Claude Code 가 **같은 `main` 에 바로** 올린다(브랜치·PR 없이).
서로의 작업을 덮어쓰지 않고, 인식 정확도가 몰래 나빠지지 않게 아래를 지킨다.

## 시작 전
- **`git pull --rebase` 부터.** 다른 쪽이 그사이 올렸을 수 있다. 작업이 길었으면 올리기 직전에 한 번 더.
- 충돌이 나면 상대 쪽 변경을 살리는 방향으로 합친다(통째로 내 것으로 덮지 않기). 크게 엇갈렸으면 먼저 `backup/<날짜-내용>` 브랜치로 내 작업을 남겨 두고 합친다.

## 파일 담당
- `app/js/framing.js`(구도 안내), `app/css/redesign.css`(파란 디자인), `design-qa.md` 는 Codex 가 만든 것 — 고칠 땐 필요한 만큼만, 이유를 커밋 메시지에.
- 판단 엔진(`app/js/engine/`)은 같이 고친다. 대신 아래 시험을 고치기 전/후로 돌려 비교한다.

## 올리기 전 시험 (전부 통과해야 push)
```bash
npm test                                   # 단위 테스트 (합성 데이터 + 실제 영상 회귀)
node test/eval.mjs --model full            # 실제 영상: 횟수 49개·버티기 13개·오인식
node test/strength-eval.mjs                # 덤벨·근력 운동 정답표
node test/bodyweight-eval.mjs              # 맨몸 운동 정답표
node test/popular-eval.mjs                 # 자주 하는 근력 운동 정답표
node test/robust.mjs                       # 엔진을 고쳤을 때: 폰 기울기·저사양·몸 잘림 시뮬레이션
```
- 엔진을 고쳤으면 고치기 전/후 출력을 `diff` 해서 **바뀐 영상과 이유를 커밋 메시지에** 적는다. 한 영상을 고치려다 다른 영상이 나빠지면 올리지 않는다.
- 정답표(`test/*truth.json`)는 영상 장면 시트를 직접 보고 센 값이다. **엔진 결과에 맞춰 정답을 고치지 않는다.**
- `split: "holdout"` 영상은 규칙을 맞출 때 보지 않는다. 보고 맞췄으면 `dev` 로 바꾼다. 못 고친 오인식은 정답표 `view` 에 '알려진 한계'로 남긴다.
- 규칙의 숫자에는 실측 근거를 주석으로 단다(예: `// 실측(플랭크 영상 9개): 무릎 155° 이상 …`).

## 새 파일·안드로이드
- 앱이 쓰는 JS/CSS 를 새로 만들면 `app/sw.js` 의 `SHELL` 에 넣고 `VERSION` 을 올린다(안 그러면 설치된 앱이 옛 파일을 쓴다).
- 안드로이드 플러그인(`android/app/src/main/java/io/github/haho240414/handsfreept/`)을 추가하면 `MainActivity.java` 에 등록하고, CI 점검(`.github/scripts/webview-check.mjs`)에 그 플러그인을 확인하는 단계를 넣는다.
- APK 는 GitHub Actions 로만 만든다(이 맥에는 안드로이드 빌드 환경이 없다). push 뒤 Actions 의 'APK 빌드 → 에뮬레이터 점검 → 다운로드 링크 갱신'이 모두 초록인지 확인.

## 절대 하지 않기
- **`android-signing/`(서명 키)를 커밋하지 않는다.** `.gitignore` 에 있다. 키가 바뀌면 이미 설치한 폰이 업데이트를 못 받는다.
- 시험 영상(`test/videos*`)은 저작권 때문에 올리지 않는다. 영상에서 뽑은 관절 좌표(`test/fixtures/*.json`)만 올린다.
- 공개 저장소다: 토큰·개인 정보·사용자의 진단 기록 원본을 올리지 않는다.

## 말투
- 화면 문구·음성·주석·커밋 메시지는 한국어, 쉬운 말로. 영어 용어는 처음 나올 때 풀어서.
