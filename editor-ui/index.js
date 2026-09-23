export function createEditor(React, { api, playUrl, saveToWorkspace = false }) {
    const e = React.createElement

    const STYLE_ID = 'qxqy-simulator-style'
    const CSS = `
.qxsim-save-overlay{position:absolute;inset:0;z-index:30;display:grid;place-items:center;background:#0006}.qxsim-save-dialog{width:min(440px,90%);padding:24px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:0 12px 48px #0005}.qxsim-save-dialog h2{margin:0 0 16px;font-size:17px}.qxsim-save-dialog input{width:100%;margin:8px 0 16px;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--input)}.qxsim-save-dialog footer{display:flex;justify-content:flex-end;gap:8px}.qxsim-save-dialog [role=alert]{color:var(--danger);margin-bottom:12px;overflow-wrap:anywhere}
.qxsim{--blue:#477cf0;--danger:#e75a6a;position:relative;display:flex;flex:1 1 0;align-self:stretch;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;max-height:none;container-type:inline-size;color:var(--text);background:var(--bg);font:13px/1.4 Inter,"Microsoft YaHei UI","Microsoft YaHei",sans-serif;overflow:hidden;color-scheme:inherit}
.qxsim[data-theme=dark]{--bg:#20242e;--panel:#181d27;--panel2:#202632;--input:#151b25;--line:#363e4d;--lineSoft:#2b3240;--text:#edf1f7;--muted:#929baa;--hover:#252c37;--workspace:#383d47;--toolbarA:#242a35;--toolbarB:#1e232d;--status:#242a33;--button:#1d2430;--shadow:#0004}
.qxsim[data-theme=light]{--bg:#f5f6f8;--panel:#fff;--panel2:#f4f6f8;--input:#fff;--line:#d6dbe3;--lineSoft:#e7e9ed;--text:#20242a;--muted:#69717d;--hover:#eef1f5;--workspace:#d9dde3;--toolbarA:#fff;--toolbarB:#f3f5f8;--status:#f7f8fa;--button:#f7f8fa;--shadow:#18203318}
.qxsim *{box-sizing:border-box}.qxsim button,.qxsim input,.qxsim textarea,.qxsim select{font:inherit;color:inherit}.qxsim button{cursor:pointer}.qxsim button:disabled{opacity:.42;cursor:default}
.qxsim-toolbar{height:50px;flex:0 0 50px;display:grid;grid-template-columns:minmax(190px,1fr) auto minmax(280px,1fr);align-items:center;padding:0 10px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,var(--toolbarA),var(--toolbarB));box-shadow:0 1px 8px var(--shadow);z-index:3}.qxsim-brand,.qxsim-toolbar-center,.qxsim-actions{display:flex;align-items:center}.qxsim-brand{gap:8px;min-width:0}.qxsim-appicon{width:26px;height:26px;display:grid;place-items:center;border:1px solid var(--line);border-radius:5px;font-size:11px;background:var(--input)}.qxsim-brand-text{min-width:0}.qxsim-brand-text strong,.qxsim-brand-text span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.qxsim-brand-text strong{font-size:13px}.qxsim-brand-text span{color:var(--muted);font-size:10px}.qxsim-toolbar-center{gap:6px}.qxsim-actions{justify-content:flex-end;gap:6px}.qxsim-io{display:flex;align-items:center;gap:4px;padding-right:6px;margin-right:2px;border-right:1px solid var(--line)}
.qxsim-editor-nav{height:40px;flex:0 0 40px;display:flex;align-items:stretch;padding:0 10px;border-bottom:1px solid var(--line);background:var(--panel)}.qxsim-editor-nav button{min-width:116px;padding:0 18px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted);font-weight:650}.qxsim-editor-nav button.active{border-bottom-color:var(--blue);color:var(--text);background:color-mix(in srgb,var(--blue) 8%,transparent)}.qxsim-editor-nav .save-summary{display:flex;align-items:center;margin-left:auto;color:var(--muted);font-size:10px}
.qxsim-control,.qxsim-iconbtn,.qxsim-action{height:32px;border:1px solid var(--line);background:var(--input);border-radius:6px}.qxsim-control{min-width:156px;padding:0 28px 0 9px}.qxsim-control.zoom{min-width:78px}.qxsim-iconbtn{width:32px}.qxsim-action{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 11px;white-space:nowrap}.qxsim-action.primary{color:#fff;border-color:#3265d8;background:linear-gradient(#5388fa,#376ad8)}.qxsim-action.danger{color:var(--danger)}.qxsim-action:hover,.qxsim-iconbtn:hover{border-color:var(--blue);background:var(--hover)}
.qxsim-main{display:grid;grid-template-columns:clamp(220px,17cqi,280px) minmax(360px,1fr) clamp(310px,22cqi,356px);flex:1;min-height:0}.qxsim-tree,.qxsim-inspector{min-height:0;background:var(--panel)}.qxsim-tree{display:flex;flex-direction:column;border-right:1px solid var(--line)}.qxsim-inspector{display:flex;flex-direction:column;border-left:1px solid var(--line)}.qxsim-pane-head{height:44px;flex:0 0 44px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-bottom:1px solid var(--lineSoft)}.qxsim-pane-title{font-weight:650;font-size:13px}.qxsim-muted{color:var(--muted);font-size:10px}.qxsim-asset-switch{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin:8px 8px 0;padding:3px;border:1px solid var(--line);border-radius:18px;background:var(--input)}.qxsim-asset-switch button{height:29px;min-width:0;border:0;border-radius:15px;background:transparent;color:var(--muted);font-weight:600;white-space:nowrap}.qxsim-asset-switch button.active{color:#fff;background:linear-gradient(#4f86ff,#3c6ed8);box-shadow:0 2px 7px #1d4b9f55}.qxsim-template-tag{padding:1px 5px;border:1px solid currentColor;border-radius:8px;color:#9cc2ff;font-size:9px}.qxsim-template-id{color:var(--muted);font:9px ui-monospace,Consolas,monospace}.qxsim-palette-head{display:flex;align-items:center;justify-content:space-between;gap:4px;margin:0 0 4px;color:var(--muted);font-size:10px}.qxsim-palette-head>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.qxsim-add-mode{display:flex;flex:0 0 auto;gap:2px;padding:1px;border:1px solid var(--line);border-radius:10px;background:var(--input)}.qxsim-add-mode button{height:18px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:9px}.qxsim-add-mode button.active{color:var(--text);background:var(--hover)}
.qxsim-search{height:32px;margin:8px;display:flex;align-items:center;gap:7px;padding:0 9px;border:1px solid var(--line);border-radius:16px;background:var(--input);color:var(--muted)}.qxsim-search input{min-width:0;flex:1;border:0;outline:0;background:transparent}.qxsim-search button{border:0;background:transparent;color:var(--muted)}.qxsim-tree-scroll{flex:1;min-height:0;overflow:auto;padding:3px 6px 8px}.qxsim-row{position:relative;height:32px;display:flex;align-items:center;gap:6px;padding-right:7px;border:1px solid transparent;border-radius:4px;cursor:pointer;white-space:nowrap;overflow:hidden}.qxsim-row.template-root{height:38px;margin-top:5px;border-top-color:var(--lineSoft);background:color-mix(in srgb,var(--blue) 5%,transparent)}.qxsim-row.template-root:first-child{margin-top:0}.qxsim-row:not(.template-root):before{content:"";position:absolute;left:13px;top:-6px;bottom:16px;border-left:1px solid var(--lineSoft);pointer-events:none}.qxsim-row:hover{background:var(--hover)}.qxsim-row.active{background:linear-gradient(90deg,#3569cf,#315a9f);border-color:#4d7ee4;color:#fff}.qxsim-chevron{width:9px;color:var(--muted);font-size:9px}.qxsim-kind{width:19px;height:19px;display:inline-grid;place-items:center;flex:0 0 19px;border:1px solid currentColor;border-radius:3px;font-size:9px}.qxsim-row-label{min-width:0;overflow:hidden;text-overflow:ellipsis}.qxsim-row-end{margin-left:auto;display:flex;align-items:center;gap:4px;flex:0 0 auto}.qxsim-row.canvas-hidden .qxsim-row-label{opacity:.45}.qxsim-eye{width:20px;height:20px;display:grid;place-items:center;border:0;border-radius:4px;background:transparent;color:var(--muted);font-size:12px;line-height:1}.qxsim-eye:hover{background:var(--hover);color:var(--text)}.qxsim-row.active .qxsim-eye{color:#d7e6ff}.qxsim-row.active .qxsim-eye:hover{background:#ffffff24;color:#fff}.qxsim-eye.off{opacity:.55}.qxsim-incomplete{color:#e4a743;font-size:9px}.qxsim-tree-foot{flex:0 0 auto;padding:5px;border-top:1px solid var(--lineSoft)}.qxsim-hierarchy{margin-bottom:5px;padding:5px;border:1px solid var(--line);border-radius:6px;background:color-mix(in srgb,var(--input) 78%,transparent)}.qxsim-hierarchy-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;font-size:10px}.qxsim-hierarchy-head strong{font-weight:650}.qxsim-hierarchy-head span{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}.qxsim-parent-row{display:grid;grid-template-columns:minmax(0,1fr) 24px 24px;gap:3px}.qxsim-parent-row select,.qxsim-parent-row button{height:24px;min-width:0;border:1px solid var(--line);border-radius:4px;background:var(--button)}.qxsim-parent-row select{padding:0 5px}.qxsim-hierarchy-note{margin-top:3px;color:var(--muted);font-size:9px;line-height:1.3}.qxsim-add{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px}.qxsim-add button{height:22px;padding:0 4px;border:1px solid var(--line);border-radius:4px;background:var(--button);color:var(--muted);font-size:11px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qxsim-add button:hover{color:var(--text);border-color:var(--blue)}
.qxsim-center{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--workspace)}.qxsim-workspace{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:34px 22px 20px;overflow:auto;background-color:var(--workspace);background-image:radial-gradient(#ffffff0b 1px,transparent 1px),linear-gradient(135deg,#ffffff09 25%,transparent 25%,transparent 75%,#00000008 75%);background-size:4px 4px,24px 24px}.qxsim-stage-shell{position:relative;flex:0 0 auto;max-width:100%;filter:drop-shadow(0 12px 24px #0004)}.qxsim-stage-label{position:absolute;left:0;right:0;top:-27px;display:flex;align-items:center;gap:7px;color:var(--muted);font-size:10px}.qxsim-stage-label b{padding:2px 7px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--text);font-weight:600}.qxsim-stage{position:relative;max-width:100%;background-color:#28313e;background-image:linear-gradient(45deg,#ffffff08 25%,transparent 25%),linear-gradient(-45deg,#ffffff08 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ffffff08 75%),linear-gradient(-45deg,transparent 75%,#ffffff08 75%),radial-gradient(circle at 50% 45%,#466f9b38,transparent 48%);background-position:0 0,0 8px,8px -8px,-8px 0,0 0;background-size:16px 16px,16px 16px,16px 16px,16px 16px,100% 100%;border:1px solid #40b8cf;outline:1px solid #1f2732b3;overflow:hidden;touch-action:none;user-select:none}.qxsim-stage:before,.qxsim-stage:after{content:"";position:absolute;pointer-events:none;opacity:.12}.qxsim-stage:before{left:50%;top:0;bottom:0;border-left:1px dashed #cfe9ff}.qxsim-stage:after{top:50%;left:0;right:0;border-top:1px dashed #cfe9ff}
.qxsim-box{position:absolute;box-sizing:border-box;border:1px solid #cbdaged80;overflow:visible;display:flex;align-items:center;justify-content:center;white-space:pre-wrap;pointer-events:none;transform:rotate(var(--rotation,0deg));transform-origin:center}.qxsim-box.container{border-color:#4ea5e66b;background:transparent}.qxsim-box.textbox,.qxsim-box.textwindow{overflow:hidden}.qxsim-box.cursor{border-style:dashed;background:#4a8eb519}.qxsim-box.reference{border-style:dashed;background:#7365c219}.qxsim-box.grid{background-image:linear-gradient(#6a92bd26 1px,transparent 1px),linear-gradient(90deg,#6a92bd26 1px,transparent 1px);background-size:20px 20px}.qxsim-box.keyhint{border-radius:4px;background:#2b3441b8}.qxsim-box.animation,.qxsim-box.fullscreen{border-style:dotted}.qxsim-box.button{border-radius:6px;background:linear-gradient(#465467e6,#28313ee6);box-shadow:inset 0 0 0 1px #ffffff14}.qxsim-box.selected{z-index:2;border-color:#61b9ff;box-shadow:inset 0 0 0 1px #3a76ff,0 0 0 1px #0006}.qxsim-box.dynamic{border-style:dashed}.qxsim-box.pressed{filter:brightness(.72);transform:rotate(var(--rotation,0deg)) scale(.98)}.qxsim-box-label{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 4px;border-radius:3px;color:#e7edf5;background:#111925a8;text-shadow:0 1px 2px #000;font-size:10px}.qxsim-box.fullscreen>.qxsim-box-label{position:absolute;left:5px;top:5px}.qxsim-handle{position:absolute;width:7px;height:7px;border:1px solid #fff;background:#4388ff;box-shadow:0 0 0 1px #2d4e88}.qxsim-handle.tl{left:-4px;top:-4px}.qxsim-handle.tr{right:-4px;top:-4px}.qxsim-handle.bl{left:-4px;bottom:-4px}.qxsim-handle.br{right:-4px;bottom:-4px}
.qxsim-status{min-height:30px;display:flex;align-items:center;gap:10px;padding:5px 10px;border-top:1px solid var(--line);background:var(--status);color:var(--muted);font-size:10px}.qxsim-status .spacer{flex:1}.qxsim-status.error{color:var(--danger)}
.qxsim-inspector-head{padding:9px 11px 8px;border-bottom:1px solid var(--lineSoft)}.qxsim-inspector-line{display:flex;align-items:center;gap:7px}.qxsim-inspector-line strong{font-size:15px}.qxsim-node-id{margin-top:2px;color:var(--muted);font-size:10px}.qxsim-node-id code{color:#4f7fe9}.qxsim-tabs{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin:7px 9px 5px;padding:3px;border:1px solid var(--line);border-radius:17px;background:var(--input)}.qxsim-tabs button{height:28px;border:0;border-radius:14px;background:transparent;color:var(--muted)}.qxsim-tabs button.active{color:#fff;background:linear-gradient(#4c83ff,#3d70dc)}.qxsim-inspector-scroll{flex:1;min-height:0;overflow:auto;padding:0 7px 9px;scrollbar-color:color-mix(in srgb,var(--muted) 55%,transparent) transparent}
.qxsim-section{margin:5px 0;border:1px solid var(--line);border-radius:6px;background:var(--panel2);overflow:hidden}.qxsim-section summary{height:34px;display:flex;align-items:center;gap:7px;padding:0 9px;font-weight:650;cursor:pointer;list-style:none}.qxsim-section summary::-webkit-details-marker{display:none}.qxsim-section summary:before{content:"›";color:var(--muted)}.qxsim-section[open] summary:before{transform:rotate(90deg)}.qxsim-section summary:after{content:"≡";margin-left:auto;color:var(--muted)}.qxsim-section-body{padding:8px 9px 9px;border-top:1px solid var(--lineSoft)}.qxsim-field{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}.qxsim-field:last-child{margin-bottom:0}.qxsim-field-label{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:11px}.qxsim-field small{color:var(--muted)}.qxsim-field input[type=text],.qxsim-field input[type=number],.qxsim-field textarea,.qxsim-field select{width:100%;min-width:0;border:1px solid var(--line);border-radius:5px;outline:0;background:var(--input);padding:5px 7px}.qxsim-field input:focus,.qxsim-field textarea:focus,.qxsim-field select:focus{border-color:var(--blue);box-shadow:0 0 0 2px #4075e52e}.qxsim-field select,.qxsim-field input[type=number]{height:31px}.qxsim-field textarea{resize:vertical}.qxsim-note{padding:7px 8px;border-left:2px solid #dea943;background:color-mix(in srgb,#dea943 10%,var(--panel2));color:var(--muted)}
.qxsim-switch-row{min-height:32px;display:flex;align-items:center;gap:8px;margin-bottom:4px}.qxsim-switch{position:relative;width:40px;height:22px;margin-left:auto;flex:0 0 40px}.qxsim-switch input{position:absolute;opacity:0}.qxsim-switch-track{position:absolute;inset:0;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--muted) 28%,var(--input))}.qxsim-switch-track:after{content:"";position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:var(--muted);box-shadow:0 1px 3px #0006;transition:.15s}.qxsim-switch input:checked+.qxsim-switch-track{border-color:#5688f4;background:#477cec}.qxsim-switch input:checked+.qxsim-switch-track:after{left:21px;background:#fff}.qxsim-pair{display:grid;grid-template-columns:42px minmax(0,1fr) minmax(0,1fr);gap:5px;align-items:end;margin-bottom:7px}.qxsim-pair-name{padding-bottom:7px;color:var(--muted);font-size:11px}.qxsim-pair .qxsim-field{margin:0}.qxsim-pair .qxsim-field-label{font-size:10px}.qxsim-axis{display:grid;place-items:center;width:17px;height:17px;border-radius:3px;font-size:10px}.qxsim-axis.x{color:#ff9aa6;background:#6c2733}.qxsim-axis.y{color:#a9e178;background:#2f5726}.qxsim-axis.w,.qxsim-axis.h{color:#8bc7ff;background:#294762}.qxsim-color-row{display:grid;grid-template-columns:34px 1fr;gap:6px}.qxsim-color-swatch{position:relative;width:34px;height:31px;border:1px solid var(--line);border-radius:5px;overflow:hidden;background:#fff}.qxsim-color-swatch input{position:absolute;inset:-8px;width:50px;height:47px;padding:0;border:0;cursor:pointer}.qxsim-percent{display:grid;grid-template-columns:minmax(0,1fr) 58px;gap:7px;align-items:center}.qxsim-percent input[type=range]{width:100%;accent-color:var(--blue)}.qxsim-percent output{height:30px;display:grid;place-items:center;border:1px solid var(--line);border-radius:5px;background:var(--input)}.qxsim-subfields{margin:2px 0 8px 8px;padding:7px 0 2px 9px;border-left:2px solid color-mix(in srgb,var(--blue) 55%,var(--line))}.qxsim-state-field{margin:8px 0}.qxsim-state-label{display:flex;align-items:center;gap:6px;margin-bottom:4px;color:var(--muted);font-size:11px}.qxsim-unsupported{min-height:31px;display:flex;align-items:center;padding:5px 8px;border:1px dashed var(--line);border-radius:5px;background:color-mix(in srgb,var(--muted) 8%,var(--input));color:var(--muted)}.qxsim-state-ref{display:grid;grid-template-columns:32px minmax(0,1fr);height:54px;border:1px dashed var(--line);border-radius:6px;background:color-mix(in srgb,var(--input) 72%,transparent);overflow:hidden}.qxsim-state-ref button{border:0;border-right:1px solid var(--line);background:transparent;color:var(--muted);font-size:22px}.qxsim-state-ref button:hover{color:var(--blue);background:var(--hover)}.qxsim-state-ref select{min-width:0;border:0;outline:0;background:transparent;padding:0 7px}.qxsim-script-actions{display:flex;justify-content:flex-end}.qxsim-script-actions button{height:30px;padding:0 10px;border:1px solid #4779e6;border-radius:5px;color:#fff;background:#2e5cab}.qxsim-empty{padding:22px 10px;text-align:center;color:var(--muted)}
.qxsim-script-page{display:grid;grid-template-columns:280px minmax(420px,1fr);flex:1;min-height:0;background:var(--workspace)}.qxsim-script-assets{min-height:0;padding:12px;border-right:1px solid var(--line);background:var(--panel);overflow:auto}.qxsim-script-assets h3{margin:2px 4px 10px;font-size:13px}.qxsim-script-asset{width:100%;margin-bottom:7px;padding:10px;border:1px solid var(--line);border-radius:7px;background:var(--button);text-align:left}.qxsim-script-asset.active{border-color:var(--blue);background:color-mix(in srgb,var(--blue) 14%,var(--button))}.qxsim-script-asset strong,.qxsim-script-asset small{display:block}.qxsim-script-asset small{margin-top:3px;color:var(--muted)}.qxsim-script-list-row{display:flex;gap:4px;align-items:stretch;margin-bottom:7px}.qxsim-script-list-row .qxsim-script-asset{flex:1;min-width:0;margin-bottom:0}.qxsim-script-list-row .qxsim-iconbtn{flex:0 0 30px;width:30px;min-height:30px;height:auto;align-self:stretch}.qxsim-script-editor{min-width:0;min-height:0;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;gap:10px;padding:18px 22px}.qxsim-script-title{display:flex;align-items:end;justify-content:space-between;gap:16px}.qxsim-script-title h2{margin:0;font-size:18px}.qxsim-script-title span{color:var(--muted);font-size:11px}.qxsim-script-fields{display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1fr);gap:10px}.qxsim-script-editor label{display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:11px}.qxsim-script-editor input,.qxsim-script-editor select,.qxsim-script-editor textarea{min-width:0;border:1px solid var(--line);border-radius:6px;outline:0;background:var(--input);color:var(--text)}.qxsim-script-editor input,.qxsim-script-editor select{height:34px;padding:0 9px}.qxsim-script-editor textarea{width:100%;height:100%;min-height:220px;padding:12px;resize:none;font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2}.qxsim-script-editor textarea:focus,.qxsim-script-editor input:focus,.qxsim-script-editor select:focus{border-color:var(--blue);box-shadow:0 0 0 2px #4075e52e}.qxsim-script-footer{display:flex;align-items:center;gap:8px}.qxsim-script-footer span{color:var(--muted);font-size:10px}.qxsim-script-footer .spacer{flex:1}
.qxsim-server-logic{flex:1;min-height:0;overflow:auto;padding:18px 22px;background:var(--workspace)}.qxsim-logic-wrap{max-width:900px;margin:0 auto}.qxsim-logic-title{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:10px}.qxsim-logic-title h2{margin:0;font-size:18px}.qxsim-logic-title p{margin:3px 0 0;color:var(--muted);font-size:11px}.qxsim-logic-rule{margin:12px 0;border:1px solid var(--line);border-radius:8px;background:var(--panel);overflow:hidden}.qxsim-logic-rule-head,.qxsim-logic-action-head{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid var(--lineSoft)}.qxsim-logic-rule-head strong,.qxsim-logic-action-head strong{font-size:12px}.qxsim-logic-rule-head .qxsim-field{flex:1;margin:0}.qxsim-logic-rule-head .qxsim-field input{height:30px}.qxsim-logic-actions{padding:10px}.qxsim-logic-action{margin-bottom:9px;border:1px solid var(--line);border-radius:6px;background:var(--panel2);overflow:hidden}.qxsim-logic-action:last-child{margin-bottom:0}.qxsim-logic-action-head{min-height:36px;padding:6px 8px}.qxsim-logic-action-head span{color:var(--muted);font-size:10px}.qxsim-logic-action-head .qxsim-iconbtn{width:28px;height:28px;margin-left:auto}.qxsim-logic-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:9px}.qxsim-logic-fields .wide{grid-column:1 / -1}.qxsim-logic-actions-foot{display:flex;gap:7px;margin-top:10px}.qxsim-logic-actions-foot .qxsim-action{flex:0 0 auto}.qxsim-logic-json{min-height:58px;font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}.qxsim-logic-target{height:31px;display:flex;align-items:center;padding:0 7px;border:1px solid var(--line);border-radius:5px;background:color-mix(in srgb,var(--input) 75%,var(--muted));color:var(--muted)}.qxsim-logic-error{margin:10px 0;color:var(--danger);font-size:11px}.qxsim-logic-empty{padding:24px 12px;border:1px dashed var(--line);border-radius:8px;text-align:center;color:var(--muted);background:color-mix(in srgb,var(--panel) 70%,transparent)}
.qxsim-toolbar-center{min-width:0}.qxsim-device-switch{display:flex;flex:0 0 auto;gap:2px;padding:2px;border:1px solid var(--line);border-radius:9px;background:var(--input)}.qxsim-device-switch button{height:26px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:var(--muted);font-size:11px;font-weight:600;white-space:nowrap}.qxsim-device-switch button:hover{color:var(--text)}.qxsim-device-switch button.active{color:#fff;background:linear-gradient(#4f86ff,#3c6ed8);box-shadow:0 1px 5px #1d4b9f44}.qxsim-control.ratio{width:150px;min-width:0;padding-right:22px;text-overflow:ellipsis}.qxsim-io .qxsim-control{width:118px;min-width:0;padding-right:22px;text-overflow:ellipsis}.qxsim-platform-tag{padding:2px 7px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--text);font-weight:600;font-size:10px}
.qxsim-toolbar{grid-template-columns:minmax(170px,1fr) auto auto;column-gap:12px}.qxsim-toolbar-center .zoom{width:78px;min-width:78px}.qxsim-actions{min-width:0}
@container(max-width:1180px){.qxsim-toolbar{grid-template-columns:minmax(130px,1fr) auto auto;column-gap:8px}.qxsim-action{padding:0 8px}.qxsim-main{grid-template-columns:200px minmax(300px,1fr) 292px}.qxsim-control{min-width:132px}.qxsim-control.ratio{width:128px}.qxsim-io .qxsim-control{width:96px}.qxsim-device-switch button{padding:0 7px}.qxsim-workspace{padding-left:12px;padding-right:12px}.qxsim-brand-text span{display:none}.qxsim-asset-switch button{font-size:11px}}
@container(max-width:1000px){.qxsim-toolbar{height:90px;flex-basis:90px;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:42px 42px}.qxsim-toolbar-center{justify-self:end}.qxsim-actions{grid-column:1 / -1}.qxsim-editor-nav .save-summary{display:none}.qxsim-inspector{top:130px}}
@container(max-width:820px){.qxsim-main{grid-template-columns:180px minmax(280px,1fr)}.qxsim-inspector{position:absolute;right:0;top:130px;bottom:0;width:285px;z-index:5;box-shadow:-10px 0 24px var(--shadow)}.qxsim-script-page{grid-template-columns:190px minmax(320px,1fr)}.qxsim-script-editor{padding:12px}.qxsim-script-fields{grid-template-columns:1fr}}
`

    const KIND_META = {
      'server-container': ['▣', '客户端控件容器'], container: ['□', '容器节点'], textbox: ['T', '文本框'], cursor: ['⌁', '光标检测区域'], reference: ['↗', '模板引用控件'], grid: ['▦', '网格视窗'], image: ['▧', '图片'], button: ['Btn', '预设按钮'], textwindow: ['T↕', '文本视窗'], keyhint: ['1', '按键提示'], animation: ['✦', '界面动效'], fullscreen: ['✥', '全屏动效'],
    }
    const CONTROL_TYPES = [
      ['container', '容器节点'], ['textbox', '文本框'], ['cursor', '光标检测'],
      ['reference', '模板引用'], ['grid', '网格视窗'], ['button', '预设按钮'],
      ['textwindow', '文本视窗'], ['keyhint', '按键提示'], ['image', '图片'],
      ['animation', '界面动效'], ['fullscreen', '全屏动效'],
    ]
    const TYPE_KEYS = {
      container: ['isolateNavigation', 'disableKeyEventPassthrough', 'disableCursorEventPassthrough', 'showCursor'],
      textbox: ['fontSize', 'adaptiveFontSize', 'minimumFontSize', 'fontColor', 'bgColor', 'enableOutline', 'outlineColor', 'horizontalAlignment', 'verticalAlignment', 'text'],
      cursor: [],
      reference: ['referencedPrefabId'],
      grid: ['cellSizeX', 'cellSizeY', 'spacingX', 'spacingY', 'padding1X', 'padding1Y', 'padding2X', 'padding2Y', 'previewCount'],
      image: ['imageSource', 'imageId', 'imageColor', 'enableMask', 'enableSoftEdge', 'softEdgeMode', 'softEdgeWidthX', 'softEdgeWidthY', 'horizontalSoftRange', 'verticalSoftRange', 'enableFill', 'fillType', 'fillHorizontalType', 'fillVerticalType', 'fillRadial90Type', 'fillRadialType', 'fillAmount', 'reverseMaskArea'],
      button: ['raycastTarget', 'interactable', 'unavailableChildId', 'hoverChildId', 'pressedChildId', 'selectedChildId', 'clickAudioId'],
      textwindow: ['fontSize', 'adaptiveFontSize', 'minimumFontSize', 'fontColor', 'bgColor', 'enableOutline', 'outlineColor', 'horizontalAlignment', 'verticalAlignment', 'text'],
      keyhint: ['keyboardKeyCode', 'controllerKeyCode'],
      animation: ['animationId'],
      fullscreen: ['animationId'],
    }

    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }
    function readHostTheme() {
      const root = document.documentElement
      const body = document.body
      const hint = [root.dataset.theme, root.className, root.getAttribute('style'), body?.dataset?.theme, body?.className, body?.getAttribute('style'), getComputedStyle(root).colorScheme].filter(Boolean).join(' ').toLowerCase()
      if (hint.includes('dark')) return 'dark'
      if (hint.includes('light')) return 'light'
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    function useHostTheme() {
      const [theme, setTheme] = React.useState(readHostTheme)
      React.useEffect(() => {
        const refresh = () => setTheme(readHostTheme())
        const observer = new MutationObserver(refresh)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
        if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
        const media = window.matchMedia?.('(prefers-color-scheme: dark)')
        media?.addEventListener?.('change', refresh)
        return () => { observer.disconnect(); media?.removeEventListener?.('change', refresh) }
      }, [])
      return theme
    }
    function argb(value, fallback) {
      const v = Number(value == null ? fallback : value) >>> 0
      return `rgba(${(v >>> 16) & 255},${(v >>> 8) & 255},${v & 255},${((v >>> 24) & 255) / 255})`
    }
    function colorHex(value) { return `#${(Number(value) >>> 0).toString(16).padStart(8, '0').toUpperCase()}` }
    function shape(primitive, color) {
      if (primitive === 'circle') return { borderRadius: '50%', background: color }
      if (primitive === 'ring') return { borderRadius: '50%', border: `7px solid ${color}`, background: 'transparent' }
      if (primitive === 'triangle') return { background: color, clipPath: 'polygon(50% 0,100% 100%,0 100%)' }
      if (primitive === 'fourstar') return { background: color, clipPath: 'polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%)' }
      if (primitive === 'fivestar') return { background: color, clipPath: 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)' }
      if (primitive === 'missing') return { background: '#4822285c', border: '1px dashed #ff7481' }
      return { background: color }
    }
    const callApi = api
    function downloadBase64(result) {
      let binary
      try {
        binary = atob(result.data)
      } catch {
        throw new Error('导出内容解码失败，请重试或刷新页面')
      }
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || 'application/octet-stream' }))
      const link = document.createElement('a')
      link.href = url; link.download = result.filename || 'qxqy-export'
      link.rel = 'noopener'
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1_000)
    }
    async function fileBase64(file) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
      return btoa(binary)
    }
    const optionValue = (option) => typeof option === 'object' ? option.value : option
    const optionLabel = (option) => typeof option === 'object' ? option.label : option

    const DEVICE_GROUPS = [
      { key: 'KEYBOARD', label: 'PC', title: 'PC KEYBOARD 画布：1600×900 / 2100×900' },
      { key: 'TOUCHSCREEN', label: '手机', title: '手机 TOUCHSCREEN 画布：1280×720 / 1560×720 / 1280×960' },
    ]
    // 预设 id 即比例编码（pc-16-9 → 16:9，mobile-19.5-9 → 19.5:9）。
    function presetRatio(preset) {
      return String(preset.id || '').split('-').slice(1).join(':')
    }
    function ratioText(width, height) {
      const gcd = (a, b) => (b ? gcd(b, a % b) : a)
      const d = gcd(Math.round(width), Math.round(height)) || 1
      return `${Math.round(width) / d}:${Math.round(height) / d}`
    }

    function DraftField({ field, commit, axis }) {
      const initial = field.type === 'color' ? colorHex(field.value) : (field.value == null ? '' : String(field.value))
      const [draft, setDraft] = React.useState(initial)
      React.useEffect(() => setDraft(field.type === 'color' ? colorHex(field.value) : (field.value == null ? '' : String(field.value))), [field.value, field.type])
      if (field.type === 'note') return e('div', { className: 'qxsim-note' }, field.value || field.label)
      if (field.readonly && (field.evidence === 'N' || field.evidence === 'U')) return e('div', { className: 'qxsim-field' }, e('span', { className: 'qxsim-field-label' }, field.label), e('div', { className: 'qxsim-unsupported' }, field.value == null ? '尚无可编辑值' : String(field.value)))
      if (field.type === 'bool') return e('div', { className: 'qxsim-switch-row' }, e('span', null, field.label), e('label', { className: 'qxsim-switch' }, e('input', { type: 'checkbox', checked: !!field.value, disabled: !!field.readonly, onChange: (event) => commit(field.key, event.target.checked) }), e('span', { className: 'qxsim-switch-track' })))
      if (field.type === 'enum') {
        const options = [...(field.options || [])]
        const current = String(field.value ?? '')
        if (!options.some((option) => String(optionValue(option)) === current)) {
          options.unshift({ value: field.value ?? '', label: `未识别选项 ${field.unknownValue ?? (current || '空')}（保留原值）` })
        }
        return e('label', { className: 'qxsim-field' }, e('span', { className: 'qxsim-field-label' }, field.label), e('select', { value: current, disabled: !!field.readonly, onChange: (event) => commit(field.key, event.target.value) }, options.map((option) => e('option', { key: String(optionValue(option)), value: optionValue(option) }, optionLabel(option)))))
      }
      if (field.type === 'percent') {
        const percent = Math.round(Number(field.value || 0) * 100)
        return e('label', { className: 'qxsim-field' }, e('span', { className: 'qxsim-field-label' }, field.label), e('span', { className: 'qxsim-percent' }, e('input', { type: 'range', min: 0, max: 100, value: percent, onInput: (event) => commit(field.key, Number(event.target.value) / 100) }), e('output', null, `${percent}%`)))
      }
      if (field.type === 'color') {
        const normalized = /^#[0-9a-f]{8}$/i.test(draft) ? draft : colorHex(field.value)
        return e('label', { className: 'qxsim-field' }, e('span', { className: 'qxsim-field-label' }, field.label, e('small', null, 'ARGB')), e('span', { className: 'qxsim-color-row' }, e('span', { className: 'qxsim-color-swatch', title: '打开取色器' }, e('input', { type: 'color', value: `#${normalized.slice(3)}`, onInput: (event) => { const value = `#${normalized.slice(1, 3)}${event.target.value.slice(1).toUpperCase()}`; setDraft(value); commit(field.key, value) } })), e('input', { type: 'text', value: draft, spellCheck: false, 'aria-label': `${field.label} ARGB`, onChange: (event) => setDraft(event.target.value), onBlur: () => commit(field.key, draft), onKeyDown: (event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setDraft(colorHex(field.value)) } })))
      }
      const inputProps = { value: draft, disabled: !!field.readonly, readOnly: !!field.readonly, onChange: (event) => setDraft(event.target.value), onBlur: () => { if (!field.readonly) commit(field.key, draft) }, onKeyDown: (event) => { if (event.key === 'Enter' && field.type !== 'text') event.currentTarget.blur(); if (event.key === 'Escape') setDraft(field.value == null ? '' : String(field.value)) } }
      return e('label', { className: 'qxsim-field' }, e('span', { className: 'qxsim-field-label' }, axis ? e('b', { className: `qxsim-axis ${axis.toLowerCase()}` }, axis) : null, field.label), field.type === 'text' ? e('textarea', { ...inputProps, rows: 4 }) : e('input', { ...inputProps, type: field.type === 'number' ? 'number' : 'text', step: field.type === 'number' ? 'any' : undefined }))
    }
    function Section({ title, open = true, children }) { return e('details', { className: 'qxsim-section', open }, e('summary', null, title), e('div', { className: 'qxsim-section-body' }, children)) }
    function mapFields(fields) { const out = {}; for (const field of fields || []) out[field.key] = field; return out }
    function Pair({ label, x, y, xAxis = 'X', yAxis = 'Y', commit }) { return e('div', { className: 'qxsim-pair' }, e('div', { className: 'qxsim-pair-name' }, label), e(DraftField, { field: x, axis: xAxis, commit }), e(DraftField, { field: y, axis: yAxis, commit })) }
    function NodeReferenceField({ field, commit, createStateChild }) {
      return e('div', { className: 'qxsim-state-field' },
        e('div', { className: 'qxsim-state-label' }, field.label),
        e('div', { className: 'qxsim-state-ref' },
          e('button', { title: `新建并绑定${field.label}图片`, onClick: () => createStateChild(field.key, field.label) }, '+'),
          e('select', { value: String(field.value ?? ''), 'aria-label': field.label, onChange: (event) => commit(field.key, event.target.value) }, (field.options || []).map((option) => e('option', { key: String(optionValue(option)), value: optionValue(option) }, optionLabel(option))))))
    }
    function BaseInspector({ inspector, commit, createStateChild }) {
      const f = mapFields(inspector.fields)
      const renderField = (field) => field?.type === 'node'
        ? e(NodeReferenceField, { key: field.key, field, commit, createStateChild })
        : field ? e(DraftField, { key: field.key, field, commit }) : null
      let typeFields = (TYPE_KEYS[inspector.kind] || []).map((key) => f[key]).filter(Boolean).map(renderField)
      let typeSections = null
      if (inspector.kind === 'image') {
        const fillDirection = f.fillType?.value === 'Horizontal' ? f.fillHorizontalType
          : f.fillType?.value === 'Vertical' ? f.fillVerticalType
            : f.fillType?.value === 'Radial90' ? f.fillRadial90Type : f.fillRadialType
        const maskFields = [
          renderField(f.enableMask),
          renderField(f.enableSoftEdge),
          f.enableSoftEdge?.value ? e('div', { className: 'qxsim-subfields', key: 'soft-fields' }, renderField(f.softEdgeMode), e(Pair, { label: '羽化宽度', x: f.softEdgeWidthX, y: f.softEdgeWidthY, commit }), e(Pair, { label: '羽化范围', x: f.horizontalSoftRange, y: f.verticalSoftRange, commit })) : null,
          renderField(f.enableFill),
          f.enableFill?.value ? e('div', { className: 'qxsim-subfields', key: 'fill-fields' }, renderField(f.fillType), renderField(fillDirection), renderField(f.fillAmount)) : null,
          renderField(f.reverseMaskArea),
        ]
        typeSections = e(React.Fragment, null,
          e(Section, { title: '图片设置' }, renderField(f.imageSource), renderField(f.imageId), renderField(f.imageColor)),
          e(Section, { title: '遮罩设置' }, maskFields))
      }
      const typeTitle = inspector.kind === 'textbox' ? '文本框设置' : inspector.kind === 'button' ? '按钮设置' : `${inspector.label}设置`
      return e(React.Fragment, null,
        e(Section, { title: '节点信息', open: false }, e(DraftField, { field: f.name, commit })),
        e(Section, { title: '变换' }, f.posX ? e(Pair, { label: '位置', x: f.posX, y: f.posY, commit }) : null, f.width ? e(Pair, { label: '大小', x: f.width, y: f.height, xAxis: 'W', yAxis: 'H', commit }) : null, f.rotationZ ? e(DraftField, { field: f.rotationZ, commit }) : null, f.syncAllDevices ? e(DraftField, { field: f.syncAllDevices, commit }) : null, f.anchorType ? e(DraftField, { field: f.anchorType, commit }) : null, f.anchorMinX ? e(Pair, { label: 'Min', x: f.anchorMinX, y: f.anchorMinY, commit }) : null, f.anchorMaxX ? e(Pair, { label: 'Max', x: f.anchorMaxX, y: f.anchorMaxY, commit }) : null, f.pivotX ? e(Pair, { label: '中心', x: f.pivotX, y: f.pivotY, commit }) : null),
        e(Section, { title: '创建设置' }, f.active ? e(DraftField, { field: f.active, commit }) : null, f.visible ? e(DraftField, { field: f.visible, commit }) : null),
        typeSections || (typeFields.length ? e(Section, { title: typeTitle }, typeFields) : null),
        f.canControllerFocus ? e(Section, { title: '手柄导航', open: false }, e(DraftField, { field: f.canControllerFocus, commit })) : null,
        f.incomplete ? e(Section, { title: '实现状态' }, e(DraftField, { field: f.incomplete, commit })) : null)
    }
    function ScriptPage({ snap, selectedScriptId, selectScript, draft, updateDraft, saveScript, addScript, removeScript, exportLua, exportScripts, exportScriptsGia, notice }) {
      const scripts = snap.scripts || []
      const current = scripts.find((row) => row.id === selectedScriptId) || null
      const targets = snap.mountTargets || []
      const serverTargets = targets.filter((row) => row.assetType === 'server-control-template')
      const clientTargets = targets.filter((row) => row.assetType === 'client-control-template')
      const targetLabel = (id) => {
        const row = targets.find((item) => item.id === id)
        return row ? `${row.assetLabel} · ${row.name}` : ''
      }
      return e('div', { className: 'qxsim-script-page' },
        e('aside', { className: 'qxsim-script-assets' },
          e('h3', null, `存档内 Lua 脚本（${scripts.length}）`),
          e('button', { className: 'qxsim-action', style: { width: '100%', marginBottom: 8 }, onClick: addScript }, '＋ 新建脚本'),
          scripts.length ? scripts.map((script) => e('div', { key: script.id, className: 'qxsim-script-list-row' },
            e('button', { className: `qxsim-script-asset${script.id === selectedScriptId ? ' active' : ''}`, onClick: () => selectScript(script.id) },
              e('strong', null, script.path || '(未命名脚本)'),
              e('small', null, script.mounted ? `挂载：${script.assetLabel} · ${script.controlName}` : '未挂载（仅可被 require）')),
            e('button', { className: 'qxsim-iconbtn', title: '下载该脚本 .lua', onClick: () => exportLua(script.id) }, '⇩'),
            e('button', { className: 'qxsim-iconbtn', title: '删除该脚本', onClick: () => removeScript(script.id) }, '✕'))) : e('div', { className: 'qxsim-empty' }, '还没有脚本，点击“新建脚本”开始')),
        e('main', { className: 'qxsim-script-editor' },
          current && draft ? e(React.Fragment, null,
            e('div', { className: 'qxsim-script-title' }, e('div', null, e('h2', null, draft.path || '(未命名脚本)'), e('span', null, `属于存档“${snap.save?.name || '未命名存档'}” · Lua 脚本是存档内独立资产`)), e('span', null, `脚本 ${current.id}`)),
            e('div', { className: 'qxsim-script-fields' },
              e('label', null, '脚本路径（工作区相对路径）', e('input', { type: 'text', value: draft.path, placeholder: 'lua/example.lua', onChange: (event) => updateDraft({ path: event.target.value }) })),
              e('label', null, '挂载目标（客户端控件 / 客户端控件模板）', e('select', { value: draft.controlId ? `${draft.controlAsset || 'server-control-template'}|${draft.controlId}` : '', onChange: (event) => { const [assetType, id] = event.target.value.split('|'); updateDraft(id ? { controlId: id, controlAsset: assetType } : { controlId: '', controlAsset: '' }) } },
                e('option', { value: '' }, '未挂载（不生效，仅可被 require）'),
                e('optgroup', { label: '服务器控件模板 · 客户端控件容器内' }, serverTargets.map((row) => e('option', { key: row.id, value: `${row.assetType}|${row.id}` }, `${row.name} · ${row.id}`))),
                clientTargets.length ? e('optgroup', { label: '客户端控件模板' }, clientTargets.map((row) => e('option', { key: row.id, value: `${row.assetType}|${row.id}` }, `${row.name} · ${row.id}`))) : null))),
            e('label', null, 'Lua 源码', e('textarea', { value: draft.source, spellCheck: false, placeholder: '-- 在这里输入客户端 Lua；脚本只有挂载到客户端控件后才会在试玩时生效', onChange: (event) => updateDraft({ source: event.target.value }) })),
            e('div', { className: 'qxsim-script-footer' }, e('span', null, draft.dirty ? '有未保存的修改' : (notice || (current.mounted ? `已挂载：${targetLabel(current.controlId)}` : '当前未挂载，试玩时不会自动运行'))), e('span', { className: 'spacer' }), e('button', { className: 'qxsim-action', onClick: exportScripts }, '⇩ 脚本包 JSON'), e('button', { className: 'qxsim-action', onClick: exportScriptsGia }, '⇩ 脚本包 GIA'), e('button', { className: 'qxsim-action primary', disabled: !draft.dirty, onClick: saveScript }, '保存脚本')))
          : e('div', { className: 'qxsim-empty' }, '请新建或选择一个脚本')))
    }
    function stringifyLogicValue(value) {
      if (value === undefined) return 'null'
      try { return JSON.stringify(value) } catch { return String(value) }
    }
    function parseLogicValue(text) {
      const raw = String(text ?? '').trim()
      if (!raw) return null
      try { return JSON.parse(raw) } catch { return raw }
    }
    function isSignalParamRef(value) {
      return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'fromSignalParam'))
    }
    function cloneServerLogic(logic) {
      const rules = Array.isArray(logic?.rules) ? logic.rules : []
      return {
        version: 1,
        dirty: false,
        rules: rules.map((rule, index) => ({
          id: String(rule.id || `signal-${index + 1}`),
          signalName: String(rule.signalName || ''),
          actions: Array.isArray(rule.actions) && rule.actions.length
            ? rule.actions.map((action) => cloneLogicAction(action))
            : [defaultLogicAction('setCustomVariable')],
        })),
      }
    }
    const PLAYER_LOGIC_TARGETS = ['PlayerSelf', 'AllPlayers', 'Player1', 'Player2', 'Player3', 'Player4', 'Player5', 'Player6', 'Player7', 'Player8']
    const PLAYER_LOGIC_ENTITIES = ['PlayerSelf', 'Level', 'Player1', 'Player2', 'Player3', 'Player4', 'Player5', 'Player6', 'Player7', 'Player8']
    const PLAYER_LOGIC_LABELS = {
      PlayerSelf: 'PlayerSelf 当前玩家',
      AllPlayers: 'AllPlayers 全部玩家',
      Level: 'Level 关卡',
      Player1: 'Player1 玩家1', Player2: 'Player2 玩家2', Player3: 'Player3 玩家3', Player4: 'Player4 玩家4',
      Player5: 'Player5 玩家5', Player6: 'Player6 玩家6', Player7: 'Player7 玩家7', Player8: 'Player8 玩家8',
    }
    function normalizeLogicEntity(value) {
      return PLAYER_LOGIC_ENTITIES.includes(value) && value !== 'AllPlayers' ? value : (value === 'Level' ? 'Level' : 'PlayerSelf')
    }
    function normalizeLogicTarget(value) {
      return PLAYER_LOGIC_TARGETS.includes(value) ? value : 'PlayerSelf'
    }
    function defaultLogicAction(kind) {
      if (kind === 'sendClientScriptSignal') return { kind: 'sendClientScriptSignal', target: 'PlayerSelf', signalName: '', params: [] }
      return { kind: 'setCustomVariable', entityType: 'PlayerSelf', name: '', value: 0 }
    }
    function sanitizeLogic(draft) {
      return {
        version: 1,
        rules: (draft?.rules || []).map((rule) => ({
          id: String(rule.id || ''),
          signalName: String(rule.signalName || '').trim(),
          actions: (rule.actions || []).map((action) => action?.kind === 'sendClientScriptSignal'
            ? { kind: 'sendClientScriptSignal', target: normalizeLogicTarget(action.target), signalName: String(action.signalName || '').trim(), params: Array.isArray(action.params) ? action.params : [] }
            : { kind: 'setCustomVariable', entityType: normalizeLogicEntity(action?.entityType), name: String(action?.name || '').trim(), value: action && Object.prototype.hasOwnProperty.call(action, 'value') ? action.value : 0 }),
        })),
      }
    }
    function logicDraftIssues(draft) {
      const issues = []
      for (const [index, rule] of (draft?.rules || []).entries()) {
        if (!String(rule.signalName || '').trim()) issues.push(`规则 ${index + 1} 需要监听信号名`)
        const actions = rule.actions || []
        if (!actions.length) issues.push(`规则 ${index + 1} 至少需要一个动作`)
        for (const [actionIndex, action] of actions.entries()) {
          if (action?.kind === 'sendClientScriptSignal') {
            if (!String(action.signalName || '').trim()) issues.push(`规则 ${index + 1} 动作 ${actionIndex + 1} 需要客户端信号名`)
          } else if (!String(action?.name || '').trim()) {
            issues.push(`规则 ${index + 1} 动作 ${actionIndex + 1} 需要变量名`)
          }
        }
      }
      return issues
    }
    function cloneLogicAction(action) {
      if (action?.kind === 'sendClientScriptSignal') {
        return {
          kind: 'sendClientScriptSignal',
          target: normalizeLogicTarget(action.target),
          signalName: String(action.signalName || ''),
          params: Array.isArray(action.params) ? action.params.map((item) => {
            try { return JSON.parse(JSON.stringify(item)) } catch { return item }
          }) : [],
        }
      }
      let value = 0
      if (action && Object.prototype.hasOwnProperty.call(action, 'value')) {
        try { value = JSON.parse(JSON.stringify(action.value)) } catch { value = action.value }
      }
      return {
        kind: 'setCustomVariable',
        entityType: normalizeLogicEntity(action?.entityType),
        name: String(action?.name || ''),
        value,
      }
    }
    function LogicValueField({ label, value, onChange }) {
      const param = isSignalParamRef(value)
      const [draft, setDraft] = React.useState(() => param ? '' : stringifyLogicValue(value))
      React.useEffect(() => {
        if (!isSignalParamRef(value)) setDraft(stringifyLogicValue(value))
      }, [value])
      return e('label', { className: 'qxsim-field' },
        e('span', { className: 'qxsim-field-label' }, label),
        e('select', { value: param ? 'param' : 'literal', 'aria-label': `${label}来源`, onChange: (event) => {
          if (event.target.value === 'param') onChange({ fromSignalParam: Number(value?.fromSignalParam) || 0 })
          else onChange(parseLogicValue(draft || '0'))
        } }, e('option', { value: 'literal' }, '字面量（JSON）'), e('option', { value: 'param' }, '引用监听信号参数')),
        param
          ? e('input', { type: 'number', min: 0, step: 1, value: Number(value.fromSignalParam) || 0, 'aria-label': `${label}参数序号`, onChange: (event) => onChange({ fromSignalParam: Math.max(0, Math.trunc(Number(event.target.value) || 0)) }) })
          : e('textarea', { className: 'qxsim-logic-json', value: draft, spellCheck: false, 'aria-label': `${label}字面量`, onBlur: () => onChange(parseLogicValue(draft)), onChange: (event) => setDraft(event.target.value) }))
    }
    function LogicParamsField({ params, onChange }) {
      const rows = Array.isArray(params) ? params : []
      return e('div', { className: 'qxsim-field wide' },
        e('span', { className: 'qxsim-field-label' }, '客户端信号参数（按添加顺序）'),
        rows.length ? rows.map((item, index) => e('div', { key: index, style: { display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 6 } },
          e('div', { style: { flex: 1, minWidth: 0 } }, e(LogicValueField, { label: `参数 ${index}`, value: item, onChange: (next) => onChange(rows.map((row, rowIndex) => rowIndex === index ? next : row)) })),
          e('button', { className: 'qxsim-iconbtn', title: '删除参数', onClick: () => onChange(rows.filter((_, rowIndex) => rowIndex !== index)) }, '✕'))) : e('div', { className: 'qxsim-muted' }, '暂无参数，可发送空参数列表'),
        e('button', { className: 'qxsim-action', style: { marginTop: 4 }, onClick: () => onChange(rows.concat([0])) }, '＋ 添加参数'))
    }
    function ServerLogicPage({ snap, draft, setDraft, saveLogic, notice, error }) {
      const rules = draft?.rules || []
      function commit(nextRules) {
        setDraft({ version: 1, rules: nextRules, dirty: true })
      }
      function addRule() {
        commit(rules.concat([{ id: `signal-${Date.now().toString(36)}`, signalName: '', actions: [defaultLogicAction('setCustomVariable')] }]))
      }
      function updateRule(index, fields) {
        commit(rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...fields } : rule))
      }
      function updateAction(ruleIndex, actionIndex, fields) {
        const rule = rules[ruleIndex]
        if (!rule) return
        updateRule(ruleIndex, { actions: rule.actions.map((action, index) => index === actionIndex ? { ...action, ...fields } : action) })
      }
      function replaceAction(ruleIndex, actionIndex, kind) {
        updateAction(ruleIndex, actionIndex, defaultLogicAction(kind))
      }
      return e('div', { className: 'qxsim-server-logic' },
        e('div', { className: 'qxsim-logic-wrap' },
          e('div', { className: 'qxsim-logic-title' },
            e('div', null, e('h2', null, '服务端逻辑'), e('p', null, `属于存档“${snap.save?.name || '未命名存档'}” · 监听客户端信号后设置 Level / 玩家变量，或向指定玩家发送客户端脚本信号`)),
            e('button', { className: 'qxsim-action primary', disabled: !draft?.dirty, onClick: saveLogic }, '保存服务端逻辑')),
          e('div', { className: 'qxsim-note' }, '这是模拟器存档格式，不是官方节点图。PlayerSelf 表示发信号的那位玩家；Player1–8 是固定座位；AllPlayers 向本局全部试玩玩家广播。'),
          error ? e('div', { className: 'qxsim-logic-error' }, error) : null,
          rules.length ? rules.map((rule, ruleIndex) => e('section', { key: rule.id || ruleIndex, className: 'qxsim-logic-rule' },
            e('div', { className: 'qxsim-logic-rule-head' },
              e('strong', null, `规则 ${ruleIndex + 1}`),
              e('label', { className: 'qxsim-field' }, e('span', { className: 'qxsim-field-label' }, '监听信号名'), e('input', { type: 'text', value: rule.signalName, placeholder: 'EarnGold', 'aria-label': `规则 ${ruleIndex + 1} 监听信号名`, onChange: (event) => updateRule(ruleIndex, { signalName: event.target.value }) })),
              e('button', { className: 'qxsim-iconbtn', title: '删除规则', onClick: () => commit(rules.filter((_, index) => index !== ruleIndex)) }, '✕')),
            e('div', { className: 'qxsim-logic-actions' },
              (rule.actions || []).map((action, actionIndex) => e('div', { key: actionIndex, className: 'qxsim-logic-action' },
                e('div', { className: 'qxsim-logic-action-head' },
                  e('strong', null, `动作 ${actionIndex + 1}`),
                  e('select', { value: action.kind, 'aria-label': `规则 ${ruleIndex + 1} 动作 ${actionIndex + 1} 类型`, onChange: (event) => replaceAction(ruleIndex, actionIndex, event.target.value) },
                    e('option', { value: 'setCustomVariable' }, '设置自定义变量'),
                    e('option', { value: 'sendClientScriptSignal' }, '发送客户端脚本信号')),
                  e('span', null, action.kind === 'sendClientScriptSignal' ? '发给当前玩家、指定玩家或全部玩家' : '写入 Level / 当前玩家 / 玩家1-8'),
                  e('button', { className: 'qxsim-iconbtn', title: '删除动作', disabled: (rule.actions || []).length <= 1, onClick: () => updateRule(ruleIndex, { actions: rule.actions.filter((_, index) => index !== actionIndex) }) }, '✕')),
                action.kind === 'sendClientScriptSignal'
                  ? e('div', { className: 'qxsim-logic-fields' },
                    e('label', { className: 'qxsim-field' }, e('span', { className: 'qxsim-field-label' }, '发送目标'), e('select', { value: normalizeLogicTarget(action.target), onChange: (event) => updateAction(ruleIndex, actionIndex, { target: event.target.value }) }, PLAYER_LOGIC_TARGETS.map((target) => e('option', { key: target, value: target }, PLAYER_LOGIC_LABELS[target])))),
                    e('label', { className: 'qxsim-field' }, e('span', { className: 'qxsim-field-label' }, '客户端信号名'), e('input', { type: 'text', value: action.signalName, placeholder: 'GoldChanged', onChange: (event) => updateAction(ruleIndex, actionIndex, { signalName: event.target.value }) })),
                    e(LogicParamsField, { params: action.params, onChange: (params) => updateAction(ruleIndex, actionIndex, { params }) }))
                  : e('div', { className: 'qxsim-logic-fields' },
                    e('label', { className: 'qxsim-field' }, e('span', { className: 'qxsim-field-label' }, '实体'), e('select', { value: normalizeLogicEntity(action.entityType), onChange: (event) => updateAction(ruleIndex, actionIndex, { entityType: event.target.value }) }, PLAYER_LOGIC_ENTITIES.map((entity) => e('option', { key: entity, value: entity }, PLAYER_LOGIC_LABELS[entity])))),
                    e('label', { className: 'qxsim-field' }, e('span', { className: 'qxsim-field-label' }, '变量名'), e('input', { type: 'text', value: action.name, placeholder: 'Gold', onChange: (event) => updateAction(ruleIndex, actionIndex, { name: event.target.value }) })),
                    e('div', { className: 'wide' }, e(LogicValueField, { label: '变量值', value: action.value, onChange: (value) => updateAction(ruleIndex, actionIndex, { value }) }))))),
              e('div', { className: 'qxsim-logic-actions-foot' },
                e('button', { className: 'qxsim-action', onClick: () => updateRule(ruleIndex, { actions: (rule.actions || []).concat([defaultLogicAction('setCustomVariable')]) }) }, '＋ 设置自定义变量'),
                e('button', { className: 'qxsim-action', onClick: () => updateRule(ruleIndex, { actions: (rule.actions || []).concat([defaultLogicAction('sendClientScriptSignal')]) }) }, '＋ 发送客户端脚本信号'))))) : e('div', { className: 'qxsim-logic-empty' }, '还没有监听规则。试玩时客户端 SendSignal 不会自动改变量或回传信号。'),
          e('div', { className: 'qxsim-logic-actions-foot' }, e('button', { className: 'qxsim-action', onClick: addRule }, '＋ 添加监听规则')),
          e('div', { className: 'qxsim-script-footer', style: { marginTop: 16 } }, e('span', null, draft?.dirty ? '有未保存的修改' : (notice || '保存后会写入当前存档，下次试玩生效')), e('span', { className: 'spacer' }))))
    }
    function ControlScriptTab({ snap, addScriptMounted, mountScriptTo, unmountScript, openScript }) {
      const mountedScripts = (snap.scripts || []).filter((script) => script.controlId === snap.selectedId)
      const otherScripts = (snap.scripts || []).filter((script) => script.controlId !== snap.selectedId)
      return e(React.Fragment, null,
        e(Section, { title: '挂载到该控件的脚本' },
          mountedScripts.length ? mountedScripts.map((script) => e('div', { key: script.id, className: 'qxsim-script-list-row' },
            e('button', { className: 'qxsim-script-asset', onClick: () => openScript(script.id) },
              e('strong', null, script.path || '(未命名脚本)'),
              e('small', null, `脚本 ${script.id}`)),
            e('button', { className: 'qxsim-iconbtn', title: '解除挂载（保留脚本）', onClick: () => unmountScript(script.id) }, '⤫')))
            : e('div', { className: 'qxsim-note' }, '该控件尚未挂载脚本。脚本挂载到客户端控件后才会在试玩时生效。')),
        e(Section, { title: '挂载已有脚本', open: false },
          otherScripts.length ? e('label', { className: 'qxsim-field' },
            e('span', { className: 'qxsim-field-label' }, '选择脚本挂载到该控件'),
            e('select', { value: '', 'aria-label': '选择脚本挂载到该控件', onChange: (event) => { const id = event.target.value; event.target.value = ''; if (id) mountScriptTo(id) } },
              e('option', { value: '' }, '选择脚本…'),
              otherScripts.map((script) => e('option', { key: script.id, value: script.id }, `${script.path || '(未命名脚本)'} · ${script.id}${script.mounted ? `（当前挂载于 ${script.assetLabel} · ${script.controlName}，将移动到此控件）` : '（未挂载）'}`))))
            : e('div', { className: 'qxsim-note' }, '存档内还没有其他脚本，可点击下方按钮新建。'),
          e('div', { className: 'qxsim-script-actions', style: { marginTop: 8 } }, e('button', { onClick: () => addScriptMounted(snap.selectedId) }, '＋ 新建脚本并挂载到此控件'))))
    }
    function parentContainer(root, selectedId) {
      let selected = null; let parent = null
      function walk(node, p) { if (node.id === selectedId) { selected = node; parent = p }; for (const child of node.children || []) walk(child, node) }
      walk(root, null)
      if (selected?.kind === 'container') return selected.id
      if (selected?.kind === 'server-container') return selected.children?.find((child) => child.kind === 'container')?.id || selected.id
      while (parent && parent.kind !== 'container') { let next = null; function find(node) { for (const child of node.children || []) { if (child === parent) next = node; find(child) } }; find(root); parent = next }
      return parent?.id || root.children?.find((child) => child.kind === 'container')?.id
    }
    function childParent(root, selectedId) {
      let selected = null
      function walk(node) { if (node.id === selectedId) selected = node; for (const child of node.children || []) walk(child) }
      walk(root)
      if (selected && selected.kind !== 'server-container') return selected.id
      return parentContainer(root, selectedId)
    }
    function renderControl(item, snap, canvasWidth, canvasHeight) {
      const box = item; const kind = item.kind
      const textKind = kind === 'textbox' || kind === 'textwindow'
      const left = box.renderLeft ?? box.left; const bottom = box.renderBottom ?? box.bottom
      const width = box.renderWidth ?? box.width; const height = box.renderHeight ?? box.height
      const rotationZ = box.renderRotationZ ?? item.rotationZ ?? 0
      const style = { left: `${left / canvasWidth * 100}%`, bottom: `${bottom / canvasHeight * 100}%`, width: `${width / canvasWidth * 100}%`, height: `${height / canvasHeight * 100}%`, '--rotation': `${-Number(rotationZ)}deg`, fontSize: Math.max(8, Math.min(40, Number(item.fontSize || 12))), color: textKind ? argb(item.fontColor, 0xffffffff) : '#fff' }
      if (kind === 'image') Object.assign(style, shape(item.primitive, argb(item.imageColor, 0xffffffff)))
      else if (textKind) { style.background = argb(item.bgColor, 0x00ffffff); style.justifyContent = item.horizontalAlignment === 'Right' ? 'flex-end' : item.horizontalAlignment === 'Middle' ? 'center' : 'flex-start'; style.alignItems = item.verticalAlignment === 'Bottom' ? 'flex-end' : item.verticalAlignment === 'Middle' ? 'center' : 'flex-start'; style.textShadow = item.enableOutline === false ? 'none' : `0 0 2px ${argb(item.outlineColor, 0xff000000)}` }
      else if (kind === 'container') style.background = 'transparent'
      const selected = item.id === snap.selectedId
      const content = textKind ? (item.text || '') : kind === 'image' && item.primitive === 'missing' ? e('span', { className: 'qxsim-box-label' }, `缺少图片 ${item.imageId || ''}`) : kind !== 'container' && kind !== 'image' ? e('span', { className: 'qxsim-box-label' }, item.name || KIND_META[kind]?.[1] || kind) : null
      return e('div', { key: item.id, className: `qxsim-box ${kind}${selected ? ' selected' : ''}${item.instantiated ? ' dynamic' : ''}${item.pressed ? ' pressed' : ''}`, style }, content, selected && kind !== 'container' ? ['tl', 'tr', 'bl', 'br'].map((pos) => e('i', { key: pos, className: `qxsim-handle ${pos}` })) : null)
    }

    function SimulatorView({ sessionId }) {
      const theme = useHostTheme()
      const [snap, setSnap] = React.useState(null); const snapRef = React.useRef(null); const queueRef = React.useRef(Promise.resolve())
      const [error, setError] = React.useState('')
      const [savePath, setSavePath] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [notice, setNotice] = React.useState(''); const fileInputRef = React.useRef(null)
      const [archives, setArchives] = React.useState([])
      const [page, setPage] = React.useState('ui'); const [inspectorTab, setInspectorTab] = React.useState('base')
      const [zoom, setZoom] = React.useState('fit'); const [hiddenCanvasIds, setHiddenCanvasIds] = React.useState({}); const [search, setSearch] = React.useState(''); const [addMode, setAddMode] = React.useState('template')
      const [selectedScriptId, setSelectedScriptId] = React.useState('')
      const [scriptDraft, setScriptDraft] = React.useState(null)
      const [logicDraft, setLogicDraft] = React.useState({ version: 1, rules: [], dirty: false })
      const workspaceRef = React.useRef(null)
      const [viewport, setViewport] = React.useState({ width: 0, height: 0 })
      // 「适应窗口」缩放：观察舞台容器尺寸，画布或比例切换后自动完整可见。
      React.useEffect(() => {
        const el = workspaceRef.current
        if (!el || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver((entries) => {
          const rect = entries[0]?.contentRect
          if (rect && rect.width > 0) setViewport({ width: rect.width, height: rect.height })
        })
        observer.observe(el)
        return () => observer.disconnect()
      }, [snap?.canvas?.id])
      function accept(next, { keepLogicDraft = true } = {}) {
        snapRef.current = next; setSnap(next)
        if (next?.scripts) {
          setSelectedScriptId((prev) => next.scripts.some((row) => row.id === prev) ? prev : (next.scripts[0]?.id || ''))
        }
        setLogicDraft((prev) => (keepLogicDraft && prev?.dirty ? prev : cloneServerLogic(next?.serverLogic)))
        return next
      }
      const reload = React.useCallback(async () => { try { setError(''); accept(await callApi(sessionId, 'get'), { keepLogicDraft: false }) } catch (reason) { setError(reason?.message || String(reason)) } }, [sessionId])
      const refreshArchives = React.useCallback(async () => {
        try {
          const listed = await callApi(sessionId, 'archives')
          setArchives(listed?.archives || [])
        } catch {
          setArchives([])
        }
      }, [sessionId])
      React.useEffect(() => { reload(); void refreshArchives() }, [reload, refreshArchives])
      function patch(op) {
        const run = async () => { const current = snapRef.current; if (!current) throw new Error('editor is not ready'); try { const next = await callApi(sessionId, 'patch', { op: { ...op, expectedRevision: current.version } }); setError(''); return accept(next) } catch (reason) { setError(reason?.message || String(reason)); if (/revision conflict/.test(String(reason?.message || reason))) await reload(); throw reason } }
        queueRef.current = queueRef.current.then(run, run); return queueRef.current
      }
      const commit = (key, value) => void patch({ op: 'set', key, value }).catch(() => {})
      async function createStateChild(key, label) {
        const buttonId = snapRef.current?.inspector?.id
        if (!buttonId) return
        try {
          const added = await patch({ op: 'add', kind: 'image', parentId: buttonId, name: `${label}图片` })
          await patch({ op: 'set', id: buttonId, key, value: added.selectedId })
          setNotice(`${label}已创建并绑定；可在控件树中继续编辑图片。`)
        } catch {}
      }
      React.useEffect(() => {
        const entry = snap?.scripts?.find((row) => row.id === selectedScriptId)
        setScriptDraft((prev) => {
          if (prev && entry && prev.id === entry.id && prev.dirty) return prev
          if (!entry) return null
          return { id: entry.id, path: entry.path, source: entry.source, controlId: entry.controlId, controlAsset: entry.controlAsset, dirty: false }
        })
      }, [snap, selectedScriptId])
      function updateDraft(fields) {
        setScriptDraft((prev) => (prev ? { ...prev, ...fields, dirty: true } : prev))
      }
      async function saveScriptDraft() {
        const draft = scriptDraft
        if (!draft || !draft.dirty) return
        await patch({ op: 'updateScript', id: draft.id, path: draft.path, source: draft.source, controlId: draft.controlId, controlAsset: draft.controlAsset })
        setScriptDraft((prev) => (prev && prev.id === draft.id ? { ...prev, dirty: false } : prev))
      }
      function saveScriptDraftSilently() {
        void saveScriptDraft().then(() => setNotice('Lua 脚本已保存到当前存档')).catch(() => {})
      }
      async function saveLogicDraft({ silent = false } = {}) {
        const draft = logicDraft
        if (!draft || !draft.dirty) return
        const issues = logicDraftIssues(draft)
        if (issues.length) {
          const message = issues[0]
          if (!silent) setError(message)
          throw new Error(message)
        }
        const next = await patch({ op: 'setServerLogic', logic: sanitizeLogic(draft) })
        setLogicDraft(cloneServerLogic(next.serverLogic))
        setNotice('服务端逻辑已保存到当前存档')
      }
      function saveLogicDraftSilently() {
        void saveLogicDraft({ silent: true }).catch(() => {})
      }
      function leavePage(nextPage) {
        saveScriptDraftSilently()
        saveLogicDraftSilently()
        setPage(nextPage)
      }
      async function addScript(fields = {}) {
        const next = await patch({ op: 'addScript', ...fields })
        const created = next.scripts?.[next.scripts.length - 1]
        if (created) setSelectedScriptId(created.id)
        setNotice(fields.controlId ? '已新建脚本并挂载到该控件' : '已新建脚本，可编辑路径、源码和挂载目标')
        return created
      }
      function removeScript(id) {
        if (scriptDraft?.id === id) setScriptDraft(null)
        void patch({ op: 'removeScript', id }).then(() => setNotice('脚本已删除')).catch(() => {})
      }
      function unmountScript(id) {
        void patch({ op: 'updateScript', id, controlId: '' }).then(() => setNotice('已解除挂载，脚本仍保留在存档中')).catch(() => {})
      }
      function mountScriptTo(id) {
        const controlId = snapRef.current?.selectedId || ''
        const controlAsset = snapRef.current?.asset?.type || ''
        if (!controlId) return
        setScriptDraft((prev) => (prev && prev.id === id ? { ...prev, controlId, controlAsset } : prev))
        void patch({ op: 'updateScript', id, controlId, controlAsset })
          .then(() => setNotice('已挂载到当前控件'))
          .catch(() => {})
      }
      async function selectAsset(assetType) {
        if (snapRef.current?.asset?.type === assetType) return
        try {
          const next = await patch({ op: 'selectAsset', assetType })
          setSearch(''); setAddMode(assetType === 'client-control-template' ? 'template' : 'child')
          setNotice(`已切换到存档内的${next.asset.label}`)
        } catch {}
      }
      function addControl(kind, label) {
        const current = snapRef.current
        if (!current) return
        const isTemplate = current.asset?.type === 'client-control-template' && addMode === 'template'
        const op = isTemplate
          ? { op: 'addTemplate', kind, name: `${label}模板` }
          : { op: 'add', kind, parentId: childParent(current.root, current.selectedId), name: label }
        void patch(op).then(() => setNotice(isTemplate ? `已新增${label}模板` : `已添加${label}子控件`)).catch(() => {})
      }
      async function exportFile(format, arg = '') {
        try {
          await queueRef.current.catch(() => {})
          const result = await callApi(sessionId, 'export', { format, assetType: arg })
          if (Array.isArray(result?.files) && result.files.length) {
            for (const file of result.files) downloadBase64(file)
            setError('')
            setNotice(`已导出 ${result.files.length} 个 GIA 文件（${result.files.map((file) => file.filename).join('、')}）；若浏览器拦截多文件下载，请允许后重试。`)
            return
          }
          downloadBase64(result)
          setError(''); setNotice(result.warnings?.length ? `已导出 ${result.filename}；部分内容暂不支持 GIA。` : `已导出 ${result.filename}`)
        } catch (reason) { setError(reason?.message || String(reason)) }
      }
      async function loadWorkspaceArchive(path) {
        if (!path) return
        try {
          await queueRef.current.catch(() => {})
          const result = await callApi(sessionId, 'load-archive', { path })
          accept(result.snapshot, { keepLogicDraft: false }); setError('')
          setNotice(`已从工作区拉取 ${path}`)
        } catch (reason) { setError(reason?.message || String(reason)) }
      }
      async function importFile(file) {
        if (!file) return
        const format = file.name.toLowerCase().endsWith('.gia') ? 'gia' : file.name.toLowerCase().endsWith('.json') ? 'json' : file.name.toLowerCase().endsWith('.lua') ? 'lua' : ''
        if (!format) { setError('仅支持 .json、.gia 或 .lua 文件'); return }
        try {
          await queueRef.current.catch(() => {})
          const result = await callApi(sessionId, 'import', { format, filename: file.name, data: await fileBase64(file) })
          accept(result.snapshot, { keepLogicDraft: false }); setError('')
          setNotice(result.warnings?.length ? `已导入 ${file.name}；部分内容暂不支持编辑。` : `已导入 ${file.name}`)
        } catch (reason) { setError(reason?.message || String(reason)) }
        finally { if (fileInputRef.current) fileInputRef.current.value = '' }
      }
      async function startPlay() {
        const playTab = window.open('about:blank', '_blank')
        if (!playTab) { setError('浏览器阻止了试玩标签页，请允许此站点打开新标签页后重试。'); return }
        playTab.document.write('<!doctype html><meta charset="utf-8"><title>正在准备试玩…</title><style>html{color-scheme:light dark;font:14px system-ui}body{min-height:100vh;margin:0;display:grid;place-items:center;background:Canvas;color:CanvasText}</style><p>正在保存项目并准备试玩…</p>')
        try {
          await saveScriptDraft()
          await saveLogicDraft()
          playTab.location.replace(playUrl(sessionId))
        } catch (reason) {
          playTab.close()
          setError(reason?.message || String(reason))
        }
      }
      async function saveWorkspace() {
        if (saving || !savePath?.trim()) return
        setSaving(true)
        try {
          await saveScriptDraft()
          await saveLogicDraft()
          await queueRef.current.catch(() => {})
          const current = snapRef.current
          const result = await callApi(sessionId, 'save', { path: savePath.trim(), expectedRevision: current.version })
          accept(await callApi(sessionId, 'get'))
          setNotice(`已保存到 ${result.path}`)
          setError('')
          setSavePath(null)
          void refreshArchives()
        } catch (reason) { setError(reason?.message || String(reason)) }
        finally { setSaving(false) }
      }
      React.useEffect(() => {
        if (snap?.inspector?.kind === 'server-container') setInspectorTab('base')
      }, [snap?.inspector?.kind])
      if (!snap) return e('div', { className: 'qxsim', 'data-theme': theme, 'data-qxsim-session-id': sessionId }, e('div', { className: 'qxsim-status error' }, error || '正在载入千星沙箱…'))
      const canvasWidth = snap.canvas.width; const canvasHeight = snap.canvas.height
      const fitRaw = viewport.width > 0 && viewport.height > 0
        ? Math.min((viewport.width - 44) / canvasWidth, (viewport.height - 54) / canvasHeight)
        : NaN
      const fitScale = Number.isFinite(fitRaw) && fitRaw > 0 ? Math.min(2, Math.round(fitRaw * 1000) / 1000) : 0.5
      const effectiveZoom = zoom === 'fit' ? fitScale : (Number(zoom) || 0.5)
      const activeRatio = ratioText(canvasWidth, canvasHeight)
      const devicePresets = (snap.canvas.presets || []).filter((preset) => preset.platform === snap.canvas.platform)
      function switchDevice(groupKey) {
        if (!snap || snap.canvas.platform === groupKey) return
        const candidates = (snap.canvas.presets || []).filter((preset) => preset.platform === groupKey)
        if (!candidates.length) return
        // 换设备时保持当前屏幕比例，没有同比例预设才落到该设备第一个画布。
        const target = candidates.find((preset) => presetRatio(preset) === activeRatio) || candidates[0]
        void patch({ op: 'setCanvas', canvasId: target.id }).then(() => setNotice(`已切换到${target.label}`)).catch(() => {})
      }
      const clientTemplates = snap.asset?.type === 'client-control-template'
      const canInspectorScript = Boolean(snap.inspector && snap.inspector.kind !== 'server-container')
      const canvasHiddenIds = new Set()
      for (const row of snap.tree || []) {
        if (hiddenCanvasIds[row.id] || (row.ancestorIds || []).some((id) => hiddenCanvasIds[id])) canvasHiddenIds.add(row.id)
      }
      const renderBoxes = (snap.boxes || []).filter((box) => box.kind !== 'server-container' && box.visible && !canvasHiddenIds.has(box.id))
      function toggleCanvasVisible(event, id) {
        event.stopPropagation()
        setHiddenCanvasIds((prev) => {
          const next = { ...prev }
          if (next[id]) delete next[id]
          else next[id] = true
          return next
        })
      }
      const filteredRows = snap.tree.filter((row) => !search.trim() || `${row.name} ${row.label}`.toLowerCase().includes(search.trim().toLowerCase()))
      const selectedRow = snap.tree.find((row) => row.id === snap.selectedId)
      const parentCandidates = clientTemplates && selectedRow
        ? snap.tree.filter((row) => row.id !== selectedRow.id && !(row.ancestorIds || []).includes(selectedRow.id))
        : []
      const selectedParentId = selectedRow?.parentId || snap.root.id
      return e('div', { className: 'qxsim', 'data-theme': theme, 'data-qxsim-session-id': sessionId },
        savePath !== null ? e('div', { className: 'qxsim-save-overlay' },
          e('form', { className: 'qxsim-save-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': '保存到工作区', onSubmit: event => { event.preventDefault(); void saveWorkspace() } },
            e('h2', null, '保存到工作区'),
            e('label', null, '存档相对路径', e('input', { autoFocus: true, required: true, value: savePath, disabled: saving, onChange: event => setSavePath(event.target.value) })),
            error ? e('div', { role: 'alert' }, error) : null,
            e('footer', null, e('button', { className: 'qxsim-action', type: 'button', disabled: saving, onClick: () => setSavePath(null) }, '取消'), e('button', { className: 'qxsim-action primary', type: 'submit', disabled: saving || !savePath.trim() }, saving ? '保存中…' : '保存')))) : null,
        e('header', { className: 'qxsim-toolbar' },
          e('div', { className: 'qxsim-brand', title: `${snap.workspace?.bound ? snap.workspace.path : '工作区未绑定'}\n${snap.meta?.sourceFile || '尚未导入文件'}` }, e('span', { className: 'qxsim-appicon' }, 'UI'), e('span', { className: 'qxsim-brand-text' }, e('strong', null, `存档：${snap.save?.name || snap.meta?.name || '未命名存档'}`), e('span', null, `工作区：${snap.workspace?.bound ? snap.workspace.name : '未绑定'} · 当前资产：${snap.asset?.label || 'UI控件'}`))),
          e('div', { className: 'qxsim-toolbar-center' }, page === 'ui' ? e(React.Fragment, null,
            e('div', { className: 'qxsim-device-switch', role: 'group', 'aria-label': '目标设备' },
              DEVICE_GROUPS.map((group) => e('button', { key: group.key, className: snap.canvas.platform === group.key ? 'active' : '', title: group.title, onClick: () => switchDevice(group.key) }, group.label))),
            e('select', { className: 'qxsim-control ratio', 'aria-label': '屏幕比例', value: snap.canvasId, onChange: (event) => void patch({ op: 'setCanvas', canvasId: event.target.value }).catch(() => {}) },
              devicePresets.map((preset) => e('option', { key: preset.id, value: preset.id }, `${presetRatio(preset)} · ${preset.width}×${preset.height}`))),
            e('select', { className: 'qxsim-control zoom', 'aria-label': '画布缩放', value: zoom, onChange: (event) => setZoom(event.target.value) }, [['fit', '适应'], ['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%']].map(([value, label]) => e('option', { key: value, value }, label)))) : e('span', { className: 'qxsim-muted' }, page === 'logic' ? '服务端逻辑：监听信号 / 自定义变量 / 玩家1-8 回传' : 'Lua 脚本资产编辑')),
          e('div', { className: 'qxsim-actions' },
            saveToWorkspace ? e('button', { className: 'qxsim-action', title: '保存完整存档到工作区', onClick: () => { setError(''); setSavePath(snapRef.current?.storage?.path || 'qxqy-simulator.save.json') } }, '保存存档') : null,
            e('div', { className: 'qxsim-io' },
              e('input', { ref: fileInputRef, hidden: true, type: 'file', accept: '.json,.gia,.lua,application/json,application/octet-stream,text/plain', onChange: (event) => void importFile(event.target.files?.[0]) }),
              e('select', { className: 'qxsim-control zoom', 'aria-label': '从工作区拉取存档', defaultValue: '', onFocus: () => void refreshArchives(), onChange: (event) => { const path = event.target.value; event.target.value = ''; if (path) void loadWorkspaceArchive(path) } }, e('option', { value: '', disabled: true }, snap.workspace?.bound ? '⤓ 工作区存档' : '工作区未绑定'), ...(archives.length ? archives.map((row) => e('option', { key: row.path, value: row.path }, `${row.name} · ${row.path}`)) : [e('option', { value: '', disabled: true }, snap.workspace?.bound ? '未发现 qxqy-simulator-save' : '先绑定会话工作区')])),
              e('button', { className: 'qxsim-action', title: '导入存档、单项 UI 资产或 Lua', onClick: () => fileInputRef.current?.click() }, '⇧ 导入'),
              e('select', { className: 'qxsim-control zoom', 'aria-label': '导出格式', defaultValue: '', onChange: (event) => { const [format, arg = ''] = event.target.value.split('|'); event.target.value = ''; if (format) void exportFile(format, arg) } }, e('option', { value: '', disabled: true }, '⇩ 导出'), e('option', { value: 'save' }, '资产包 JSON（三类合一）'), e('option', { value: 'save-gia' }, '资产包 GIA（已改动项）'), e('option', { value: 'gia-combined' }, '资产包 GIA 整合包（控件+脚本）'), e('optgroup', { label: '当前界面（左栏正在看的那棵树）' }, e('option', { value: 'json' }, '当前界面 Authoring JSON'), e('option', { value: 'gia' }, '当前界面 GIA')), e('optgroup', { label: '服务器控件模板' }, e('option', { value: 'json|server-control-template' }, 'Authoring JSON'), e('option', { value: 'gia|server-control-template' }, 'GIA')), e('optgroup', { label: '客户端控件模板（仅当左栏切到「UI控件-客户端」时才是页面内容）' }, e('option', { value: 'json|client-control-template' }, 'Authoring JSON'), e('option', { value: 'gia|client-control-template' }, 'GIA')), e('optgroup', { label: 'Lua 脚本' }, e('option', { value: 'scripts' }, '脚本包 JSON（全部脚本）'), e('option', { value: 'scripts-gia' }, '脚本包 GIA（全部脚本）')))),
            e('button', { className: 'qxsim-action primary', title: '在独立标签页中试玩', onClick: startPlay }, '▷ 试玩 ↗'),
            e('button', { className: 'qxsim-iconbtn', title: '重新载入', onClick: reload }, '↻'))),
        e('nav', { className: 'qxsim-editor-nav', 'aria-label': '编辑页面' }, e('button', { className: page === 'ui' ? 'active' : '', onClick: () => leavePage('ui') }, 'UI 编辑'), e('button', { className: page === 'script' ? 'active' : '', onClick: () => leavePage('script') }, 'Lua 脚本'), e('button', { className: page === 'logic' ? 'active' : '', onClick: () => leavePage('logic') }, '服务端逻辑'), e('span', { className: 'save-summary' }, '一个存档 · 服务器控件模板 + 客户端控件模板 + Lua 脚本 + 服务端逻辑')),
        page === 'ui' ? e('div', { className: 'qxsim-main' },
          e('aside', { className: 'qxsim-tree' },
            e('div', { className: 'qxsim-asset-switch', 'aria-label': '编辑资源类型' },
              e('button', { className: clientTemplates ? '' : 'active', title: '编辑存档内的服务端 UI 控件', onClick: () => void selectAsset('server-control-template') }, 'UI控件-服务端'),
              e('button', { className: clientTemplates ? 'active' : '', title: '编辑存档内的客户端控件模板', onClick: () => void selectAsset('client-control-template') }, 'UI控件-客户端')),
            e('div', { className: 'qxsim-pane-head' }, e('div', { className: 'qxsim-pane-title' }, clientTemplates ? '模板与子控件' : '控件树'), e('span', { className: 'qxsim-muted' }, clientTemplates ? `${snap.asset.templateCount} 个模板 · ${snap.tree.length} 个控件` : `${snap.tree.length} 个节点`)),
            e('label', { className: 'qxsim-search' }, '⌕', e('input', { value: search, placeholder: clientTemplates ? '搜索模板或控件' : '搜索控件', onChange: (event) => setSearch(event.target.value) }), search ? e('button', { onClick: () => setSearch('') }, '×') : e('span', null, '⌁')),
            e('div', { className: 'qxsim-tree-scroll' }, filteredRows.length ? filteredRows.map((row) => {
              const meta = KIND_META[row.kind] || ['◇', row.label]
              const canvasHidden = canvasHiddenIds.has(row.id)
              const selfHidden = Boolean(hiddenCanvasIds[row.id])
              return e('div', { key: row.id, className: `qxsim-row${clientTemplates && row.depth === 0 ? ' template-root' : ''}${row.id === snap.selectedId ? ' active' : ''}${canvasHidden ? ' canvas-hidden' : ''}`, style: { paddingLeft: 8 + row.depth * 18, '--depth': row.depth }, title: `${meta[1]} · ${row.name} · GUID ${row.guid ?? row.id}`, onClick: () => void patch({ op: 'select', id: row.id }).catch(() => {}) }, e('span', { className: 'qxsim-chevron' }, row.childCount ? '▼' : ''), e('span', { className: 'qxsim-kind' }, meta[0]), e('span', { className: 'qxsim-row-label' }, row.name), e('span', { className: 'qxsim-row-end' }, clientTemplates && row.depth === 0 ? e(React.Fragment, null, e('span', { className: 'qxsim-template-tag' }, '模板'), e('span', { className: 'qxsim-template-id' }, `#${row.guid ?? row.id}`)) : row.incomplete ? e('span', { className: 'qxsim-incomplete' }, '暂不支持') : null, e('button', { className: `qxsim-eye${selfHidden ? ' off' : ''}`, type: 'button', title: selfHidden ? '在画布上显示（不影响控件初始可见性）' : '在画布上隐藏（不影响控件初始可见性）', 'aria-label': `${row.name}画布可见性`, 'aria-pressed': !selfHidden, onClick: (event) => toggleCanvasVisible(event, row.id) }, selfHidden ? '◌' : '◉')))
            }) : e('div', { className: 'qxsim-empty' }, '没有匹配的控件')),
            e('div', { className: 'qxsim-tree-foot' },
              clientTemplates && selectedRow ? e('div', { className: 'qxsim-hierarchy' }, e('div', { className: 'qxsim-hierarchy-head' }, e('strong', null, '层级与模板边界'), e('span', null, selectedRow.name)), e('div', { className: 'qxsim-parent-row' }, e('select', { 'aria-label': '父级控件', value: selectedParentId, onChange: (event) => void patch({ op: 'reparent', id: selectedRow.id, parentId: event.target.value }).then(() => setNotice(event.target.value === snap.root.id ? '已提升为可实例化顶层模板' : '已调整控件父级')).catch(() => {}) }, e('option', { value: snap.root.id }, '顶层模板（可实例化）'), parentCandidates.map((row) => e('option', { key: row.id, value: row.id }, `${'　'.repeat(row.depth)}${row.name}`))), e('button', { title: '在同级中上移', disabled: selectedRow.siblingIndex <= 0, onClick: () => void patch({ op: 'moveSibling', id: selectedRow.id, direction: 'up' }).catch(() => {}) }, '↑'), e('button', { title: '在同级中下移', disabled: selectedRow.siblingIndex >= selectedRow.siblingCount - 1, onClick: () => void patch({ op: 'moveSibling', id: selectedRow.id, direction: 'down' }).catch(() => {}) }, '↓')), e('div', { className: 'qxsim-hierarchy-note' }, selectedRow.depth === 0 ? '该节点会写入独立 UIControlTemplate，可直接作为 prefabId。' : `当前为第 ${selectedRow.depth} 层子控件，不会单独成为 prefabId。`)) : null,
              e('div', { className: 'qxsim-palette-head' }, e('span', { title: clientTemplates && addMode === 'template' ? '新增独立可实例化模板' : `添加到${selectedRow ? selectedRow.name : '当前控件'}` }, clientTemplates && addMode === 'template' ? '新增顶层模板' : `添加到${selectedRow ? `“${selectedRow.name}”` : '当前控件'}`), clientTemplates ? e('span', { className: 'qxsim-add-mode' }, e('button', { className: addMode === 'template' ? 'active' : '', onClick: () => setAddMode('template') }, '顶层'), e('button', { className: addMode === 'child' ? 'active' : '', onClick: () => setAddMode('child') }, '子控件')) : null),
              e('div', { className: 'qxsim-add' }, CONTROL_TYPES.filter(([kind]) => clientTemplates || kind !== 'container').map(([kind, label]) => e('button', { key: kind, title: `${clientTemplates && addMode === 'template' ? '新增' : '添加'}${label}`, onClick: () => addControl(kind, label) }, `＋ ${label}`))))),
          e('main', { className: 'qxsim-center' }, e('div', { className: 'qxsim-workspace', ref: workspaceRef }, e('div', { className: 'qxsim-stage-shell', style: { width: `${Math.max(40, Math.round(canvasWidth * effectiveZoom))}px` } }, e('div', { className: 'qxsim-stage-label' }, e('b', null, clientTemplates ? 'Lua 模板预览' : '界面控件组'), e('span', { className: 'qxsim-platform-tag' }, snap.canvas.platform), e('span', null, `${activeRatio} · ${canvasWidth}×${canvasHeight} · 左下原点`)), e('div', { className: 'qxsim-stage', style: { width: '100%', aspectRatio: `${canvasWidth} / ${canvasHeight}` }, onClick: (event) => { const rect = event.currentTarget.getBoundingClientRect(); void patch({ op: 'pick', x: (event.clientX - rect.left) * canvasWidth / rect.width, y: (rect.bottom - event.clientY) * canvasHeight / rect.height }).catch(() => {}) } }, renderBoxes.map((item) => renderControl(item, snap, canvasWidth, canvasHeight))))), error ? e('div', { className: 'qxsim-status error' }, '⚠ ', error) : e('div', { className: 'qxsim-status' }, e('span', null, `● ${snap.asset?.label || '控件'}编辑`), e('span', null, notice || (selectedRow ? `当前：${selectedRow.name}` : '')), e('span', { className: 'spacer' }), e('span', null, clientTemplates ? 'GIA 导出后可在 Lua 中按 prefabId 实例化' : '字段在失焦或 Enter 时提交'))),
          e('aside', { className: 'qxsim-inspector' }, snap.inspector ? e(React.Fragment, null,
            e('div', { className: 'qxsim-inspector-head' }, e('div', { className: 'qxsim-inspector-line' }, e('span', { className: 'qxsim-kind' }, (KIND_META[snap.inspector.kind] || ['◇'])[0]), e('strong', null, snap.inspector.label), clientTemplates && selectedRow?.depth === 0 ? e('span', { className: 'qxsim-template-tag' }, '可实例化') : null), e('div', { className: 'qxsim-node-id' }, clientTemplates && selectedRow?.depth === 0 ? '导出 prefabId ' : '控件 GUID ', e('code', null, snap.inspector.guid ?? snap.inspector.id), ' · ', selectedRow?.name || '节点', clientTemplates && selectedRow?.depth === 0 ? e('small', null, '（真实编辑器导入后可能重映射）') : null)),
            e('div', { className: 'qxsim-tabs', style: canInspectorScript ? undefined : { gridTemplateColumns: '1fr' } },
              e('button', { className: inspectorTab === 'base' ? 'active' : '', onClick: () => setInspectorTab('base') }, '基础属性'),
              canInspectorScript ? e('button', { className: inspectorTab === 'script' ? 'active' : '', onClick: () => setInspectorTab('script') }, '脚本') : null),
            e('div', { className: 'qxsim-inspector-scroll' }, canInspectorScript && inspectorTab === 'script'
              ? e(ControlScriptTab, { snap, addScriptMounted: (controlId) => void addScript({ controlId, controlAsset: snap.asset?.type }).then(() => leavePage('script')), mountScriptTo, unmountScript, openScript: (id) => { setSelectedScriptId(id); leavePage('script') } })
              : e(BaseInspector, { inspector: snap.inspector, commit, createStateChild })),
            e('div', { className: 'qxsim-tree-foot' }, e('button', { className: 'qxsim-action danger', style: { width: '100%' }, onClick: () => void patch({ op: 'remove' }).catch(() => {}) }, clientTemplates && selectedRow?.depth === 0 ? '⌫ 删除当前模板' : '⌫ 删除当前控件')))
          : e('div', { className: 'qxsim-empty' }, '请选择一个控件'))) : page === 'script' ? e(ScriptPage, { snap, selectedScriptId, selectScript: (id) => { saveScriptDraftSilently(); setSelectedScriptId(id) }, draft: scriptDraft, updateDraft, saveScript: () => void saveScriptDraft().then(() => setNotice('Lua 脚本已保存到当前存档')).catch(() => {}), addScript: () => void addScript(), removeScript, exportLua: (id) => void exportFile('lua', id), exportScripts: () => void exportFile('scripts'), exportScriptsGia: () => void exportFile('scripts-gia'), notice }) : e(ServerLogicPage, { snap, draft: logicDraft, setDraft: setLogicDraft, saveLogic: () => void saveLogicDraft().catch(() => {}), notice, error }))
    }


  return { SimulatorView, ensureStyle, removeStyle: () => document.getElementById(STYLE_ID)?.remove() }
}
