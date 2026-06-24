// Shared dark-aesthetic CSS for the /studio/spells CRUD pages. Each page (a
// client component) injects it once as a <style> tag; every rule is scoped under
// .spells-page so it can't leak into the rest of the studio. Tokens mirror
// studioStyles.ts / globals.css (dark surfaces, green "primary" accent).
export const SPELLS_PAGE_CSS = `
  .spells-page {
    display: flex; flex-direction: column; height: 100vh;
    background: #0a0a0f; color: #e8e8f0; font-family: system-ui, sans-serif;
  }
  .spells-page .menu-bar-item { text-decoration: none; }
  .spells-page .menu-bar-item.is-current {
    color: rgba(255,255,255,0.9); background: rgba(255,255,255,0.06);
  }
  .spells-page .spells-wrap {
    flex: 1; overflow-y: auto; width: 100%; max-width: 760px;
    margin: 0 auto; box-sizing: border-box; padding: 40px 28px 80px;
  }
  .spells-page .spells-head { margin-bottom: 26px; }
  .spells-page .spells-title { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
  .spells-page .spells-sub { margin: 6px 0 0; font-size: 13px; color: rgba(255,255,255,0.4); }
  .spells-page .spell-create { display: flex; gap: 10px; margin-bottom: 26px; }
  .spells-page .spell-input {
    width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: #e8e8f0;
    font-size: 14px; font-family: inherit; padding: 10px 12px; outline: none;
    transition: border-color 0.15s, background 0.15s;
  }
  .spells-page .spell-create .spell-input { flex: 1; }
  .spells-page .spell-input:focus {
    border-color: rgba(255,255,255,0.32); background: rgba(255,255,255,0.08);
  }
  .spells-page .spell-anim-current {
    font-size: 13px; font-family: 'SF Mono','Fira Code',monospace; color: rgba(255,255,255,0.72);
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px; padding: 10px 12px; word-break: break-all;
  }
  .spells-page .spell-anim-current.empty {
    font-family: system-ui, sans-serif; color: rgba(255,255,255,0.38);
  }
  .spells-page .spell-btn {
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px; color: rgba(255,255,255,0.75); font-size: 13px; font-weight: 600;
    font-family: inherit; padding: 9px 16px; cursor: pointer; outline: none;
    text-decoration: none; display: inline-flex; align-items: center; justify-content: center;
    white-space: nowrap; transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .spells-page .spell-btn:hover { background: rgba(255,255,255,0.13); color: #fff; }
  .spells-page .spell-btn:disabled { opacity: 0.4; cursor: default; }
  .spells-page .spell-btn.primary { background: rgba(100,210,120,0.12); border-color: rgba(100,210,120,0.3); color: #9fe7ad; }
  .spells-page .spell-btn.primary:hover { background: rgba(100,210,120,0.22); color: #c0ffc8; }
  .spells-page .spell-btn.primary.saved { background: rgba(100,210,120,0.3); color: #c0ffc8; }
  .spells-page .spell-btn.danger { color: rgba(232,130,120,0.85); }
  .spells-page .spell-btn.danger:hover { background: rgba(220,80,80,0.14); color: #f3aaa1; border-color: rgba(220,80,80,0.32); }
  .spells-page .spells-empty {
    border: 1px dashed rgba(255,255,255,0.14); border-radius: 12px; padding: 44px 24px;
    text-align: center; color: rgba(255,255,255,0.42); font-size: 14px;
    display: flex; flex-direction: column; align-items: center; gap: 16px;
  }
  .spells-page .spell-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .spells-page .spell-card {
    display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 0 8px 0 0;
    transition: border-color 0.15s, background 0.15s;
  }
  .spells-page .spell-card:hover { border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.05); }
  .spells-page .spell-card-main {
    flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between;
    gap: 16px; padding: 14px 16px; text-decoration: none; color: inherit;
  }
  .spells-page .spell-card-name { font-size: 15px; font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spells-page .spell-card-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .spells-page .spell-tag {
    font-size: 11px; color: rgba(255,255,255,0.55); background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; padding: 3px 10px;
    max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .spells-page .spell-stat { font-size: 11px; color: rgba(255,255,255,0.4); font-family: 'SF Mono','Fira Code',monospace; font-variant-numeric: tabular-nums; }
  .spells-page .spell-back { display: inline-block; margin-bottom: 22px; font-size: 13px; color: rgba(255,255,255,0.45); text-decoration: none; transition: color 0.15s; }
  .spells-page .spell-back:hover { color: #fff; }
  .spells-page .spell-edit { display: flex; flex-direction: column; gap: 18px; max-width: 460px; }
  .spells-page .spell-field { display: flex; flex-direction: column; gap: 7px; }
  .spells-page .spell-field-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.4); }
  .spells-page .spell-edit-actions { display: flex; gap: 10px; margin-top: 8px; }
  .spells-page .spell-upload {
    display: flex; flex-direction: column; gap: 10px; padding: 14px;
    border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
    background: rgba(255,255,255,0.02);
  }
  .spells-page .spell-upload-row { display: flex; gap: 10px; align-items: stretch; }
  .spells-page .spell-file {
    flex: 1; min-width: 0; display: flex; align-items: center; cursor: pointer;
    background: rgba(255,255,255,0.05); border: 1px dashed rgba(255,255,255,0.18);
    border-radius: 8px; padding: 9px 12px; transition: border-color 0.15s, background 0.15s;
  }
  .spells-page .spell-file:hover { border-color: rgba(255,255,255,0.32); background: rgba(255,255,255,0.08); }
  .spells-page .spell-file-input { display: none; }
  .spells-page .spell-file-text {
    font-size: 13px; color: rgba(255,255,255,0.55);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
  }
  .spells-page .spell-check {
    display: flex; align-items: center; gap: 8px; font-size: 12px;
    color: rgba(255,255,255,0.6); cursor: pointer; user-select: none;
  }
  .spells-page .spell-check input { width: 14px; height: 14px; accent-color: #6ad27a; cursor: pointer; flex-shrink: 0; }
  .spells-page .spell-error { margin: 0; font-size: 12px; color: #e9897f; line-height: 1.4; }
  .spells-page .spell-hint { margin: 0; font-size: 11px; color: rgba(255,255,255,0.35); line-height: 1.4; }

  /* --- Animation preview + playback config --- */
  .spells-page .spell-preview { display: flex; flex-direction: column; gap: 9px; align-items: center; }
  .spells-page .spell-preview-stage {
    position: relative; width: min(420px, 100%); aspect-ratio: 1 / 1;
    min-width: 0; min-height: 0; overflow: hidden; isolation: isolate;
    border-radius: 0; background: radial-gradient(78% 64% at 50% 50%, rgba(40,72,92,0.16), transparent 76%);
  }
  .spells-page .spell-preview-video {
    position: absolute; inset: 0; z-index: 0;
    width: 100%; height: 100%; object-fit: cover; object-position: center;
    pointer-events: none;
  }
  .spells-page .spell-preview-scrim {
    position: absolute; inset: 0; z-index: 1; pointer-events: none;
    background: linear-gradient(180deg, rgba(5,7,13,0.20), rgba(5,7,13,0.40));
  }
  .spells-page .spell-preview-content { position: absolute; inset: 0; z-index: 2; }
  .spells-page .spell-preview-stage::after {
    content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none; border-radius: 0;
    box-shadow:
      inset 0 0 42px 8px rgba(5,8,14,0.5),
      inset 0 0 0 1px rgba(120,200,230,0.07);
  }
  .spells-page .spell-preview-canvas {
    position: absolute; inset: 0; width: 100%; height: 100%; display: block;
    image-rendering: auto; pointer-events: none;
  }
  .spells-page .spell-preview-empty {
    display: flex; align-items: center; justify-content: center; text-align: center;
    min-height: 240px; padding: 24px; box-sizing: border-box;
    border: 1px dashed rgba(255,255,255,0.14); border-radius: 14px;
    background: rgba(255,255,255,0.02); color: rgba(255,255,255,0.4); font-size: 13px;
  }
  .spells-page .spell-preview-cap {
    font-size: 11px; font-family: 'SF Mono','Fira Code',monospace;
    color: rgba(255,255,255,0.5); text-align: center; word-break: break-all;
  }
  .spells-page .spell-playback {
    display: flex; flex-direction: column; gap: 16px; padding: 14px;
    border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
    background: rgba(255,255,255,0.02);
  }
  .spells-page .spell-playback-grid {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 18px;
  }
  .spells-page .spell-slider { display: flex; flex-direction: column; gap: 9px; cursor: pointer; }
  .spells-page .spell-slider-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    font-size: 12px; color: rgba(255,255,255,0.6);
  }
  .spells-page .spell-slider-val {
    font-family: 'SF Mono','Fira Code',monospace; font-size: 12px; color: #9fe7ad;
    font-variant-numeric: tabular-nums;
  }
  .spells-page .spell-num {
    width: 100%; box-sizing: border-box;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px; color: #e8e8f0;
    font-size: 13px; font-family: inherit;
    padding: 8px 10px; outline: none;
    transition: border-color 0.15s, background 0.15s;
    -moz-appearance: textfield;
  }
  .spells-page .spell-num::-webkit-inner-spin-button,
  .spells-page .spell-num::-webkit-outer-spin-button {
    -webkit-appearance: none; margin: 0;
  }
  .spells-page .spell-range {
    -webkit-appearance: none; appearance: none; width: 100%; height: 4px; margin: 0;
    border-radius: 999px; background: rgba(255,255,255,0.13); outline: none; cursor: pointer;
  }
  .spells-page .spell-range::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none; width: 15px; height: 15px; border-radius: 50%;
    background: #6ad27a; border: 2px solid #0a0a0f; cursor: pointer;
    box-shadow: 0 0 0 1px rgba(100,210,120,0.45);
  }
  .spells-page .spell-range::-moz-range-thumb {
    width: 15px; height: 15px; border-radius: 50%; background: #6ad27a;
    border: 2px solid #0a0a0f; cursor: pointer;
  }
`;
