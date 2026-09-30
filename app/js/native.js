// 안드로이드 앱(Capacitor)으로 실행될 때만 쓰는 기능. 웹(브라우저)에선 모두 null 이라 기존 웹 기능을 쓴다.
// 안드로이드 WebView 는 웹 음성(speechSynthesis)·다운로드·화면 꺼짐 방지를 지원하지 않아서 네이티브로 대신한다.

import { Capacitor, registerPlugin } from '../vendor/capacitor/core.js';

export const isNative = Capacitor.isNativePlatform();
const plugin = (name) => (isNative && Capacitor.isPluginAvailable(name) ? registerPlugin(name) : null);

export const NativeTTS = plugin('TextToSpeech');
export const NativeApp = plugin('App');
const NativeShare = plugin('Share');
const NativeFS = plugin('Filesystem');

/** 백업 파일을 공유 창으로 내보내기 (구글 드라이브·내 파일·카톡 등으로 저장) */
export async function shareTextFile(name, text) {
  const { uri } = await NativeFS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
  await NativeShare.share({ title: '핸즈프리 PT 백업', url: uri, dialogTitle: '백업 파일 저장' });
}
export const canShareFile = !!(NativeShare && NativeFS);
