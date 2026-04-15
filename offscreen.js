// ============================================================
// シンプルタイマー v1.1 - offscreen.js
// ============================================================

const VOLUME = 0.4;

function playSound() {
  const audio = new Audio(chrome.runtime.getURL('sound.mp3'));
  audio.volume = VOLUME;
  audio.play();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'BEEP_WARN') {
    playSound();
  }
  if (msg.type === 'BEEP_END') {
    playSound();
    setTimeout(() => playSound(), 400);
    setTimeout(() => playSound(), 800);
  }
});
