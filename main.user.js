// ==UserScript==
// @name         NSPD Parser
// @description  Парсинг КН
// @namespace    https://github.com/werunopi/NSPD-Parser
// @supportURL   https://github.com/werunopi/NSPD-Parser/issues
// @updateURL    https://raw.githubusercontent.com/werunopi/NSPD-Parser/refs/heads/main/main.meta.js
// @downloadURL  https://raw.githubusercontent.com/werunopi/NSPD-Parser/refs/heads/main/main.user.js
// @version      1.0
// @author       werunopi
// @match        https://nspd.gov.ru/*
// @grant        none
// @license      GPUL
// ==/UserScript==

(function() {
    'use strict';

    const AVAILABLE_FIELDS = [
        "Вид объекта недвижимости", "Вид земельного участка", "Дата присвоения",
        "Кадастровый номер", "Кадастровый квартал", "Адрес",
        "Площадь уточненная", "Площадь декларированная", "Площадь",
        "Статус", "Категория земель", "Вид разрешенного использования",
        "Форма собственности", "Кадастровая стоимость"
    ];

    let isRunning = false;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function findElementDeep(selector, root = document) {
        let found = root.querySelector(selector);
        if (found) return found;
        const all = root.querySelectorAll('*');
        for (let el of all) {
            if (el.shadowRoot) {
                found = findElementDeep(selector, el.shadowRoot);
                if (found) return found;
            }
        }
        return null;
    }

    function findAllElementsDeep(selector, root = document, found = []) {
        const elements = root.querySelectorAll(selector);
        elements.forEach(el => found.push(el));
        const all = root.querySelectorAll('*');
        for (const el of all) {
            if (el.shadowRoot) findAllElementsDeep(selector, el.shadowRoot, found);
        }
        return found;
    }

    function findAllParameterGenerators(root = document, found = []) {
        const elements = root.querySelectorAll('*');
        for (const el of elements) {
            if (el.tagName.toLowerCase() === 'm-parameter-generator') found.push(el);
            if (el.shadowRoot) findAllParameterGenerators(el.shadowRoot, found);
        }
        return found;
    }

    async function forceCloseCard() {
        const page = findElementDeep('m-selected-object-page');
        if (!page) return true;
        const backBtnContainer = findElementDeep('edit-back-button');
        const btn = backBtnContainer?.shadowRoot?.querySelector('button');
        if (btn) btn.click();
        const anyBack = findElementDeep('m-button[variant="icon"].icon');
        anyBack?.click();
        await sleep(300);
        return !findElementDeep('m-selected-object-page');
    }

    async function processNumber(kn, fieldsToExtract, tSearch) {
        if (!isRunning) return null;
        await forceCloseCard();

        const inputField = findElementDeep('m-search-field');
        const input = inputField?.shadowRoot?.querySelector('input');
        if (!input) throw new Error("Поиск не найден");

        const clearBtn = inputField.shadowRoot.querySelector('.cross button');
        if (clearBtn) { clearBtn.click(); await sleep(300); }

        input.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, kn);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(200);

        const searchBtn = findElementDeep('button[type="submit"]');
        if (searchBtn) searchBtn.click();
        else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        let resultItem = null;
        const startS = Date.now();
        while (!resultItem && (Date.now() - startS < tSearch)) {
            if (!isRunning) return null;
            const items = findAllElementsDeep('.accordion-item.clickable');
            for (let item of items) {
                if ((item.innerText || item.textContent).includes(kn)) {
                    resultItem = item;
                    break;
                }
            }
            if (!resultItem) await sleep(250);
        }

        if (!resultItem) return fieldsToExtract.map(() => "Не найден");

        resultItem.scrollIntoView({block: "center"});
        await sleep(500);
        resultItem.click();

        let loaded = false;
        const startW = Date.now();
        while (Date.now() - startW < tSearch) {
            if (!isRunning) return null;
            const h3 = findElementDeep('m-selected-object-page m-typography[color="neutral-500"]');
            const title = h3 ? (h3.getAttribute('text') || h3.textContent || "") : "";

            if (title.includes(kn)) {
                const gens = findAllParameterGenerators();
                if (gens.length > 0) {
                    loaded = true;
                    break;
                }
            }
            await sleep(250);
        }

        if (!loaded) return fieldsToExtract.map(() => "Таймаут карточки");

        const results = {};
        const generators = findAllParameterGenerators();
        generators.forEach(gen => {
            const sr = gen.shadowRoot;
            const label = sr?.querySelector('m-typography[type="p3"]')?.getAttribute('text');
            if (label) {
                const valEl = sr.querySelector('m-string-item') || sr.querySelector('m-typography[type="p1"]');
                results[label.trim()] = valEl ? (valEl.getAttribute('text') || valEl.textContent).trim() : "н/д";
            }
        });
        return fieldsToExtract.map(f => results[f] || "н/д");
    }

    function injectGrabberButton() {
        setInterval(() => {
            const accordion = findElementDeep('m-accordion');
            if (!accordion || !accordion.shadowRoot) return;
            const header = accordion.shadowRoot.querySelector('.accordion-title .header');
            if (!header || header.querySelector('.nspd-grab-btn')) return;
            const downloadBtn = header.querySelector('m-load-search-results-button');
            if (!downloadBtn) return;

            const btnContainer = document.createElement('div');
            btnContainer.className = 'nspd-grab-btn';
            btnContainer.style = 'margin-right:8px; display:flex; align-items:center; cursor:pointer; margin-left: auto;';
            btnContainer.innerHTML = `<div style="padding:8px; border-radius:50%;" title="Извлечь КН в панель">
                <svg fill="#007CFF" width="24" height="24" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            </div>`;

            const div = btnContainer.querySelector('div');
            div.onmouseover = () => { div.style.background = 'rgba(0,0,0,0.05)'; };
            div.onmouseout = () => { div.style.background = 'transparent'; };

            btnContainer.onclick = (e) => {
                e.stopPropagation();
                const items = accordion.shadowRoot.querySelectorAll('.accordion-items .accordion-item.clickable');
                let textContent = "";
                items.forEach(i => { textContent += " " + (i.innerText || i.textContent); });
                const kns = [...new Set(textContent.match(/\d{2}:\d{2}:\d{6,7}:\d+/g))];
                if (kns.length) {
                    const input = document.getElementById('kn_input');
                    if(input) {
                        input.value = kns.join('\n');
                        const svg = div.querySelector('svg');
                        svg.setAttribute('fill', '#00CC00');
                        setTimeout(() => { svg.setAttribute('fill', '#007CFF'); }, 500);
                    }
                }
            };
            header.insertBefore(btnContainer, downloadBtn);
        }, 1500);
    }

    function createUI() {
        if (document.getElementById('nspd_ui')) return;
        const savedFields = JSON.parse(localStorage.getItem('nspd_fields') || '[]');
        const savedPos = JSON.parse(localStorage.getItem('nspd_pos') || '{"top":"50px","left":"20px"}');
        const savedTimeout = localStorage.getItem('nspd_timeout') || "7000";

        const ui = document.createElement('div');
        ui.id = "nspd_ui";
        ui.style = `position:fixed; top:${savedPos.top}; left:${savedPos.left}; z-index:100000; background:white; border:2px solid #007CFF; border-radius:12px; width:300px; box-shadow:0 10px 25px rgba(0,0,0,0.4); font-family:sans-serif; overflow:hidden;`;
        ui.innerHTML = `
            <div id="nspd_drag" style="background:#007CFF; color:white; padding:10px; cursor:move; font-weight:bold; display:flex; justify-content:space-between; align-items:center;">
                <span>NSPD Parser</span>
                <button id="toggle_ui_btn" style="background:none; border:none; color:white; cursor:pointer; font-size:18px;">–</button>
            </div>
            <div id="nspd_body" style="padding:15px; display:flex; flex-direction:column; gap:10px;">
                <textarea id="kn_input" style="width:100%; height:80px; font-size:11px; resize:vertical;" placeholder="КН через перенос..."></textarea>
                <div style="font-size:11px;">Ожидание КН (мс): <input type="number" id="t_search" value="${savedTimeout}" style="width:60px;"></div>
                <div id="fields" style="max-height:140px; overflow-y:auto; border:1px solid #eee; font-size:11px; padding:5px;">
                    ${AVAILABLE_FIELDS.map(f => `<label style="display:block; margin-bottom:2px;"><input type="checkbox" value="${f}" ${savedFields.includes(f)?'checked':''}> ${f}</label>`).join('')}
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <button id="start_btn" style="background:#007CFF; color:white; border:none; padding:10px; border-radius:5px; cursor:pointer; font-weight:bold;">ЗАПУСТИТЬ</button>
                    <button id="stop_btn" style="background:#ff4d4d; color:white; border:none; padding:10px; border-radius:5px; cursor:pointer; font-weight:bold; display:none;">СТОП</button>
                </div>
                <div id="status" style="text-align:center; font-size:12px; color:#007CFF; font-weight:bold;">Готов</div>
            </div>
        `;
        document.body.appendChild(ui);

        const startBtn = ui.querySelector('#start_btn');
        const stopBtn = ui.querySelector('#stop_btn');
        const stat = ui.querySelector('#status');

        ui.querySelector('#t_search').addEventListener('change', (e) => localStorage.setItem('nspd_timeout', e.target.value));
        ui.querySelector('#fields').addEventListener('change', () => {
            const checked = Array.from(ui.querySelectorAll('#fields input:checked')).map(i => i.value);
            localStorage.setItem('nspd_fields', JSON.stringify(checked));
        });

        ui.querySelector('#toggle_ui_btn').onclick = () => {
            const body = ui.querySelector('#nspd_body');
            const isCol = body.style.display === 'none';
            body.style.display = isCol ? 'flex' : 'none';
            ui.querySelector('#toggle_ui_btn').innerText = isCol ? '–' : '+';
        };

        stopBtn.onclick = () => {
            isRunning = false;
            stat.innerText = "Остановка...";
        };

        startBtn.onclick = async () => {
            let rawInput = ui.querySelector('#kn_input').value;
            const kns = [...new Set(rawInput.match(/\d{2}:\d{2}:\d{6,7}:\d+/g))];
            const fields = Array.from(ui.querySelectorAll('#fields input:checked')).map(i => i.value);
            const tSearch = parseInt(ui.querySelector('#t_search').value);

            if (!kns || kns.length === 0) return alert("КН не найдены");
            if (fields.length === 0) return alert("Выберите хотя бы одно поле");

            isRunning = true;
            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';

            const results = [["КН", ...fields]];

            for (let i = 0; i < kns.length; i++) {
                if (!isRunning) break;
                stat.innerText = `Парсинг: ${i+1}/${kns.length}`;

                let row = await processNumber(kns[i], fields, tSearch);
                if (!row) break;

                if (row.includes("Не найден") || row.includes("Таймаут карточки")) {
                    stat.innerText = `Повтор для ${kns[i]}...`;
                    await sleep(2000);
                    row = await processNumber(kns[i], fields, tSearch);
                }

                if (row) results.push([kns[i], ...row]);
                await sleep(800);
            }

            if (results.length > 1) {
                const csv = "\uFEFF" + results.map(r => r.join(";")).join("\n");
                const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `nspd_results_${new Date().toISOString().slice(0,10)}.csv`;
                a.click();
            }

            isRunning = false;
            startBtn.style.display = 'block';
            stopBtn.style.display = 'none';
            stat.innerText = "Готово";
        };

        const drag = ui.querySelector('#nspd_drag');
        drag.onmousedown = (e) => {
            if (e.target.id === 'toggle_ui_btn') return;
            let sX = e.clientX - ui.getBoundingClientRect().left;
            let sY = e.clientY - ui.getBoundingClientRect().top;
            document.onmousemove = (ev) => {
                ui.style.left = ev.pageX - sX + 'px';
                ui.style.top = ev.pageY - sY + 'px';
            };
            document.onmouseup = () => {
                document.onmousemove = null;
                localStorage.setItem('nspd_pos', JSON.stringify({top: ui.style.top, left: ui.style.left}));
            };
        };
    }

    setTimeout(createUI, 2000);
    injectGrabberButton();
})();
