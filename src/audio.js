// ─── 幻想ナラトグラフ 効果音モジュール ───────────────────────────────────────
// Web Audio API でブラウザ内合成。外部ファイル不要。
// AudioContext はユーザー操作後（最初の sfx 呼び出し時）に初期化される。

let _ctx = null;
let _enabled = (() => {
  try { return localStorage.getItem("sfxMuted") !== "1"; } catch { return true; }
})();

function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}

// 単音オシレーター: type, 開始周波数, 開始時刻, 継続秒, ピーク音量, [終了周波数]
function tone(type, freq, t, dur, vol, freqEnd) {
  const c = getCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.connect(g);
  g.connect(c.destination);
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.01);
}

// バンドパスフィルター付きホワイトノイズバースト
function burst(t, dur, vol, filterHz) {
  const c = getCtx();
  const size = Math.ceil(c.sampleRate * dur);
  const buf  = c.createBuffer(1, size, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = filterHz || 1200;
  filt.Q.value = 0.7;
  const g = c.createGain();
  src.connect(filt);
  filt.connect(g);
  g.connect(c.destination);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.start(t);
  src.stop(t + dur + 0.01);
}

export const sfx = {
  get enabled() { return _enabled; },

  toggle() {
    _enabled = !_enabled;
    try { localStorage.setItem("sfxMuted", _enabled ? "" : "1"); } catch { /* noop */ }
  },

  // ── 弾幕配置: 短い高音ポップ ─────────────────────────────────────────────
  bullet(isNpc = true) {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      // NPC側（青）は高め、PC側（赤）は少し低め
      tone("sine", isNpc ? 700 : 480, t, 0.09, 0.08, isNpc ? 1200 : 880);
    } catch { /* noop */ }
  },

  // ── スペルカード宣言: 神秘的な和音チャイム ──────────────────────────────
  spell(isNpc = false) {
    if (!_enabled) return;
    try {
      const c = getCtx();
      const t = c.currentTime;
      // NPC: マイナー和音（暗め）、PC: メジャー和音（明るめ）
      const root  = isNpc ? 220  : 523.25;
      const third = isNpc ? root * 1.189 : root * 1.26;  // minor/major third
      const fifth = root * 1.498;
      [[root, 0], [third, 0.09], [fifth, 0.18]].forEach(([f, d]) => {
        tone("sine", f, t + d, 0.8, 0.14);
      });
      // キラキラ高音（後半）
      tone("sine", isNpc ? 880 : 2093, t + 0.3, 0.5, 0.06, isNpc ? 440 : 1047);
    } catch { /* noop */ }
  },

  // ── フェーズチェンジ ────────────────────────────────────────────────────
  phase(phaseName) {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      switch (phaseName) {
        case "pc_shot_intro":
          // PC攻撃: 上昇三連符（緊張感・明るい）
          [329.63, 392, 493.88].forEach((f, i) => tone("triangle", f, t + i * 0.07, 0.18, 0.09));
          break;
        case "npc_shot_intro":
          // NPC攻撃: 下降三連符（ominous）
          [493.88, 392, 329.63].forEach((f, i) => tone("triangle", f, t + i * 0.07, 0.18, 0.09));
          break;
        case "pc_evade_intro":
          // PC回避: すばしっこい二音
          tone("sine", 523.25, t, 0.08, 0.08);
          tone("sine", 783.99, t + 0.07, 0.1, 0.1);
          break;
        case "npc_evade_intro":
          tone("sine", 392, t, 0.08, 0.08);
          tone("sine", 523.25, t + 0.07, 0.1, 0.08);
          break;
        case "pc_dropout":
        case "npc_dropout":
          // 脱落: 打撃音 + 下降音
          tone("sawtooth", 260, t, 0.35, 0.18, 80);
          burst(t, 0.12, 0.1, 600);
          break;
        case "pc_hit_recovery":
        case "npc_hit_recovery":
          // 復帰: ソフトな上昇チャイム
          tone("sine", 392, t, 0.15, 0.08, 523.25);
          break;
        default:
          break;
      }
    } catch { /* noop */ }
  },

  // ── ダイスロール開始: ガラガラ音 ────────────────────────────────────────
  diceRoll() {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      for (let i = 0; i < 5; i++) {
        burst(t + i * 0.09 + Math.random() * 0.03, 0.06, 0.12, 900 + Math.random() * 2000);
      }
    } catch { /* noop */ }
  },

  // ── ダイス結果確定 ─────────────────────────────────────────────────────
  diceResult(maxDie) {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      if (maxDie === 6) {
        // スペシャル: 上昇アルペジオ
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone("sine", f, t + i * 0.07, 0.22, 0.13));
      } else if (maxDie === 1) {
        // ファンブル: 暗い下降音
        [311.13, 261.63, 220, 174.61].forEach((f, i) => tone("sine", f, t + i * 0.08, 0.28, 0.11));
      } else {
        tone("triangle", 523.25, t, 0.1, 0.09, 659.25);
      }
    } catch { /* noop */ }
  },

  // ── ヒット確定 ──────────────────────────────────────────────────────────
  hit() {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      tone("sawtooth", 220, t, 0.2, 0.2, 55);
      burst(t, 0.1, 0.09, 500);
    } catch { /* noop */ }
  },

  // ── 勝利 ──────────────────────────────────────────────────────────────
  victory() {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      [261.63, 329.63, 392, 523.25, 659.25].forEach((f, i) =>
        tone("sine", f, t + i * 0.1, 0.5, 0.14)
      );
    } catch { /* noop */ }
  },

  // ── 敗北 ──────────────────────────────────────────────────────────────
  defeat() {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      [392, 349.23, 311.13, 261.63, 220].forEach((f, i) =>
        tone("sine", f, t + i * 0.12, 0.55, 0.12)
      );
    } catch { /* noop */ }
  },

  // ── クエスト解決: 上昇三音＋キラキラ ────────────────────────────────
  questSolve() {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => tone("sine", f, t + i * 0.12, 0.5, 0.14));
      tone("sine", 1567.98, t + 0.42, 0.4, 0.08, 2093);
    } catch { /* noop */ }
  },

  // ── 手がかり配置: 柔らかい発見チャイム ──────────────────────────────
  cluePlaced() {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      tone("sine", 880,  t,      0.18, 0.08, 1108);
      tone("sine", 1108, t + 0.14, 0.25, 0.06, 1318);
    } catch { /* noop */ }
  },

  // ── シーン開始: 幕が上がる柔らかな上昇音 ────────────────────────────
  sceneStart() {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      // 神秘的な上昇二音 + ふわっと広がる高音
      tone("triangle", 392,     t,        0.3, 0.1,  587.33);
      tone("triangle", 587.33,  t + 0.12, 0.4, 0.09, 880);
      tone("sine",     1174.66, t + 0.26, 0.5, 0.05, 1567.98);
    } catch { /* noop */ }
  },

  // ── シーン終了: 静かに幕が下りる下降音 ──────────────────────────────
  sceneEnd() {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      tone("sine", 659.25, t,        0.28, 0.08, 523.25);
      tone("sine", 440,    t + 0.16, 0.45, 0.07, 329.63);
    } catch { /* noop */ }
  },

  // ── 個性スキル発動: 魔法的なキラキラチャイム ────────────────────────
  skillActivate() {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      // 明るい和音 + キラキラ上昇
      [[659.25, 0], [830.61, 0.06], [987.77, 0.12]].forEach(([f, d]) =>
        tone("triangle", f, t + d, 0.35, 0.1)
      );
      tone("sine", 1318.51, t + 0.2, 0.4, 0.06, 1975.53);
    } catch { /* noop */ }
  },

  // ── アイテム使用: 軽いポップ音 ──────────────────────────────────────
  itemUse() {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      tone("triangle", 784,    t,        0.1,  0.09, 1046.5);
      tone("sine",     1046.5, t + 0.07, 0.14, 0.05, 1318.51);
    } catch { /* noop */ }
  },

  // ── サイクル進行（時間帯: 0=朝, 1=昼, 2=夕, 3=夜）─────────────────
  cycle(cycleIdx) {
    if (!_enabled) return;
    try {
      const t = getCtx().currentTime;
      switch (cycleIdx) {
        case 0: // 朝: 明るい上昇アルペジオ（鳥のさえずり感）
          [659.25, 783.99, 987.77, 1318.5].forEach((f, i) =>
            tone("sine", f, t + i * 0.1, 0.35, 0.1)
          );
          break;
        case 1: // 昼: 明るい三和音（全音符）
          [[523.25, 0], [659.25, 0.05], [783.99, 0.1]].forEach(([f, d]) =>
            tone("triangle", f, t + d, 0.55, 0.11)
          );
          break;
        case 2: // 夕: 温かみのある下降音（哀愁）
          [440, 392, 349.23, 293.66].forEach((f, i) =>
            tone("sine", f, t + i * 0.13, 0.5, 0.12)
          );
          break;
        case 3: // 夜: 深い低音の静謐な和音
          [[174.61, 0], [220, 0.15], [261.63, 0.3]].forEach(([f, d]) =>
            tone("sine", f, t + d, 1.2, 0.1)
          );
          break;
        default:
          break;
      }
    } catch { /* noop */ }
  },
};
