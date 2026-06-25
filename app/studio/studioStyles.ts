import { PANEL_W, DUAL_PANEL_W } from "./studioConstants";

/**
 * All studio CSS, injected once as a <style> tag by StudioClient's effect and
 * removed on cleanup. Extracted verbatim from the component; PANEL_W /
 * DUAL_PANEL_W are interpolated so the panel geometry stays in sync with the
 * layout constants. Pure string — no DOM — safe at module scope.
 */
export const STUDIO_CSS = `
        .config-panel {
          position: fixed; top: 0; right: 0; width: ${PANEL_W}; height: 100%;
          background: rgba(15,15,20,0.82); border-left: 1px solid rgba(255,255,255,0.07);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          z-index: 20; display: flex; flex-direction: column;
          padding: 28px 22px; box-sizing: border-box;
          transform: translateX(100%);
          transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: system-ui, sans-serif; color: #e8e8f0; overflow: hidden;
        }
        .config-panel.open { transform: translateX(0); }
        .config-panel-title {
          font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
          text-transform: uppercase; color: rgba(255,255,255,0.28);
          margin-bottom: 26px; padding-bottom: 14px;
          border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
        }
        .config-section { margin-bottom: 30px; }
        .config-label-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .config-label { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.4); }
        .config-value { font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.7); font-variant-numeric: tabular-nums; font-family: 'SF Mono', 'Fira Code', monospace; }
        .config-number-input {
          width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; color: #e8e8f0;
          font-size: 13px; font-family: 'SF Mono', 'Fira Code', monospace;
          font-variant-numeric: tabular-nums; padding: 8px 10px; outline: none;
          transition: border-color 0.15s, background 0.15s;
        }
        .config-number-input:focus { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.08); }
        .anim-cfg-list { display: flex; flex-direction: column; gap: 2px; }
        .anim-cfg-row {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 8px; border-radius: 6px;
          cursor: pointer; transition: background 0.15s;
        }
        .anim-cfg-row:hover { background: rgba(255,255,255,0.05); }
        .anim-cfg-row.anim-cfg-active { background: rgba(255,255,255,0.1); }
        .anim-cfg-name {
          flex: 1; font-size: 11px; color: rgba(255,255,255,0.7);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .anim-cfg-dur {
          width: 46px; background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
          color: #e8e8f0; font-size: 11px;
          font-family: 'SF Mono', 'Fira Code', monospace;
          padding: 3px 5px; outline: none; text-align: right;
          -moz-appearance: textfield;
        }
        .anim-cfg-dur::-webkit-inner-spin-button,
        .anim-cfg-dur::-webkit-outer-spin-button { -webkit-appearance: none; }
        .anim-cfg-dur:focus { border-color: rgba(255,255,255,0.3); }
        .anim-cfg-s { font-size: 10px; color: rgba(255,255,255,0.3); }
        .config-color-input {
          width: 36px; height: 24px; padding: 0; border: 1px solid rgba(255,255,255,0.15);
          border-radius: 4px; background: none; cursor: pointer;
        }
        .tile-select {
          background: rgba(255,255,255,0.05); color: #e8e8f0;
          border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
          padding: 3px 20px 3px 8px; font-size: 12px; cursor: pointer;
          outline: none; -webkit-appearance: none; appearance: none;
        }
        .tile-select:hover { border-color: rgba(255,255,255,0.35); }
        .map-overlay {
          position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
          z-index: 10; display: flex; align-items: center; gap: 8px;
          background: rgba(15,20,30,0.85); border: 1px solid rgba(255,255,255,0.15);
          border-radius: 8px; padding: 5px 12px;
        }
        .map-overlay-label {
          font-size: 10px; color: rgba(255,255,255,0.4);
          font-weight: 600; letter-spacing: 0.05em;
        }
        .map-overlay-input {
          width: 52px; background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
          color: #e8e8f0; font-size: 11px;
          font-family: 'SF Mono', 'Fira Code', monospace;
          padding: 3px 5px; outline: none; text-align: right;
          -moz-appearance: textfield;
        }
        .map-overlay-input::-webkit-inner-spin-button,
        .map-overlay-input::-webkit-outer-spin-button { -webkit-appearance: none; }
        .map-overlay-input:focus { border-color: rgba(255,255,255,0.3); }
        .map-config-section { border-top: 1px solid rgba(255,255,255,0.08); margin-top: 8px; padding-top: 8px; }
        .char-cfg-section { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 4px; }
        .char-cfg-row { display: flex; align-items: center; justify-content: space-between; padding: 3px 16px; gap: 8px; }
        .char-cfg-label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.4); flex: 1; }
        .char-cfg-input {
          width: 60px; background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
          color: #e8e8f0; font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace;
          padding: 3px 6px; outline: none; text-align: right;
          -moz-appearance: textfield;
        }
        .char-cfg-input::-webkit-inner-spin-button,
        .char-cfg-input::-webkit-outer-spin-button { -webkit-appearance: none; }
        .char-cfg-input:focus { border-color: rgba(255,255,255,0.3); }
        .config-section-title {
          font-size: 10px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: rgba(255,255,255,0.35);
          padding: 8px 0 4px;
        }
        .config-number-input::-webkit-inner-spin-button,
        .config-number-input::-webkit-outer-spin-button { opacity: 0.3; }
        .toggle-switch { position: relative; display: inline-block; width: 42px; height: 23px; flex-shrink: 0; cursor: pointer; }
        .toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .toggle-track { position: absolute; inset: 0; background: rgba(255,255,255,0.1); border-radius: 12px; transition: background 0.22s; }
        .toggle-track::after {
          content: ''; position: absolute; top: 3px; left: 3px; width: 17px; height: 17px;
          background: rgba(255,255,255,0.45); border-radius: 50%;
          transition: transform 0.22s, background 0.22s;
        }
        .toggle-switch input:checked + .toggle-track { background: rgba(100,210,120,0.5); }
        .toggle-switch input:checked + .toggle-track::after { transform: translateX(19px); background: #ffffff; }
        .gear-btn {
          position: fixed; right: 0; top: 50%; transform: translateY(-50%);
          width: 36px; height: 50px; background: rgba(15,15,20,0.82);
          border: 1px solid rgba(255,255,255,0.07); border-right: none;
          border-radius: 8px 0 0 8px; display: flex; align-items: center;
          justify-content: center; cursor: pointer; z-index: 21;
          color: rgba(255,255,255,0.45); font-size: 17px;
          transition: color 0.15s, background 0.15s, right 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          outline: none; user-select: none; padding: 0;
        }
        .gear-btn:hover { color: rgba(255,255,255,0.88); background: rgba(35,35,45,0.92); }
        .gear-btn.panel-open { right: ${PANEL_W}; }
        .char-panel {
          position: fixed; top: 0; left: 0; width: ${PANEL_W}; height: 100%;
          background: rgba(15,15,20,0.82); border-right: 1px solid rgba(255,255,255,0.07);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          z-index: 20; display: flex; flex-direction: column;
          padding: 28px 22px; box-sizing: border-box;
          transform: translateX(-100%);
          transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: system-ui, sans-serif; color: #e8e8f0; overflow: hidden;
        }
        .char-panel.open { transform: translateX(0); }
        .char-btn {
          position: fixed; left: 0; top: 50%; transform: translateY(-50%);
          width: 36px; height: 50px; background: rgba(15,15,20,0.82);
          border: 1px solid rgba(255,255,255,0.07); border-left: none;
          border-radius: 0 8px 8px 0; display: flex; align-items: center;
          justify-content: center; cursor: pointer; z-index: 21;
          color: rgba(255,255,255,0.45); font-size: 17px;
          transition: color 0.15s, background 0.15s, left 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          outline: none; user-select: none; padding: 0;
        }
        .char-btn:hover { color: rgba(255,255,255,0.88); background: rgba(35,35,45,0.92); }
        .char-btn.panel-open { left: ${PANEL_W}; }
        .char-list { flex: 1; overflow-y: auto; overflow-x: hidden; margin: 0 -22px; }
        .char-list::-webkit-scrollbar { width: 4px; }
        .char-list::-webkit-scrollbar-track { background: transparent; }
        .char-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .char-row {
          display: flex; align-items: center; height: 44px;
          border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer;
          padding: 0 22px; transition: background 0.12s; gap: 8px;
        }
        .char-row:hover { background: rgba(255,255,255,0.05); }
        .char-row.active { background: rgba(255,255,255,0.10); }
        .char-row-name { flex: 1; font-size: 13px; color: rgba(255,255,255,0.45); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .char-row.active .char-row-name { color: #ffffff; }
        .char-avatar-box { position: relative; width: 28px; height: 28px; flex-shrink: 0; }
        .char-avatar-thumb { width: 28px; height: 28px; border-radius: 4px; object-fit: cover; }
        .char-avatar-btn {
          position: absolute; inset: 0; background: rgba(0,0,0,0.35); border: none; border-radius: 4px;
          cursor: pointer; font-size: 13px; line-height: 28px; text-align: center; padding: 0;
          opacity: 0; transition: opacity 0.12s; color: #fff;
        }
        .char-avatar-box:hover .char-avatar-btn { opacity: 1; }
        .char-row-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.12s; flex-shrink: 0; }
        .char-row:hover .char-row-actions { opacity: 1; }
        .char-action-btn {
          background: none; border: none; color: rgba(255,255,255,0.3); font-size: 14px;
          cursor: pointer; padding: 3px 5px; line-height: 1; transition: color 0.12s;
          outline: none; border-radius: 3px;
        }
        .char-action-btn:hover { color: rgba(255,255,255,0.85); }
        .char-action-btn:disabled { opacity: 0.2; cursor: default; }
        .char-rename-input {
          flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2);
          border-radius: 4px; color: #e8e8f0; font-size: 13px;
          font-family: system-ui, sans-serif; padding: 4px 8px; outline: none; min-width: 0;
        }
        .char-rename-input:focus { border-color: rgba(255,255,255,0.4); }
        .char-new-form {
          display: flex; gap: 8px; margin-top: 16px; padding-top: 16px;
          border-top: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
        }
        .char-new-input {
          flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px; color: #e8e8f0; font-size: 13px;
          font-family: system-ui, sans-serif; padding: 7px 10px; outline: none;
          transition: border-color 0.15s, background 0.15s; min-width: 0;
        }
        .char-new-input:focus { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.08); }
        .char-add-btn {
          background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px; color: rgba(255,255,255,0.65); font-size: 13px;
          font-family: system-ui, sans-serif; padding: 7px 12px; cursor: pointer;
          outline: none; transition: background 0.15s, color 0.15s;
          white-space: nowrap; flex-shrink: 0;
        }
        .char-add-btn:hover { background: rgba(255,255,255,0.13); color: #ffffff; }
        .char-add-btn:disabled { opacity: 0.45; cursor: default; }
        .anim-add-form {
          margin-top: 16px; padding-top: 16px;
          border-top: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0; display: flex; flex-direction: column;
        }
        .anim-file-label {
          display: flex; align-items: center; gap: 8px; cursor: pointer;
          background: rgba(255,255,255,0.05); border: 1px dashed rgba(255,255,255,0.18);
          border-radius: 6px; padding: 9px 11px;
          transition: border-color 0.15s, background 0.15s;
        }
        .anim-file-label:hover { border-color: rgba(255,255,255,0.32); background: rgba(255,255,255,0.08); }
        .anim-file-input { display: none; }
        .anim-file-text {
          font-size: 12px; color: rgba(255,255,255,0.55);
          font-family: system-ui, sans-serif;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
        }
        .anim-name-row { display: flex; gap: 8px; margin-top: 8px; }
        .anim-add-status {
          font-size: 11px; margin-top: 8px; min-height: 14px;
          font-family: system-ui, sans-serif; line-height: 1.3;
        }
        .anim-add-status.busy { color: rgba(255,255,255,0.5); }
        .anim-add-status.ok { color: #7dd39b; }
        .anim-add-status.err { color: #e9897f; }
        .char-btn.anim-open { left: ${DUAL_PANEL_W}; }
        .anim-panel {
          position: fixed; top: 0; left: ${PANEL_W}; width: ${PANEL_W}; height: 100%;
          background: rgba(15,15,20,0.82); border-right: 1px solid rgba(255,255,255,0.07);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          z-index: 20; display: flex; flex-direction: column;
          padding: 28px 22px; box-sizing: border-box;
          transform: translateX(calc(-100% - ${PANEL_W}));
          transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: system-ui, sans-serif; color: #e8e8f0; overflow: hidden;
        }
        .anim-panel.open { transform: translateX(0); }
        .anim-list { flex: 1; overflow-y: auto; overflow-x: hidden; margin: 0 -22px; }
        .anim-list::-webkit-scrollbar { width: 4px; }
        .anim-list::-webkit-scrollbar-track { background: transparent; }
        .anim-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .anim-row {
          display: flex; align-items: center; height: 44px;
          border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer;
          padding: 0 22px; transition: background 0.12s;
        }
        .anim-row:hover { background: rgba(255,255,255,0.05); }
        .anim-row.active { background: rgba(255,255,255,0.10); }
        .anim-row-name { flex: 1; font-size: 13px; color: rgba(255,255,255,0.45); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .anim-row.active .anim-row-name { color: #ffffff; }
        .sub-tab-bar {
          display: flex; border-bottom: 1px solid rgba(255,255,255,0.06);
          margin: 0 -22px; flex-shrink: 0;
        }
        .sub-tab {
          flex: 1; height: 34px; background: none; border: none;
          border-bottom: 2px solid transparent; margin-bottom: -1px;
          color: rgba(255,255,255,0.3); font-size: 10px; font-weight: 700;
          letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer;
          transition: color 0.15s; font-family: system-ui, sans-serif;
        }
        .sub-tab:hover { color: rgba(255,255,255,0.65); }
        .sub-tab.active { color: rgba(255,255,255,0.9); border-bottom-color: rgba(255,255,255,0.35); }
        .action-list-container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .spell-tab-hint {
          margin-top: 16px; padding-top: 16px; flex-shrink: 0;
          border-top: 1px solid rgba(255,255,255,0.06);
          font-size: 11px; color: rgba(255,255,255,0.32); line-height: 1.55;
        }
        .spell-tab-link {
          color: rgba(140,180,250,0.9); text-decoration: none;
          border-bottom: 1px solid rgba(140,180,250,0.35);
          transition: color 0.12s, border-color 0.12s;
        }
        .spell-tab-link:hover { color: #b3cdff; border-bottom-color: rgba(179,205,255,0.6); }
        .actions-list { flex: 1; overflow-y: auto; overflow-x: hidden; margin: 0 -22px; }
        .actions-list::-webkit-scrollbar { width: 4px; }
        .actions-list::-webkit-scrollbar-track { background: transparent; }
        .actions-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .action-row {
          display: flex; align-items: center; height: 44px;
          border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer;
          padding: 0 22px; transition: background 0.12s; gap: 8px;
        }
        .action-row:hover { background: rgba(255,255,255,0.05); }
        .action-row.active { background: rgba(255,255,255,0.10); }
        .action-row-name { flex: 1; font-size: 13px; color: rgba(255,255,255,0.55); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .action-row.active .action-row-name { color: #ffffff; }
        .action-row-count { font-size: 11px; color: rgba(255,255,255,0.25); font-variant-numeric: tabular-nums; flex-shrink: 0; }
        .action-row:hover .char-row-actions { opacity: 1; }
        .action-rename-input {
          flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2);
          border-radius: 4px; color: #e8e8f0; font-size: 13px;
          font-family: system-ui, sans-serif; padding: 4px 8px; outline: none; min-width: 0;
        }
        .action-rename-input:focus { border-color: rgba(255,255,255,0.4); }
        .action-row:hover .char-row-actions { opacity: 1; }
        .ae-container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .ae-header {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 14px; padding-bottom: 14px;
          border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
        }
        .ae-back-btn {
          background: none; border: none; color: rgba(255,255,255,0.4); font-size: 16px;
          cursor: pointer; padding: 2px 6px; outline: none; line-height: 1;
          transition: color 0.12s; border-radius: 3px;
        }
        .ae-back-btn:hover { color: rgba(255,255,255,0.85); }
        .ae-action-name { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.85); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ae-steps { flex: 1; overflow-y: auto; overflow-x: hidden; margin: 0 -22px; }
        .ae-steps::-webkit-scrollbar { width: 4px; }
        .ae-steps::-webkit-scrollbar-track { background: transparent; }
        .ae-steps::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .ae-step {
          display: flex; align-items: center; gap: 6px;
          padding: 7px 22px; border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .ae-step:hover { background: rgba(255,255,255,0.03); }
        .ae-step-icon { font-size: 10px; color: rgba(255,255,255,0.28); flex-shrink: 0; width: 14px; text-align: center; }
        .ae-step-label { flex: 1; font-size: 12px; color: rgba(255,255,255,0.65); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ae-step-dur {
          width: 52px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 4px; color: #e8e8f0; font-size: 11px; padding: 3px 5px;
          font-family: 'SF Mono', 'Fira Code', monospace; font-variant-numeric: tabular-nums;
          outline: none; flex-shrink: 0; transition: border-color 0.12s;
        }
        .ae-step-dur:focus { border-color: rgba(255,255,255,0.3); }
        .ae-step-unit { font-size: 10px; color: rgba(255,255,255,0.22); flex-shrink: 0; }
        .ae-step-del {
          background: none; border: none; color: rgba(255,255,255,0.18); font-size: 15px;
          cursor: pointer; padding: 2px 4px; outline: none; line-height: 1;
          transition: color 0.12s; border-radius: 3px; flex-shrink: 0;
        }
        .ae-step-del:hover { color: rgba(220,80,80,0.85); }
        .ae-step-frame {
          width: 32px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 4px; color: #e8e8f0; font-size: 10px; padding: 3px 3px;
          font-family: 'SF Mono', 'Fira Code', monospace; font-variant-numeric: tabular-nums;
          outline: none; flex-shrink: 0; text-align: center; transition: border-color 0.12s;
        }
        .ae-step-frame:focus { border-color: rgba(255,255,255,0.3); }
        .ae-step-frame::-webkit-inner-spin-button, .ae-step-frame::-webkit-outer-spin-button { opacity: 0; }
        .ae-step-sep { font-size: 10px; color: rgba(255,255,255,0.2); flex-shrink: 0; }
        .ae-empty { font-size: 12px; color: rgba(255,255,255,0.2); padding: 16px 22px; text-align: center; }
        .ae-controls {
          flex-shrink: 0; padding-top: 10px;
          border-top: 1px solid rgba(255,255,255,0.06);
          display: flex; flex-direction: column; gap: 8px;
        }
        .ae-add-row { display: flex; gap: 6px; align-items: center; }
        .ae-select {
          flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px; color: #e8e8f0; font-size: 12px;
          font-family: system-ui, sans-serif; padding: 6px 8px; outline: none;
          cursor: pointer; min-width: 0; transition: border-color 0.12s;
        }
        .ae-select:focus { border-color: rgba(255,255,255,0.3); }
        .ae-select option { background: #1a1a24; }
        .ae-dur-input {
          width: 52px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px; color: #e8e8f0; font-size: 12px;
          font-family: 'SF Mono', 'Fira Code', monospace; font-variant-numeric: tabular-nums;
          padding: 6px 7px; outline: none; flex-shrink: 0; transition: border-color 0.12s;
        }
        .ae-dur-input:focus { border-color: rgba(255,255,255,0.3); }
        .ae-add-btn {
          background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px; color: rgba(255,255,255,0.65); font-size: 12px;
          font-family: system-ui, sans-serif; padding: 6px 10px; cursor: pointer;
          outline: none; transition: background 0.15s, color 0.15s; white-space: nowrap; flex-shrink: 0;
        }
        .ae-add-btn:hover { background: rgba(255,255,255,0.13); color: #ffffff; }
        .ae-preview-btn {
          width: 100%; padding: 9px; margin-top: 2px;
          background: rgba(100,210,120,0.1); border: 1px solid rgba(100,210,120,0.22);
          border-radius: 7px; color: rgba(130,230,140,0.85); font-size: 12px; font-weight: 600;
          font-family: system-ui, sans-serif; cursor: pointer; outline: none;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .ae-preview-btn:hover { background: rgba(100,210,120,0.2); color: #a0f0a8; }
        .ae-preview-btn.stopping {
          background: rgba(210,80,80,0.1); border-color: rgba(210,80,80,0.22); color: rgba(230,120,120,0.85);
        }
        .ae-preview-btn.stopping:hover { background: rgba(210,80,80,0.2); color: #f0a0a0; }
        /* Battle Data CMS panel — mirrors .config-panel placement/treatment */
        .battle-panel {
          position: fixed; top: 0; right: 0; width: 38vw; max-width: 520px; height: 100%;
          background: rgba(15,15,20,0.92); border-left: 1px solid rgba(255,255,255,0.07);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          z-index: 25; display: flex; flex-direction: column;
          padding: 28px 22px; box-sizing: border-box;
          transform: translateX(100%);
          transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: system-ui, sans-serif; color: #e8e8f0; overflow: hidden;
        }
        .battle-panel.open { transform: translateX(0); }
        .battle-char-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px; margin-bottom: 8px; flex-shrink: 0;
        }
        .battle-content {
          flex: 1; overflow-y: auto; overflow-x: hidden;
          margin: 0 -22px; padding: 4px 22px 8px;
        }
        .battle-content::-webkit-scrollbar { width: 4px; }
        .battle-content::-webkit-scrollbar-track { background: transparent; }
        .battle-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .battle-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px; padding: 6px 0;
        }
        .battle-row-label {
          font-size: 11px; color: rgba(255,255,255,0.55);
          text-transform: capitalize; letter-spacing: 0.02em;
        }
        .battle-input {
          width: 96px; background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12); border-radius: 6px;
          color: #e8e8f0; font-size: 12px;
          font-family: 'SF Mono', 'Fira Code', monospace; font-variant-numeric: tabular-nums;
          padding: 6px 8px; outline: none; text-align: right;
          transition: border-color 0.12s; -moz-appearance: textfield;
        }
        .battle-input::-webkit-inner-spin-button,
        .battle-input::-webkit-outer-spin-button { opacity: 0.3; }
        .battle-input:focus { border-color: rgba(255,255,255,0.3); }
        .battle-select {
          min-width: 150px; max-width: 62%; background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12); border-radius: 6px;
          color: #e8e8f0; font-size: 12px; font-family: system-ui, sans-serif;
          padding: 6px 8px; outline: none; cursor: pointer; transition: border-color 0.12s;
        }
        .battle-select:focus { border-color: rgba(255,255,255,0.3); }
        .battle-select option { background: #1a1a24; }
        .battle-select optgroup { background: #1a1a24; color: rgba(255,255,255,0.5); font-style: normal; }
        .battle-hint {
          font-size: 11px; color: rgba(255,255,255,0.3);
          padding: 4px 0 2px; line-height: 1.5;
        }
        .battle-save-btn {
          width: 100%; margin: 12px 0 26px; padding: 9px;
          background: rgba(100,210,120,0.1); border: 1px solid rgba(100,210,120,0.22);
          border-radius: 7px; color: rgba(130,230,140,0.85); font-size: 12px; font-weight: 600;
          font-family: system-ui, sans-serif; cursor: pointer; outline: none;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .battle-save-btn:hover { background: rgba(100,210,120,0.2); color: #a0f0a8; }
        .battle-save-btn.battle-saved {
          background: rgba(100,210,120,0.28); border-color: rgba(100,210,120,0.4); color: #c0ffc8;
        }
      `;
