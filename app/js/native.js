// 안드로이드 앱(Capacitor)으로 실행될 때만 쓰는 기능. 웹(브라우저)에선 모두 null 이라 기존 웹 기능을 쓴다.
// 안드로이드 WebView 는 웹 음성(speechSynthesis)·다운로드·화면 꺼짐 방지를 지원하지 않아서 네이티브로 대신한다.

import { Capacitor, registerPlugin } from '../vendor/capacitor/core.js';

export const isNative = Capacitor.isNativePlatform();
const plugin = (name) => (isNative && Capacitor.isPluginAvailable(name) ? registerPlugin(name) : null);

export const NativeTTS = plugin('TextToSpeech');
export const NativeApp = plugin('App');
const NativeShare = plugin('Share');
const NativeFS = plugin('Filesystem');
// 앱 안의 플러그인(android/.../HealthConnectPlugin.kt): 운동 기록을 헬스 커넥트(삼성 헬스 연동)에 쓰기
export const NativeHealth = Capacitor.getPlatform() === 'android' ? plugin('HealthConnect') : null;

/** 백업 파일을 공유 창으로 내보내기 (구글 드라이브·내 파일·카톡 등으로 저장) */
export async function shareTextFile(name, text) {
  const { uri } = await NativeFS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
  await NativeShare.share({ title: '핸즈프리 PT 백업', url: uri, dialogTitle: '백업 파일 저장' });
}
export const canShareFile = !!(NativeShare && NativeFS);

/**
 * 바이너리 파일(진단 기록 .gz 등)을 공유 창으로 내보내기.
 * 브리지로 한 번에 넘기기엔 커서(수 MB) 3MB씩 base64 로 나눠 이어 쓴다(3의 배수라 조각마다 따로 해독돼도 이어짐).
 */
export async function shareBinaryFile(name, bytes, title = '핸즈프리 PT 진단 기록') {
  const PIECE = 3 * 1024 * 1024;
  const b64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  let uri = null;
  for (let off = 0; off < bytes.length || off === 0; off += PIECE) {
    const data = b64(bytes.subarray(off, off + PIECE));
    if (off === 0) ({ uri } = await NativeFS.writeFile({ path: name, data, directory: 'CACHE' }));
    else await NativeFS.appendFile({ path: name, data, directory: 'CACHE' });
    if (bytes.length === 0) break;
  }
  await NativeShare.share({ title, url: uri, dialogTitle: '진단 기록 보내기' });
}
