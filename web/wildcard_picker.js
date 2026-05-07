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
    padding: 4px 10px;
    border-bottom: 1px solid #2a2a2a;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    cursor: default;
    user-select: text;
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
            <button class="wp-btn wp-insert" disabled>Insert (M4)</button>
        </div>
    `;
    document.body.appendChild(_modal);

    // Wire static handlers
    _modal.querySelector(".wp-close").addEventListener("click", closeModal);
    _modal.querySelector(".wp-cancel").addEventListener("click", closeModal);
    _modal.querySelector(".wp-refresh").addEventListener("click", onRefresh);
    _modal.querySelector(".wp-search").addEventListener("input", onSearchInput);

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
        return;
    }

    const list = document.createElement("div");
    list.className = "wp-preview-list";
    if (!payload.lines.length) {
        list.innerHTML = `<div class="wp-preview-row" style="color:#777">(empty)</div>`;
    } else {
        for (const line of payload.lines) {
            const row = document.createElement("div");
            row.className = "wp-preview-row";
            row.textContent = line;
            list.appendChild(row);
        }
    }
    preview.appendChild(list);
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
    if (!term) {
        // Reset: show everything, collapse to original
        treePane.querySelectorAll(".wp-hide").forEach(x => x.classList.remove("wp-hide"));
        return;
    }
    // Walk every node element. For leaves: hide if neither name nor path matches.
    // For containers: hide if no descendant matches; otherwise expand.
    walkAndFilter(treePane, term);
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
