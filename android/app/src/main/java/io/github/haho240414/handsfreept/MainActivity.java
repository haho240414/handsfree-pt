package io.github.haho240414.handsfreept;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 이 앱 안에 둔 플러그인: 운동 기록을 헬스 커넥트(삼성 헬스 연동)에 쓰기
        registerPlugin(HealthConnectPlugin.class);
        super.onCreate(savedInstanceState);
        // 폰을 세워두고 운동하는 앱이라 화면이 꺼지면 안 된다
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // 카메라 영상(video)을 탭 없이 재생 (카메라 켜기는 비동기라 탭 제스처가 끊긴 뒤 재생됨)
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
