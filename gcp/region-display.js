// ==UserScript==
// @name         GCP 可用区中文标注
// @namespace    http://tampermonkey.net/
// @version      1.2.1
// @description  在 GCP Compute Engine 实例页面，自动将可用区（如 southamerica-west1-b）标注为对应的国家和城市（简体中文）
// @author       You
// @match        https://console.cloud.google.com/compute/instances*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // GCP region → 国家/城市（简体中文）映射表
    const REGION_MAP = {
        // 美国
        'us-central1':              '美国 · 爱荷华州',
        'us-east1':                 '美国 · 南卡罗来纳州',
        'us-east4':                 '美国 · 弗吉尼亚州北部',
        'us-east5':                 '美国 · 俄亥俄州哥伦布',
        'us-south1':                '美国 · 德克萨斯州达拉斯',
        'us-west1':                 '美国 · 俄勒冈州',
        'us-west2':                 '美国 · 加利福尼亚州洛杉矶',
        'us-west3':                 '美国 · 犹他州盐湖城',
        'us-west4':                 '美国 · 内华达州拉斯维加斯',
        // 北美洲
        'northamerica-northeast1':  '加拿大 · 魁北克蒙特利尔',
        'northamerica-northeast2':  '加拿大 · 安大略多伦多',
        'northamerica-south1':      '墨西哥 · 克雷塔罗',
        // 南美洲
        'southamerica-east1':       '巴西 · 圣保罗',
        'southamerica-west1':       '智利 · 圣地亚哥',
        // 欧洲
        'europe-central2':          '波兰 · 华沙',
        'europe-north1':            '芬兰 · 哈米纳',
        'europe-north2':            '瑞典 · 斯德哥尔摩',
        'europe-southwest1':        '西班牙 · 马德里',
        'europe-west1':             '比利时 · 圣吉斯兰',
        'europe-west2':             '英国 · 伦敦',
        'europe-west3':             '德国 · 法兰克福',
        'europe-west4':             '荷兰 · 埃姆斯黑文',
        'europe-west6':             '瑞士 · 苏黎世',
        'europe-west8':             '意大利 · 米兰',
        'europe-west9':             '法国 · 巴黎',
        'europe-west10':            '德国 · 柏林',
        'europe-west12':            '意大利 · 都灵',
        // 亚洲
        'asia-east1':               '台湾 · 彰化',
        'asia-east2':               '中国 · 香港',
        'asia-northeast1':          '日本 · 东京',
        'asia-northeast2':          '日本 · 大阪',
        'asia-northeast3':          '韩国 · 首尔',
        'asia-south1':              '印度 · 孟买',
        'asia-south2':              '印度 · 德里',
        'asia-southeast1':          '新加坡',
        'asia-southeast2':          '印度尼西亚 · 雅加达',
        'asia-southeast3':          '泰国 · 曼谷',
        // 澳大利亚及大洋洲
        'australia-southeast1':     '澳大利亚 · 悉尼',
        'australia-southeast2':     '澳大利亚 · 墨尔本',
        // 中东
        'me-central1':              '卡塔尔 · 多哈',
        'me-central2':              '沙特阿拉伯 · 达曼',
        'me-west1':                 '以色列 · 特拉维夫',
        // 非洲
        'africa-south1':            '南非 · 约翰内斯堡',
    };

    // 将可用区字符串转为 region，例如：
    //   southamerica-west1-b      → southamerica-west1
    //   us-west4-ai2b            → us-west4
    function zoneToRegion(zone) {
        return zone.replace(/-[^-]+$/, '');
    }

    // 判断文本是否为 GCP 可用区格式，如 us-central1-a, europe-west1-b
    function isZoneString(text) {
        return /^[a-z]+(?:-[a-z]+)*\d+-[a-z]$/.test(text);
    }

    // 根据可用区字符串返回中文地理标注，未知 region 返回 null
    function getChineseLabel(zone) {
        const region = zoneToRegion(zone);
        return REGION_MAP[region] ?? null;
    }

    const LABEL_SPAN_CLASS    = 'gcp-zone-cn-label';
    const LABEL_CELL_CLASS    = 'gcp-zone-cn-cell';
    const LABEL_TH_CLASS      = 'gcp-zone-cn-header';
    const ZONE_ANNOTATED_ATTR = 'data-gcp-zone-annotated';
    const LABEL_CELL_ATTR     = 'data-gcp-label-cell';
    // 每张表格只插入一次表头列，用 WeakSet 记录已处理的表格节点
    const HEADER_ANNOTATED    = new WeakSet();

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .${LABEL_SPAN_CLASS} {
                display: inline-block;
                color: #1a73e8;
                font-size: 0.82em;
                font-style: normal;
                font-weight: normal;
                padding: 1px 5px;
                border: 1px solid #c5d9f8;
                border-radius: 3px;
                background: #e8f0fe;
                white-space: nowrap;
                line-height: 1.5;
                user-select: none;
            }
            .${LABEL_CELL_CLASS} {
                white-space: nowrap;
                vertical-align: middle;
            }
            .${LABEL_TH_CLASS} {
                white-space: nowrap;
                font-size: 0.85em;
                color: #5f6368;
                font-weight: 500;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 在可用区列之后插入一个平级的新表格列，并为所在表格的表头行补充对应标题单元格。
     * 每张表格只执行一次表头插入（通过 HEADER_ANNOTATED WeakSet 追踪）。
     *
     * 优先通过 data-column-id="zoneForFilter" 或 aria-label="可用区" 定位表头列，
     * 回退方案才使用列索引匹配，以应对 GCP Angular SPA 的实际 DOM 结构。
     */
    function addHeaderColumn(zoneCell) {
        const row = zoneCell.parentElement;
        if (!row) return;

        const table = row.closest('table, [role="grid"], [role="treegrid"]');
        if (!table || HEADER_ANNOTATED.has(table)) return;

        // 避免重复插入
        if (table.querySelector(`.${LABEL_TH_CLASS}`)) {
            HEADER_ANNOTATED.add(table);
            return;
        }

        // 优先按 data-column-id 或 aria-label 定位可用区表头单元格
        const refTh =
            table.querySelector('[data-column-id="zoneForFilter"]') ||
            table.querySelector('[role="columnheader"][aria-label="可用区"]') ||
            (() => {
                // 回退：用列索引匹配
                const headerRow =
                    table.querySelector('thead tr') ||
                    table.querySelector('[role="row"]:has([role="columnheader"])');
                if (!headerRow) return null;
                const colIndex = Array.from(row.children).indexOf(zoneCell);
                if (colIndex < 0) return null;
                return Array.from(headerRow.children)[colIndex] ?? null;
            })();

        if (!refTh) return;

        const newTh = document.createElement(refTh.tagName.toLowerCase());
        newTh.className = LABEL_TH_CLASS;
        const refRole = refTh.getAttribute('role');
        if (refRole) newTh.setAttribute('role', refRole);
        newTh.textContent = '地区';
        refTh.insertAdjacentElement('afterend', newTh);

        HEADER_ANNOTATED.add(table);
    }

    /**
     * 扫描整个页面，找到所有仅含可用区文本的表格单元格，
     * 在其后方插入一个平级的相邻单元格（新列）展示中文地理标注，
     * 而非将标注注入原单元格内部。
     *
     * GCP 实例列表的 DOM 结构（来自实际页面）：
     *   <td role="gridcell" style="white-space: nowrap;">
     *     <gce2-zone-warning><!----></gce2-zone-warning>
     *     <!----> us-east1-c <!----><!---->
     *   </td>
     *
     * 单元格内含 Angular 注释节点 + 空的 <gce2-zone-warning> 子元素 + 文本节点，
     * textContent.trim() 即为可用区字符串。
     */
    function scanPage() {
        // 同时覆盖 Angular cfc-table (<td role="gridcell">) 及原生 <td>
        const cells = document.querySelectorAll(
            'td[role="gridcell"], td[role="rowheader"], [role="gridcell"]'
        );

        cells.forEach(cell => {
            // 已标注过时，检查平级标注列是否仍存在（Angular 虚拟滚动可能移除节点）
            if (cell.hasAttribute(ZONE_ANNOTATED_ATTR)) {
                const next = cell.nextElementSibling;
                if (next && next.hasAttribute(LABEL_CELL_ATTR)) return;
                // 标注列已被移除，重置标记以便重新注入
                cell.removeAttribute(ZONE_ANNOTATED_ATTR);
            }

            // 跳过含有实质性子元素内容的复杂单元格（如含链接、按钮等）。
            // 注意：GCP 的可用区单元格含有 <gce2-zone-warning> 空子元素，
            // 其 textContent 为空，不应被视为复杂单元格。
            if (Array.from(cell.children).some(el => el.textContent.trim() !== '')) return;

            const text = cell.textContent.trim();
            if (!isZoneString(text)) return;

            const label = getChineseLabel(text);
            if (!label) return;

            cell.setAttribute(ZONE_ANNOTATED_ATTR, '1');

            // 在可用区单元格后插入新的平级列单元格
            const newCell = document.createElement(cell.tagName.toLowerCase());
            newCell.className = LABEL_CELL_CLASS;
            newCell.setAttribute(LABEL_CELL_ATTR, '1');
            const cellRole = cell.getAttribute('role');
            if (cellRole) newCell.setAttribute('role', cellRole);

            const span = document.createElement('span');
            span.className = LABEL_SPAN_CLASS;
            span.textContent = label;
            span.title = text + ' → ' + label;
            newCell.appendChild(span);

            cell.insertAdjacentElement('afterend', newCell);

            // 为所在表格补充表头列
            addHeaderColumn(cell);
        });
    }

    // 防抖计时器：任何 DOM 变动都触发一次全页扫描，避免漏扫
    let scanTimer = null;

    function scheduleScan() {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(scanPage, 400);
    }

    function init() {
        injectStyles();

        // 立即扫描一次（处理已渲染内容）
        scanPage();

        // 监听 DOM 变化：每次变化后重新扫描整页，而非仅扫描新增节点
        // 这样可以避免 Angular SPA 多批次渲染时丢失扫描目标
        const observer = new MutationObserver(scheduleScan);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        // 保底轮询：每 3 秒扫描一次，防止极端情况下 MutationObserver 回调漏触发
        setInterval(scanPage, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
