// 하루 목표 알림: 안드로이드 앱에서만 (웹은 앱이 꺼져 있으면 알림을 띄울 수 없다).
// 앞으로 14일치 알림을 미리 걸어 두고, 앱을 열 때·운동을 기록할 때·목표를 바꿀 때마다 다시 계산한다.
// → 목표를 채운 날은 그날 알림이 지워지고, 앱을 며칠 안 열어도 알림은 온다. 무엇을 언제 보낼지는 goal.js(reminderPlan).

import { NativeNotify } from './native.js';
import * as store from './store.js';
import { reminderPlan, isReminderId } from './goal.js';

const CHANNEL = 'goal';
const TEST_ID = 100000001;
export const canRemind = !!NativeNotify;

let channelReady = false;
async function ensureChannel() {
  if (channelReady) return;
  await NativeNotify.createChannel({
    id: CHANNEL, name: '하루 목표 알림', description: '하루 목표를 아직 못 채운 날 정한 시각에 알려줘요',
    importance: 4, vibration: true, visibility: 1,
  });
  channelReady = true;
}

/** 알림 권한: 'granted' | 'denied' | 'prompt' | 'unavailable'. ask 면 권한 창을 띄운다(안드로이드 13+) */
export async function notifyPermission({ ask = false } = {}) {
  if (!NativeNotify) return 'unavailable';
  try {
    let st = await NativeNotify.checkPermissions();
    if (st.display !== 'granted' && ask) st = await NativeNotify.requestPermissions();
    return st.display === 'granted' ? 'granted' : st.display === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unavailable';
  }
}

let chain = Promise.resolve();
/** 걸어 둔 목표 알림을 지금 기록·목표에 맞게 다시 건다. 여러 곳에서 동시에 불러도 차례로 한 번씩 */
export function syncReminders() {
  chain = chain.then(doSync, doSync);
  return chain;
}

async function doSync() {
  if (!NativeNotify) return { ok: false, reason: 'web', count: 0 };
  try {
    const pending = (await NativeNotify.getPending()).notifications || [];
    const ours = pending.filter((n) => isReminderId(Number(n.id)));
    if (ours.length) await NativeNotify.cancel({ notifications: ours.map((n) => ({ id: Number(n.id) })) });
    const plan = reminderPlan(store.goal(), store.sessions(), Date.now(), 14);
    if (!plan.length) return { ok: true, count: 0 };
    if ((await notifyPermission()) !== 'granted') return { ok: false, reason: 'permission', count: 0 };
    await ensureChannel();
    await NativeNotify.schedule({
      notifications: plan.map((p) => ({
        id: p.id, title: p.title, body: p.body, largeBody: p.body, channelId: CHANNEL,
        // 몇 분 늦어도 되는 알림: '정확한 알람' 권한 화면을 띄우지 않고, 절전(도즈) 중에도 오게
        schedule: { at: new Date(p.at), allowWhileIdle: true }, isExactNotification: false,
        autoCancel: true, extra: { kind: 'goal', day: p.day },
      })),
    });
    return { ok: true, count: plan.length, next: plan[0] };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e), count: 0 };
  }
}

/** 알림이 실제로 오는지 시험: 몇 초 뒤 한 번 */
export async function testReminder(sec = 5) {
  if (!NativeNotify) return false;
  if ((await notifyPermission({ ask: true })) !== 'granted') return false;
  await ensureChannel();
  await NativeNotify.schedule({
    notifications: [{
      id: TEST_ID, title: '알림 시험', body: '이렇게 알려드려요. 하루 목표를 못 채운 날 정한 시각에 와요', channelId: CHANNEL,
      schedule: { at: new Date(Date.now() + sec * 1000), allowWhileIdle: true }, isExactNotification: false,
      autoCancel: true, extra: { kind: 'test' },
    }],
  });
  return true;
}

/** 알림을 눌러 앱이 열렸을 때 */
export function onReminderTap(fn) {
  NativeNotify?.addListener('localNotificationActionPerformed', (a) => {
    const kind = a?.notification?.extra?.kind;
    if (kind === 'goal' || kind === 'test') fn(a.notification.extra);
  });
}
