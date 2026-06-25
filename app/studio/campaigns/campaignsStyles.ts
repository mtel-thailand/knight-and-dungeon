// Shared dark-aesthetic CSS for the /studio/campaigns CRUD pages. Each page (a
// client component) injects it once as a <style> tag; every rule is scoped under
// .campaigns-page so it can't leak into the rest of the studio. Tokens mirror
// studioStyles.ts / globals.css (dark surfaces, green "primary" accent).
export const CAMPAIGNS_PAGE_CSS = `
  .campaigns-page {
    display: flex; flex-direction: column; height: 100vh;
    background: #0a0a0f; color: #e8e8f0; font-family: system-ui, sans-serif;
  }
  .campaigns-page .menu-bar-item { text-decoration: none; }
  .campaigns-page .menu-bar-item.is-current {
    color: rgba(255,255,255,0.9); background: rgba(255,255,255,0.06);
  }
  .campaigns-page .campaigns-wrap {
    flex: 1; overflow-y: auto; width: 100%; max-width: 760px;
    margin: 0 auto; box-sizing: border-box; padding: 40px 28px 80px;
  }
  .campaigns-page .campaigns-head { margin-bottom: 26px; }
  .campaigns-page .campaigns-head.compact { margin: 34px 0 14px; }
  .campaigns-page .campaigns-title { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
  .campaigns-page .campaigns-title.small { font-size: 20px; }
  .campaigns-page .campaigns-sub { margin: 6px 0 0; font-size: 13px; color: rgba(255,255,255,0.4); }
  .campaigns-page .campaign-create { display: flex; gap: 10px; margin-bottom: 26px; }
  .campaigns-page .campaign-input {
    width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: #e8e8f0;
    font-size: 14px; font-family: inherit; padding: 10px 12px; outline: none;
    transition: border-color 0.15s, background 0.15s;
  }
  .campaigns-page .campaign-create .campaign-input { flex: 1; }
  .campaigns-page .campaign-input:focus {
    border-color: rgba(255,255,255,0.32); background: rgba(255,255,255,0.08);
  }
  .campaigns-page .campaign-btn {
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px; color: rgba(255,255,255,0.75); font-size: 13px; font-weight: 600;
    font-family: inherit; padding: 9px 16px; cursor: pointer; outline: none;
    text-decoration: none; display: inline-flex; align-items: center; justify-content: center;
    white-space: nowrap; transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .campaigns-page .campaign-btn:hover { background: rgba(255,255,255,0.13); color: #fff; }
  .campaigns-page .campaign-btn:disabled { opacity: 0.4; cursor: default; }
  .campaigns-page .campaign-btn.primary { background: rgba(100,210,120,0.12); border-color: rgba(100,210,120,0.3); color: #9fe7ad; }
  .campaigns-page .campaign-btn.primary:hover { background: rgba(100,210,120,0.22); color: #c0ffc8; }
  .campaigns-page .campaign-btn.primary.saved { background: rgba(100,210,120,0.3); color: #c0ffc8; }
  .campaigns-page .campaign-btn.danger { color: rgba(232,130,120,0.85); }
  .campaigns-page .campaign-btn.danger:hover { background: rgba(220,80,80,0.14); color: #f3aaa1; border-color: rgba(220,80,80,0.32); }
  .campaigns-page .campaigns-empty {
    border: 1px dashed rgba(255,255,255,0.14); border-radius: 12px; padding: 44px 24px;
    text-align: center; color: rgba(255,255,255,0.42); font-size: 14px;
    display: flex; flex-direction: column; align-items: center; gap: 16px;
  }
  .campaigns-page .campaign-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .campaigns-page .campaign-card {
    display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 0 8px 0 0;
    transition: border-color 0.15s, background 0.15s;
  }
  .campaigns-page .campaign-card:hover { border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.05); }
  .campaigns-page .campaign-card.active { border-color: rgba(100,210,120,0.35); background: rgba(100,210,120,0.05); }
  .campaigns-page .campaign-card-main {
    flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between;
    gap: 16px; padding: 14px 16px; text-decoration: none; color: inherit;
  }
  .campaigns-page .campaign-card-name { font-size: 15px; font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .campaigns-page .campaign-card-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .campaigns-page .campaign-tag {
    font-size: 11px; color: rgba(255,255,255,0.55); background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; padding: 3px 10px;
    max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .campaigns-page .campaign-tag.active-tag {
    background: rgba(100,210,120,0.15); border-color: rgba(100,210,120,0.3); color: #9fe7ad;
  }
  .campaigns-page .campaign-stat { font-size: 11px; color: rgba(255,255,255,0.4); font-family: 'SF Mono','Fira Code',monospace; font-variant-numeric: tabular-nums; }
  .campaigns-page .campaign-back { display: inline-block; margin-bottom: 22px; font-size: 13px; color: rgba(255,255,255,0.45); text-decoration: none; transition: color 0.15s; }
  .campaigns-page .campaign-back:hover { color: #fff; }
  .campaigns-page .campaign-edit { display: flex; flex-direction: column; gap: 18px; max-width: 460px; }
  .campaigns-page .campaign-field { display: flex; flex-direction: column; gap: 7px; }
  .campaigns-page .campaign-field-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.4); }
  .campaigns-page .campaign-edit-actions { display: flex; gap: 10px; margin-top: 8px; }
  .campaigns-page .campaign-check {
    display: flex; align-items: center; gap: 8px; font-size: 12px;
    color: rgba(255,255,255,0.6); cursor: pointer; user-select: none;
  }
  .campaigns-page .campaign-check input { width: 14px; height: 14px; accent-color: #6ad27a; cursor: pointer; flex-shrink: 0; }
  .campaigns-page .campaign-error { margin: 0; font-size: 12px; color: #e9897f; line-height: 1.4; }
  .campaigns-page .campaign-hint { margin: 0; font-size: 11px; color: rgba(255,255,255,0.35); line-height: 1.4; }
  .campaigns-page .campaign-monster-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px;
    padding: 10px; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
    background: rgba(255,255,255,0.02);
  }
  .campaigns-page .campaign-rewards-section { margin-top: 34px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08); }
  .campaigns-page .reward-editor-list { display: flex; flex-direction: column; gap: 10px; }
  .campaigns-page .reward-editor-card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; background: rgba(255,255,255,0.03); }
  .campaigns-page .reward-editor-row { display: grid; grid-template-columns: 1fr 110px auto; gap: 8px; }
`; 
