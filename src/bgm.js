// ─── 幻想ナラトグラフ BGM モジュール ───────────────────────────────────────
// GM が gs.bgm.{explore,battle,end} に設定したトラックURLを、各クライアントが
// フェーズに応じてローカル再生する。2つの HTMLAudioElement でクロスフェード。
//
// ブラウザの自動再生制限のため、初回ユーザー操作後に unlock() を呼ぶまで鳴らない。
// 音量・ミュートは個人設定として localStorage に保存（既定はミュート起動）。

// スライダー値(0〜1)に対する実出力スケール。BGM 音源は SE より相対的に大きいため、
// スライダー50%(0.5) が実出力 0.05 程度（=従来の5%相当の快適音量）になるよう圧縮する。
const BGM_GAIN = 0.1;

let _volume = (() => {
  try { const v = parseFloat(localStorage.getItem("bgmVolume")); return isNaN(v) ? 0.5 : Math.min(1, Math.max(0, v)); }
  catch { return 0.5; }
})();
let _muted = (() => {
  try { const v = localStorage.getItem("bgmMuted"); return v === null ? true : v === "1"; }  // 既定ミュート
  catch { return true; }
})();

let _unlocked   = false;
let _desiredUrl = "";   // フェーズ由来の「鳴らすべきURL」
let _playingUrl = "";   // 実際に再生中のURL
let _players    = null; // [Audio, Audio]
let _activeIdx  = 0;
let _fadeTimer  = null;

function ensurePlayers() {
  if (_players) return;
  _players = [new Audio(), new Audio()];
  _players.forEach(a => { a.loop = true; a.preload = "auto"; a.volume = 0; });
}

function effVol() { return _muted ? 0 : _volume * BGM_GAIN; }

function clearFade() {
  if (_fadeTimer) { clearInterval(_fadeTimer); _fadeTimer = null; }
}

// 新トラックへクロスフェード（url="" なら停止フェード）
function transition(url) {
  ensurePlayers();
  if (url === _playingUrl) return;
  clearFade();

  const oldA = _players[_activeIdx];
  const fromOld = oldA.volume;

  if (!url) {
    // 停止: 現行をフェードアウト
    let t = 0; const step = 40, dur = 600;
    _fadeTimer = setInterval(() => {
      t += step; const k = Math.min(1, t / dur);
      oldA.volume = fromOld * (1 - k);
      if (k >= 1) { clearFade(); try { oldA.pause(); } catch {} }
    }, step);
    _playingUrl = "";
    return;
  }

  // 新規再生: 反対の要素にロードしてフェードイン
  const newIdx = 1 - _activeIdx;
  const newA = _players[newIdx];
  try {
    newA.src = url;
    newA.currentTime = 0;
    newA.volume = 0;
    const p = newA.play();
    if (p && p.catch) p.catch(() => {});  // 自動再生ブロックや無効URLは握りつぶす
  } catch {}

  const toNew = effVol();
  let t = 0; const step = 40, dur = 800;
  _fadeTimer = setInterval(() => {
    t += step; const k = Math.min(1, t / dur);
    newA.volume = toNew * k;
    oldA.volume = fromOld * (1 - k);
    if (k >= 1) { clearFade(); try { oldA.pause(); } catch {} }
  }, step);

  _activeIdx  = newIdx;
  _playingUrl = url;
}

// フェード中でなければ再生中要素の音量を即時反映
function applyVolumeNow() {
  if (!_players || _fadeTimer) return;
  const a = _players[_activeIdx];
  if (_playingUrl) a.volume = effVol();
}

export const bgm = {
  get volume() { return _volume; },
  get muted()  { return _muted; },
  get unlocked() { return _unlocked; },

  setVolume(v) {
    _volume = Math.min(1, Math.max(0, v));
    try { localStorage.setItem("bgmVolume", String(_volume)); } catch {}
    applyVolumeNow();
  },

  toggleMute() {
    _muted = !_muted;
    try { localStorage.setItem("bgmMuted", _muted ? "1" : "0"); } catch {}
    applyVolumeNow();
    // ミュート解除直後に、鳴らすべきトラックがまだ無音なら再開
    if (!_muted && _unlocked && _desiredUrl && _playingUrl !== _desiredUrl) {
      transition(_desiredUrl);
    }
    return _muted;
  },

  // フェーズ由来の「鳴らすべきURL」を設定（unlock 前は記憶のみ）
  setTrack(url) {
    _desiredUrl = url || "";
    if (!_unlocked) return;
    transition(_desiredUrl);
  },

  // 初回ユーザー操作のハンドラ内で呼ぶ（play() をジェスチャ起点にするため）
  unlock() {
    if (_unlocked) return;
    _unlocked = true;
    if (_desiredUrl) transition(_desiredUrl);
  },
};
