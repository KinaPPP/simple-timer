// ============================================================
// Just a Timer v2 - popup.js
// ============================================================

let input = '';
let currentMode = 'idle'; // idle | running | paused | finished
let tickInterval = null;
let currentEndTime = 0;
let currentSecondsLeft = 0;

const display    = document.getElementById('display');
const dispNumber = document.getElementById('dispNumber');
const numpad     = document.getElementById('numpad');
const btnStart   = document.getElementById('btnStart');
const btnReset   = document.getElementById('btnReset');

// ---------- 時間フォーマット ----------

function fmt(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}′${s}″`;
}

// ---------- UI状態切替 ----------

function setModeInput() {
  currentMode = 'idle';
  stopTick();

  display.className = 'time-display mode-input';
  display.onclick = null;
  display.innerHTML = `
    <div class="number" id="dispNumber">${input === '' ? 0 : parseInt(input)}</div>
    <div class="unit-col">
      <div class="unit">分</div>
      <div class="hint">最大99分</div>
    </div>`;

  unlockNumpad();
  btnStart.disabled = (input === '' || parseInt(input) === 0);
  btnStart.textContent = 'スタート ▶';
}

function setModeRunning(secondsLeft) {
  currentMode = 'running';

  display.className = 'time-display mode-running';
  display.onclick = onDisplayClick;
  display.innerHTML = `
    <div class="remaining">⏱ ${fmt(secondsLeft)}</div>
    <div class="sub-hint">クリックで一時停止</div>`;

  lockNumpad();
  btnStart.disabled = true;
  btnStart.textContent = 'カウント中 ⏱';
  startTick();
}

function setModePaused(secondsLeft) {
  currentMode = 'paused';
  stopTick();

  display.className = 'time-display mode-paused';
  display.onclick = onDisplayClick;
  display.innerHTML = `
    <div class="remaining">– ${fmt(secondsLeft)} –</div>
    <div class="sub-hint">クリックで再開</div>`;

  lockNumpad();
  btnStart.disabled = true;
  btnStart.textContent = '一時停止中';
}

function setModeFinished() {
  currentMode = 'finished';
  stopTick();

  display.className = 'time-display mode-finished';
  display.onclick = null;
  display.innerHTML = `
    <div class="remaining">00′00″</div>
    <div class="sub-hint">■ でリセット</div>`;

  lockNumpad();
  btnStart.disabled = true;
  btnStart.textContent = '終了';
}

// ---------- ディスプレイクリック（一時停止 / 再開） ----------

function onDisplayClick() {
  if (currentMode === 'running') {
    chrome.runtime.sendMessage({ type: 'PAUSE' }, (res) => {
      if (res?.ok) setModePaused(res.secondsLeft);
    });
  } else if (currentMode === 'paused') {
    chrome.runtime.sendMessage({ type: 'RESUME' }, (res) => {
      if (res?.ok) setModeRunning(currentSecondsLeft);
    });
  }
}

// ---------- ローカルtick（表示更新用） ----------

function startTick() {
  stopTick();
  tickInterval = setInterval(() => {
    const left = Math.max(0, Math.round((currentEndTime - Date.now()) / 1000));
    currentSecondsLeft = left;
    if (left <= 0) {
      stopTick();
      setModeFinished();
      return;
    }
    // 表示更新
    const rem = display.querySelector('.remaining');
    if (rem) rem.textContent = `⏱ ${fmt(left)}`;
  }, 250);
}

function stopTick() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

// ---------- テンキーロック ----------

function lockNumpad() {
  document.querySelectorAll('.key').forEach(k => k.classList.add('locked'));
}

function unlockNumpad() {
  document.querySelectorAll('.key').forEach(k => k.classList.remove('locked'));
}

// ---------- テンキー入力 ----------

function updateInputDisplay() {
  const el = document.getElementById('dispNumber');
  if (el) el.textContent = input === '' ? 0 : parseInt(input);
  btnStart.disabled = (input === '' || parseInt(input) === 0);
}

function pressNum(d) {
  if (currentMode !== 'idle') return;
  if (input.length >= 2) return;
  if (input === '') { input = d === '0' ? '' : d; }
  else { input += d; }
  if (input !== '' && parseInt(input) > 99) input = '99';
  updateInputDisplay();
}

function pressClear() {
  if (currentMode !== 'idle') return;
  input = '';
  updateInputDisplay();
}

function pressDel() {
  if (currentMode !== 'idle') return;
  input = input.slice(0, -1);
  updateInputDisplay();
}

// ---------- ボタン紐付け ----------

for (let i = 0; i <= 9; i++) {
  document.getElementById(`k${i}`).addEventListener('click', () => pressNum(String(i)));
}
document.getElementById('kClear').addEventListener('click', pressClear);
document.getElementById('kDel').addEventListener('click', pressDel);

btnStart.addEventListener('click', () => {
  const minutes = parseInt(input) || 0;
  if (minutes === 0) return;
  const seconds = minutes * 60;
  currentEndTime = Date.now() + seconds * 1000;
  currentSecondsLeft = seconds;
  chrome.runtime.sendMessage({ type: 'START', seconds });
  setModeRunning(seconds);
  window.close();
});

btnReset.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESET' });
  input = '';
  setModeInput();
});

// ---------- 初期状態の復元 ----------

chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
  if (!state) return;
  currentSecondsLeft = state.secondsLeft;

  if (state.mode === 'running') {
    currentEndTime = state.endTime;
    setModeRunning(state.secondsLeft);
  } else if (state.mode === 'paused') {
    setModePaused(state.secondsLeft);
  } else if (state.mode === 'finished') {
    setModeFinished();
  } else {
    setModeInput();
  }
});

// ---------- ダークモードトグル ----------

const darkToggle = document.getElementById('darkToggle');

chrome.storage.local.get('darkIcon', (data) => {
  darkToggle.checked = !!data.darkIcon;
});

darkToggle.addEventListener('change', () => {
  chrome.storage.local.set({ darkIcon: darkToggle.checked });
  chrome.runtime.sendMessage({ type: 'UPDATE_ICON' });
});
