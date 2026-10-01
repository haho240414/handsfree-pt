package io.github.haho240414.handsfreept

import android.app.Activity
import android.os.Bundle
import android.webkit.WebView

/**
 * 헬스 커넥트가 "이 앱은 건강 데이터를 왜 쓰나요?"를 보여줄 때 여는 화면(권한 창·설정의 개인정보 처리방침 링크).
 * 앱에 들어 있는 privacy.html 을 그대로 보여준다. 이 화면이 없으면 헬스 커넥트가 권한 창을 띄우지 않는다.
 */
class HealthPrivacyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this)
        web.settings.javaScriptEnabled = false
        setContentView(web)
        web.loadUrl("file:///android_asset/public/privacy.html")
    }
}
