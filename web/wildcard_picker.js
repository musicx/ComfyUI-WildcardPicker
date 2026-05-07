/**
 * ComfyUI-WildcardPicker — frontend extension.
 *
 * Adds a "📂 Browse wildcards" button to every WildcardPicker node. The
 * button opens a modal that lets the user browse the wildcards library
 * tree, preview leaf contents, and (M4+) insert references / literals
 * into the node's text widget.
 *
 * Backend contract: see ../docs/api.md.
 *
 * v0.3 layout in M3: tree + preview + search + refresh. No insertion yet
 * (M4). The "Insert" button at bottom is a placeholder stub.
 */
import { app } from "../../scripts/app.js";

// =========================================================================
// Module state (single modal across all node instances)
// =========================================================================
let _tree = null;           // cached tree JSON from /tree
let _modal = null;          // <dialog> element, lazily built
let _ctx = null;            // { node, textWidget } for the currently open invocation
let _selected = null;       // currently previewed leaf payload
let _stylesInjected = false;

// =========================================================================
// Extension registration
// =========================================================================
app.registerExtension({
    name: "Comfy.WildcardPicker",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "WildcardPicker") return;
        ensureStyles();
        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnNodeCreated?.apply(this, arguments);
            const textWidget = this.widgets?.find(w => w.name === "text");
            if (!textWidget) return;
            this.addWidget("button", "📂 Browse wildcards", null, () => {
                openBrowser(this, textWidget);
            });
        };
    },
});

// =========================================================================
// Styles
// =========================================================================
function ensureStyles() {
    if (_stylesInjected) return;
    const css = `
.wp-modal {
    width: min(1100px, 95vw);
    height: min(80vh, 800px);
    padding: 0;
    border: 1px solid #444;
    border-radius: 6px;
    background: #1e1e1e;
    color: #ddd;
    font-family: system-ui, sans-serif;
    font-size: 13px;
}
.wp-modal::backdrop {
    background: rgba(0, 0, 0, 0.5);
}
.wp-modal[open] {
    display: flex;
    flex-direction: column;
}
.wp-header {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid #333;
    background: #252525;
}
.wp-header input[type="search"] {
    flex: 1;
    background: #1a1a1a;
    color: #ddd;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 13px;
}
.wp-header input[type="search"]:focus {
    outline: none;
    border-color: #4a90d9;
}
.wp-icon-btn {
    background: #333;
    color: #ddd;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 14px;
}
.wp-icon-btn:hover { background: #444; }
.wp-icon-btn:active { background: #555; }
.wp-body {
    flex: 1;
    display: flex;
    min-height: 0;
}
.wp-tree {
    width: 360px;
    overflow-y: auto;
    padding: 8px 6px;
    border-right: 1px solid #333;
    background: #1e1e1e;
}
.wp-preview {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    min-height: 0;
}
.wp-preview-empty {
    color: #777;
    text-align: center;
    margin-top: 60px;
    font-style: italic;
}
.wp-preview-header {
    font-family: ui-monospace, Consolas, monospace;
    background: #252525;
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 10px;
    font-size: 12px;
    color: #4a90d9;
    word-break: break-all;
}
.wp-preview-meta {
    color: #888;
    font-size: 11px;
    margin-bottom: 8px;
}
.wp-preview-list {
    flex: 1;
    overflow-y: auto;
    border: 1px solid #333;
    border-radius: 4px;
    background: #181818;
}
.wp-preview-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 10px;
    border-bottom: 1px solid #2a2a2a;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
}
.wp-preview-row .wp-row-text {
    white-space: pre-wrap;
    word-break: break-word;
    flex: 1;
    user-select: text;
}
.wp-preview-row .wp-row-cb {
    margin-top: 2px;
    cursor: pointer;
    flex-shrink: 0;
}
.wp-preview-row.wp-row-selected {
    background: #1f3550;
}
.wp-preview-row.wp-row-selected:hover {
    background: #234063;
}
.wp-preview-row:last-child { border-bottom: none; }
.wp-preview-row:hover { background: #232323; }
.wp-preview-raw {
    flex: 1;
    overflow: auto;
    border: 1px solid #333;
    border-radius: 4px;
    background: #181818;
    padding: 10px;
    font-family: ui-monospace, Consolas, monospace;
    font-size: 12px;
    white-space: pre;
    color: #ccc;
}
.wp-tree details {
    margin-left: 0;
}
.wp-tree details > summary {
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    list-style: none;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.wp-tree details > summary::-webkit-details-marker { display: none; }
.wp-tree details > summary::before {
    content: "▶";
    display: inline-block;
    width: 12px;
    color: #888;
    font-size: 9px;
    transition: transform 0.1s;
}
.wp-tree details[open] > summary::before {
    transform: rotate(90deg);
}
.wp-tree details > summary:hover { background: #2a2a2a; }
.wp-tree details > div.wp-children {
    margin-left: 14px;
    border-left: 1px dashed #333;
    padding-left: 6px;
}
.wp-tree .wp-leaf {
    cursor: pointer;
    padding: 2px 4px 2px 18px;
    border-radius: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.wp-tree .wp-leaf:hover { background: #2a2a2a; }
.wp-tree .wp-leaf.wp-active {
    background: #2a4a6e;
    color: #fff;
}
.wp-tree .wp-leaf.wp-active:hover { background: #2f547c; }
.wp-tree .wp-icon { display: inline-block; width: 18px; }
.wp-tree .wp-count { color: #777; font-size: 11px; margin-left: 4px; }
.wp-tree .wp-hide { display: none; }
.wp-footer {
    padding: 10px 12px;
    border-top: 1px solid #333;
    background: #252525;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
}
.wp-btn {
    background: #4a90d9;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 7px 16px;
    cursor: pointer;
    font-size: 13px;
}
.wp-btn:hover { background: #5aa1ea; }
.wp-btn.wp-btn-secondary {
    background: #444;
}
.wp-btn.wp-btn-secondary:hover { background: #555; }
.wp-btn:disabled {
    background: #333;
    color: #666;
    cursor: not-allowed;
}
.wp-insertion {
    margin-top: 12px;
    padding: 10px 12px;
    background: #232323;
    border: 1px solid #333;
    border-radius: 4px;
    flex-shrink: 0;
}
.wp-insertion-row {
    margin-bottom: 6px;
    font-size: 12px;
    color: #ccc;
}
.wp-insertion-row:last-child { margin-bottom: 0; }
.wp-insertion-row label {
    display: inline-flex;
    align-items: center;
    margin-right: 14px;
    cursor: pointer;
}
.wp-insertion-row label input {
    margin-right: 4px;
    cursor: pointer;
}
.wp-insertion-row label:has(input:disabled) {
    opacity: 0.35;
    cursor: not-allowed;
}
.wp-insertion-row label:has(input:disabled) input {
    cursor: not-allowed;
}
.wp-live-preview-label {
    color: #888;
    font-size: 11px;
    margin: 8px 0 4px;
}
.wp-live-preview {
    padding: 8px 10px;
    background: #181818;
    border: 1px dashed #444;
    border-radius: 3px;
    font-family: ui-monospace, Consolas, monospace;
    font-size: 12px;
    min-height: 24px;
    max-height: 120px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: #a8d4f0;
}
.wp-live-preview.wp-live-invalid {
    color: #b87a7a;
    font-style: italic;
}
.wp-toast {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: #b14040;
    color: #fff;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 13px;
    z-index: 99999;
    animation: wp-fade 3s ease forwards;
}
@keyframes wp-fade {
    0%, 80% { opacity: 1; }
    100% { opacity: 0; }
}
`;
    const style = document.createElement("style");
    style.textContent = css;
    style.id = "wp-styles";
    document.head.appendChild(style);
    _stylesInjected = true;
}

// =========================================================================
// Modal lifecycle
// =========================================================================
function ensureModal() {
    if (_modal) return;
    _modal = document.createElement("dialog");
    _modal.className = "wp-modal";
    _modal.innerHTML = `
        <div class="wp-header">
            <input type="search" class="wp-search" placeholder="Search by name or path..." />
            <button class="wp-icon-btn wp-refresh" title="Reload tree from disk">↻</button>
            <button class="wp-icon-btn wp-close" title="Close">×</button>
        </div>
        <div class="wp-body">
            <div class="wp-tree"></div>
            <div class="wp-preview">
                <div class="wp-preview-empty">Click a leaf in the tree to preview its contents.</div>
            </div>
        </div>
        <div class="wp-footer">
            <button class="wp-btn wp-btn-secondary wp-cancel">Cancel</button>
            <button class="wp-btn wp-btn-secondary wp-replace" disabled title="Replace current selection in textarea">Replace selection</button>
            <button class="wp-btn wp-append" disabled title="Append to the end of the textarea">Append ↩</button>
        </div>
    `;
    document.body.appendChild(_modal);

    // Wire static handlers
    _modal.querySelector(".wp-close").addEventListener("click", closeModal);
    _modal.querySelector(".wp-cancel").addEventListener("click", closeModal);
    _modal.querySelector(".wp-refresh").addEventListener("click", onRefresh);
    _modal.querySelector(".wp-search").addEventListener("input", onSearchInput);
    _modal.querySelector(".wp-append").addEventListener("click", onAppend);
    _modal.querySelector(".wp-replace").addEventListener("click", onReplaceSelection);

    // Esc and click-outside close
    _modal.addEventListener("cancel", (e) => { /* default Esc handler is fine */ });
    _modal.addEventListener("click", (e) => {
        if (e.target === _modal) closeModal();  // backdrop click
    });
}

async function openBrowser(node, textWidget) {
    ensureModal();
    _ctx = { node, textWidget };
    _modal.showModal();
    if (!_tree) {
        await loadTree();
    } else {
        renderTree();
    }
}

function closeModal() {
    if (_modal && _modal.open) _modal.close();
    _ctx = null;
}

// =========================================================================
// Data loading
// =========================================================================
async function loadTree() {
    const treePane = _modal.querySelector(".wp-tree");
    treePane.innerHTML = `<div class="wp-preview-empty">Loading…</div>`;
    try {
        const r = await fetch("/wildcard_picker/tree");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        _tree = await r.json();
        renderTree();
    } catch (e) {
        treePane.innerHTML = `<div class="wp-preview-empty">Failed: ${escapeHtml(String(e))}</div>`;
        toast("Tree load failed: " + e);
    }
}

async function loadFile(refPath) {
    const url = `/wildcard_picker/file?path=${encodeURIComponent(refPath)}`;
    const r = await fetch(url);
    if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
    }
    return await r.json();
}

async function onRefresh() {
    try {
        const r = await fetch("/wildcard_picker/refresh", { method: "POST" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        _tree = null;
        _selected = null;
        const preview = _modal.querySelector(".wp-preview");
        preview.innerHTML = `<div class="wp-preview-empty">Click a leaf in the tree to preview its contents.</div>`;
        await loadTree();
    } catch (e) {
        toast("Refresh failed: " + e);
    }
}

// =========================================================================
// Tree rendering
// =========================================================================
const KIND_ICON = {
    dir: "📁",
    yaml: "📋",
    yaml_dir: "📂",
    txt: "📄",
    yaml_list: "🎲",
    yaml_string: "📝",
    yaml_template: "📜",
};

function renderTree() {
    const treePane = _modal.querySelector(".wp-tree");
    treePane.innerHTML = "";
    if (!_tree || !_tree.children) {
        treePane.innerHTML = `<div class="wp-preview-empty">Empty.</div>`;
        return;
    }
    // Render top-level children directly (skip the synthetic root container)
    for (const child of _tree.children) {
        treePane.appendChild(renderNode(child));
    }
    // Re-apply search filter if user typed before tree loaded
    const term = _modal.querySelector(".wp-search").value.trim().toLowerCase();
    if (term) applyFilter(term);
}

function renderNode(node) {
    const isLeaf = node.children === null || node.children === undefined;
    const icon = KIND_ICON[node.kind] || "•";
    const countStr = node.count != null ? `<span class="wp-count">(${node.count})</span>` : "";
    const escName = escapeHtml(node.name);
    const escPath = escapeHtml(node.path || "");

    if (isLeaf) {
        const div = document.createElement("div");
        div.className = "wp-leaf";
        div.dataset.path = node.path;
        div.dataset.name = node.name.toLowerCase();
        div.innerHTML = `<span class="wp-icon">${icon}</span>${escName}${countStr}`;
        div.title = node.path;
        div.addEventListener("click", (e) => {
            e.stopPropagation();
            onLeafClick(div, node);
        });
        return div;
    }

    // Container (dir / yaml / yaml_dir)
    const details = document.createElement("details");
    details.dataset.path = node.path;
    details.dataset.name = node.name.toLowerCase();
    const summary = document.createElement("summary");
    summary.innerHTML = `<span class="wp-icon">${icon}</span>${escName}${countStr}`;
    summary.title = node.path;
    details.appendChild(summary);
    const childrenDiv = document.createElement("div");
    childrenDiv.className = "wp-children";
    for (const child of node.children) {
        childrenDiv.appendChild(renderNode(child));
    }
    details.appendChild(childrenDiv);
    return details;
}

async function onLeafClick(el, node) {
    // visual selection
    _modal.querySelectorAll(".wp-leaf.wp-active").forEach(x => x.classList.remove("wp-active"));
    el.classList.add("wp-active");

    const preview = _modal.querySelector(".wp-preview");
    preview.innerHTML = `<div class="wp-preview-empty">Loading…</div>`;
    try {
        const payload = await loadFile(node.path);
        _selected = payload;
        renderPreview(payload);
    } catch (e) {
        preview.innerHTML = `<div class="wp-preview-empty">Load failed: ${escapeHtml(String(e))}</div>`;
        toast(String(e));
    }
}

// =========================================================================
// Preview rendering
// =========================================================================
function renderPreview(payload) {
    const preview = _modal.querySelector(".wp-preview");
    preview.innerHTML = "";

    const header = document.createElement("div");
    header.className = "wp-preview-header";
    header.textContent = `__${payload.path}__`;
    preview.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "wp-preview-meta";
    if (payload.kind === "yaml_template") {
        meta.textContent = `template (${payload.raw.length} chars)`;
    } else if (payload.kind === "yaml_string") {
        meta.textContent = `single string`;
    } else {
        meta.textContent = `${payload.kind} • ${payload.lines.length} entries`;
    }
    preview.appendChild(meta);

    if (payload.kind === "yaml_template") {
        const raw = document.createElement("pre");
        raw.className = "wp-preview-raw";
        raw.textContent = payload.raw;
        preview.appendChild(raw);
    } else {
        const list = document.createElement("div");
        list.className = "wp-preview-list";
        if (!payload.lines.length) {
            list.innerHTML = `<div class="wp-preview-row" style="color:#777"><span class="wp-row-text">(empty)</span></div>`;
        } else {
            for (const line of payload.lines) {
                list.appendChild(renderPreviewRow(line));
            }
        }
        preview.appendChild(list);
    }

    preview.appendChild(renderInsertionControls(payload));
    updateLivePreview();
}

function renderPreviewRow(line) {
    const row = document.createElement("div");
    row.className = "wp-preview-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "wp-row-cb";
    cb.addEventListener("change", () => {
        row.classList.toggle("wp-row-selected", cb.checked);
        updateLivePreview();
    });
    cb.addEventListener("click", (e) => e.stopPropagation());
    const span = document.createElement("span");
    span.className = "wp-row-text";
    span.textContent = line;
    row.appendChild(cb);
    row.appendChild(span);
    row.addEventListener("click", () => {
        cb.checked = !cb.checked;
        row.classList.toggle("wp-row-selected", cb.checked);
        updateLivePreview();
    });
    return row;
}

function renderInsertionControls(payload) {
    const wrap = document.createElement("div");
    wrap.className = "wp-insertion";

    const isMulti = payload.kind === "txt" || payload.kind === "yaml_list";
    const literalAvail = isMulti || payload.kind === "yaml_string" || payload.kind === "yaml_template";
    const altAvail = isMulti;
    const multiAvail = isMulti;

    wrap.innerHTML = `
        <div class="wp-insertion-row">
            <label><input type="radio" name="wp-mode" value="ref" checked> As reference</label>
            <label><input type="radio" name="wp-mode" value="literal" ${literalAvail ? "" : "disabled"}> As literal</label>
            <label><input type="radio" name="wp-mode" value="alt" ${altAvail ? "" : "disabled"}> As alternation</label>
            <label><input type="radio" name="wp-mode" value="multi" ${multiAvail ? "" : "disabled"}> As multi-pick</label>
        </div>
        <div class="wp-insertion-row">
            <label><input type="checkbox" class="wp-mod-empty"> Wrap with empty option</label>
            <label title="Coming in v0.4"><input type="checkbox" class="wp-mod-dups" disabled> Allow duplicates (v0.4)</label>
        </div>
        <div class="wp-live-preview-label">Will insert:</div>
        <div class="wp-live-preview"></div>
    `;

    wrap.querySelectorAll('input[name="wp-mode"]').forEach(r =>
        r.addEventListener("change", updateLivePreview));
    wrap.querySelector(".wp-mod-empty").addEventListener("change", updateLivePreview);

    return wrap;
}

// =========================================================================
// Insertion-text construction
// =========================================================================
function getCurrentMode() {
    const r = _modal.querySelector('input[name="wp-mode"]:checked');
    return r ? r.value : "ref";
}

function getModifiers() {
    return {
        empty: _modal.querySelector(".wp-mod-empty")?.checked || false,
    };
}

function getSelectedRowLines() {
    const rows = _modal.querySelectorAll(".wp-preview-row");
    return [...rows]
        .filter(r => r.querySelector(".wp-row-cb")?.checked)
        .map(r => r.querySelector(".wp-row-text")?.textContent || "");
}

/**
 * Compute the text the Append/Replace buttons will insert, plus a validity flag.
 * Returns { text: string, valid: boolean, hint: string }.
 *   - text: literal output (always a string, never null)
 *   - valid: whether Append/Replace should be enabled
 *   - hint: when invalid, a short user-facing reason; otherwise empty
 */
function buildInsertion() {
    if (!_selected) return { text: "", valid: false, hint: "(no leaf selected)" };
    const mode = getCurrentMode();
    const mods = getModifiers();
    const path = _selected.path;
    const kind = _selected.kind;

    if (mode === "ref") {
        return { text: `__${path}__`, valid: true, hint: "" };
    }
    if (mode === "literal") {
        if (kind === "yaml_string") {
            return { text: _selected.lines[0] || "", valid: true, hint: "" };
        }
        if (kind === "yaml_template") {
            return { text: _selected.raw || "", valid: true, hint: "" };
        }
        const sel = getSelectedRowLines();
        if (!sel.length) return { text: "(select one or more rows)", valid: false, hint: "select rows" };
        return { text: sel.join(", "), valid: true, hint: "" };
    }
    if (mode === "alt") {
        const sel = getSelectedRowLines();
        if (!sel.length) return { text: "(select one or more rows)", valid: false, hint: "select rows" };
        const tail = mods.empty ? "|" : "";
        return { text: `{${sel.join("|")}${tail}}`, valid: true, hint: "" };
    }
    if (mode === "multi") {
        const sel = getSelectedRowLines();
        if (!sel.length) return { text: "(select one or more rows)", valid: false, hint: "select rows" };
        const n = sel.length;
        const tail = mods.empty ? "|" : "";
        const hi = mods.empty ? n : n;  // empty option doesn't change max pickable distinct lines
        return { text: `{1-${hi}$$, $$${sel.join("|")}${tail}}`, valid: true, hint: "" };
    }
    return { text: "", valid: false, hint: "unknown mode" };
}

function updateLivePreview() {
    const lp = _modal.querySelector(".wp-live-preview");
    const append = _modal.querySelector(".wp-append");
    const replace = _modal.querySelector(".wp-replace");
    if (!lp) return;
    const { text, valid } = buildInsertion();
    lp.textContent = text;
    lp.classList.toggle("wp-live-invalid", !valid);
    if (append) append.disabled = !valid;
    if (replace) replace.disabled = !valid;
}

// =========================================================================
// Insertion actions (Append / Replace selection)
// =========================================================================
function getTextarea(widget) {
    // ComfyUI multiline STRING widget: the actual <textarea> is exposed at
    // widget.element (newer frontend) or widget.inputEl (older). Either way
    // we only use it for selection-aware Replace.
    return widget?.element || widget?.inputEl || null;
}

function notifyWidgetChanged(widget) {
    // Trigger ComfyUI's change handling so the canvas reflects the new value.
    if (typeof widget.callback === "function") {
        widget.callback(widget.value);
    }
    const ta = getTextarea(widget);
    if (ta) {
        ta.value = widget.value;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // Trigger node redraw if possible
    if (_ctx?.node?.graph?.setDirtyCanvas) {
        _ctx.node.graph.setDirtyCanvas(true, true);
    }
}

function onAppend() {
    if (!_ctx?.textWidget) return;
    const { text, valid } = buildInsertion();
    if (!valid) return;
    const w = _ctx.textWidget;
    const cur = w.value || "";
    const sep = cur && !cur.endsWith("\n") ? "\n" : "";
    w.value = cur + sep + text;
    notifyWidgetChanged(w);
    closeModal();
}

function onReplaceSelection() {
    if (!_ctx?.textWidget) return;
    const { text, valid } = buildInsertion();
    if (!valid) return;
    const w = _ctx.textWidget;
    const ta = getTextarea(w);
    if (ta && typeof ta.selectionStart === "number") {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const cur = w.value || "";
        const next = cur.substring(0, start) + text + cur.substring(end);
        w.value = next;
        notifyWidgetChanged(w);
        // Restore caret to end of inserted text
        try {
            ta.focus();
            const newPos = start + text.length;
            ta.setSelectionRange(newPos, newPos);
        } catch (_) { /* best effort */ }
    } else {
        // No accessible textarea — fall back to append
        const cur = w.value || "";
        const sep = cur && !cur.endsWith("\n") ? "\n" : "";
        w.value = cur + sep + text;
        notifyWidgetChanged(w);
    }
    closeModal();
}

// =========================================================================
// Search filter
// =========================================================================
function onSearchInput(e) {
    const term = e.target.value.trim().toLowerCase();
    applyFilter(term);
}

function applyFilter(term) {
    const treePane = _modal.querySelector(".wp-tree");
    // Drop any prior empty-state notice
    treePane.querySelector(".wp-empty-state")?.remove();
    if (!term) {
        // Reset: show everything, collapse to original
        treePane.querySelectorAll(".wp-hide").forEach(x => x.classList.remove("wp-hide"));
        return;
    }
    // Walk every node element. For leaves: hide if neither name nor path matches.
    // For containers: hide if no descendant matches; otherwise expand.
    const anyMatch = walkAndFilter(treePane, term);
    if (!anyMatch) {
        const empty = document.createElement("div");
        empty.className = "wp-empty-state wp-preview-empty";
        empty.textContent = `No matches for "${term}".`;
        treePane.appendChild(empty);
    }
}

function walkAndFilter(parentEl, term) {
    // Returns true if this subtree contains any match
    let anyMatch = false;
    for (const child of parentEl.children) {
        if (child.classList?.contains("wp-leaf")) {
            const name = child.dataset.name || "";
            const path = (child.dataset.path || "").toLowerCase();
            const match = name.includes(term) || path.includes(term);
            child.classList.toggle("wp-hide", !match);
            if (match) anyMatch = true;
        } else if (child.tagName === "DETAILS") {
            const childrenDiv = child.querySelector(":scope > .wp-children");
            const subMatch = childrenDiv ? walkAndFilter(childrenDiv, term) : false;
            // Also check this container's own name
            const ownMatch = (child.dataset.name || "").includes(term);
            const visible = subMatch || ownMatch;
            child.classList.toggle("wp-hide", !visible);
            if (visible) {
                anyMatch = true;
                if (subMatch) child.open = true;  // auto-expand to reveal matches
            }
        } else if (child.classList?.contains("wp-children")) {
            // Shouldn't happen at this level but recurse defensively
            if (walkAndFilter(child, term)) anyMatch = true;
        }
    }
    return anyMatch;
}

// =========================================================================
// Utils
// =========================================================================
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function toast(msg) {
    const el = document.createElement("div");
    el.className = "wp-toast";
    el.textContent = String(msg);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}
