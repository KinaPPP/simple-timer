// ============================================================
// Just a Timer v2 - background.js
// ============================================================

const ALARM_NAME = 'timerTick';
const S = 128;

// ---------- Offscreen ----------

async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'タイマービープ音の再生'
    });
    // ロード完了を待つ
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

async function sendBeep(type) {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type });
}

// ---------- アイコン描画 ----------
// 通常    : ティール (#00695c) で分表示
// 残り1分未満: 赤 (#e53935) で秒表示
// 一時停止 : グレー (#9e9e9e) で分 or 秒表示
// 終了    : 赤 (#e53935) で "00"

function renderIcon(state, darkIcon = false) {
  // state: { mode, minutesLeft, secondsLeft }
  // mode: 'idle' | 'running' | 'paused' | 'finished'
  const canvas = new OffscreenCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.font = `bold 120px Georgia, serif`;
  ctx.textBaseline = 'middle';

  const { mode, minutesLeft, secondsLeft } = state;

  let text = '';
  let color = '#00695c';

  if (mode === 'idle') {
    text = 'ST'; color = darkIcon ? '#ffffff' : '#00695c';
  } else if (mode === 'finished') {
    text = '00'; color = '#e53935';
  } else if (mode === 'running') {
    if (secondsLeft < 60) {
      text = String(secondsLeft).padStart(2, '0'); color = '#e53935';
    } else {
      text = String(minutesLeft); color = darkIcon ? '#ffffff' : '#00695c';
    }
  } else if (mode === 'paused') {
    text = secondsLeft < 60
      ? String(secondsLeft).padStart(2, '0')
      : String(minutesLeft);
    color = darkIcon ? '#aaaaaa' : '#9e9e9e';
  }

  // テキスト幅を計測し、はみ出す場合は横スケールで収める
  const margin = 4;
  const maxW = S - margin * 2;
  const measuredW = ctx.measureText(text).width;
  const scaleX = measuredW > maxW ? maxW / measuredW : 1;

  ctx.save();
  ctx.translate(S / 2, S / 2 + 6);
  ctx.scale(scaleX, 1);
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();

  return ctx.getImageData(0, 0, S, S);
}

async function updateIcon(state) {
  const { darkIcon } = await chrome.storage.local.get('darkIcon');
  const imageData = renderIcon(state, !!darkIcon);
  await chrome.action.setIcon({ imageData });
  await chrome.action.setTitle({ title: 'シンプルタイマー' });
}

// ---------- ストレージ ----------

async function getState() {
  const d = await chrome.storage.local.get([
    'endTime', 'mode', 'totalSeconds', 'remainingSeconds', 'beepWarnFired'
  ]);
  return {
    endTime:          d.endTime          || 0,
    mode:             d.mode             || 'idle',   // idle | running | paused | finished
    totalSeconds:     d.totalSeconds     || 0,
    remainingSeconds: d.remainingSeconds || 0,
    beepWarnFired:    d.beepWarnFired    || false
  };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

// ---------- tick ----------

async function tick() {
  const state = await getState();
  if (state.mode !== 'running') return;

  const now = Date.now();
  const secondsLeft = Math.max(0, Math.round((state.endTime - now) / 1000));
  const minutesLeft = Math.floor(secondsLeft / 60);

  if (secondsLeft <= 0) {
    await setState({ mode: 'finished', remainingSeconds: 0 });
    await chrome.alarms.clear(ALARM_NAME);
    await updateIcon({ mode: 'finished', minutesLeft: 0, secondsLeft: 0 });
    await sendBeep('BEEP_END');
    // 終了後1分で自動リセット
    await chrome.alarms.create('autoReset', { delayInMinutes: 1 });
    try {
      await chrome.notifications.create('timerDone', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'シンプルタイマー',
        message: '時間です。'
      });
    } catch (_) {}
  } else {
    // 残り10秒ビープ（1回だけ）
    if (secondsLeft <= 10 && !state.beepWarnFired) {
      await setState({ beepWarnFired: true });
      await sendBeep('BEEP_WARN');
    }
    await setState({ remainingSeconds: secondsLeft });
    await updateIcon({ mode: 'running', minutesLeft, secondsLeft });
  }
}

// ---------- メッセージ ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {

    if (msg.type === 'START') {
      const seconds = msg.seconds;
      const endTime = Date.now() + seconds * 1000;
      await setState({
        endTime,
        mode: 'running',
        totalSeconds: seconds,
        remainingSeconds: seconds,
        beepWarnFired: false
      });
      await updateIcon({
        mode: 'running',
        minutesLeft: Math.floor(seconds / 60),
        secondsLeft: seconds
      });
      await chrome.alarms.clear(ALARM_NAME);
      await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 / 60 });
      sendResponse({ ok: true });

    } else if (msg.type === 'PAUSE') {
      const state = await getState();
      if (state.mode !== 'running') { sendResponse({ ok: false }); return; }
      const secondsLeft = Math.max(0, Math.round((state.endTime - Date.now()) / 1000));
      const minutesLeft = Math.floor(secondsLeft / 60);
      await setState({ mode: 'paused', remainingSeconds: secondsLeft });
      await chrome.alarms.clear(ALARM_NAME);
      await updateIcon({ mode: 'paused', minutesLeft, secondsLeft });
      sendResponse({ ok: true, secondsLeft });

    } else if (msg.type === 'RESUME') {
      const state = await getState();
      if (state.mode !== 'paused') { sendResponse({ ok: false }); return; }
      const secondsLeft = state.remainingSeconds;
      const endTime = Date.now() + secondsLeft * 1000;
      await setState({
        mode: 'running',
        endTime,
        beepWarnFired: secondsLeft <= 10 ? true : state.beepWarnFired
      });
      await updateIcon({
        mode: 'running',
        minutesLeft: Math.floor(secondsLeft / 60),
        secondsLeft
      });
      await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 / 60 });
      sendResponse({ ok: true });

    } else if (msg.type === 'UPDATE_ICON') {
      const state = await getState();
      const secondsLeft = state.mode === 'running'
        ? Math.max(0, Math.round((state.endTime - Date.now()) / 1000))
        : state.remainingSeconds;
      await updateIcon({ mode: state.mode, minutesLeft: Math.floor(secondsLeft / 60), secondsLeft });
      sendResponse({ ok: true });

    } else if (msg.type === 'RESET') {
      await setState({
        mode: 'idle',
        endTime: 0,
        totalSeconds: 0,
        remainingSeconds: 0,
        beepWarnFired: false
      });
      await chrome.alarms.clear(ALARM_NAME);
      await updateIcon({ mode: 'idle', minutesLeft: 0, secondsLeft: 0 });
      sendResponse({ ok: true });

    } else if (msg.type === 'GET_STATE') {
      const state = await getState();
      let secondsLeft = state.remainingSeconds;
      if (state.mode === 'running') {
        secondsLeft = Math.max(0, Math.round((state.endTime - Date.now()) / 1000));
      }
      sendResponse({ ...state, secondsLeft });
    }

  })();
  return true;
});

// ---------- アラーム ----------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) tick();
  if (alarm.name === 'autoReset') {
    (async () => {
      const state = await getState();
      if (state.mode === 'finished') {
        await setState({
          mode: 'idle', endTime: 0,
          totalSeconds: 0, remainingSeconds: 0, beepWarnFired: false
        });
        await updateIcon({ mode: 'idle', minutesLeft: 0, secondsLeft: 0 });
      }
    })();
  }
});

// ---------- 起動時復元 ----------

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  if (state.mode === 'running') {
    const secondsLeft = Math.max(0, Math.round((state.endTime - Date.now()) / 1000));
    if (secondsLeft > 0) {
      await updateIcon({
        mode: 'running',
        minutesLeft: Math.floor(secondsLeft / 60),
        secondsLeft
      });
      await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 / 60 });
    } else {
      await setState({ mode: 'finished' });
      await updateIcon({ mode: 'finished', minutesLeft: 0, secondsLeft: 0 });
    }
  } else if (state.mode === 'paused') {
    await updateIcon({
      mode: 'paused',
      minutesLeft: Math.floor(state.remainingSeconds / 60),
      secondsLeft: state.remainingSeconds
    });
  } else if (state.mode === 'finished') {
    await updateIcon({ mode: 'finished', minutesLeft: 0, secondsLeft: 0 });
  } else {
    await updateIcon({ mode: 'idle', minutesLeft: 0, secondsLeft: 0 });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await updateIcon({ mode: 'idle', minutesLeft: 0, secondsLeft: 0 });
});
